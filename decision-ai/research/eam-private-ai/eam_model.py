import torch
import torch.nn as nn
import torch.nn.functional as F
import math
import random
import json
import sys
import os
from collections import deque
from dataclasses import dataclass, asdict
from typing import Optional, Tuple, List

# Windows 终端 UTF-8 输出修复
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

@dataclass
class CoreHyperCfg:
    embed_dim: int = 64
    head_count: int = 4
    group_div: int = 4
    stack_layers: int = 2
    seq_block_limit: int = 32
    max_context_len: int = 128
    base_drop: float = 0.0
    inner_drop: float = 0.0
    base_learn_rate: float = 1e-4
    interact_learn_rate: float = 1e-5
    weight_decay_coeff: float = 0.0
    bagua_state_size: int = 8
    ff_dim_expand: int = 2
    avalanche_step_gap: int = 100
    avalanche_reset_prob: float = 0.1
    avalanche_cool_step: int = 50
    short_memory_cap: int = 10
    long_memory_cap: int = 20
    memory_replace_thresh: int = 15
    interact_grad_acc_step: int = 1

@dataclass
class TrainRuntimeCfg:
    checkpoint_root: str = "./test_ckpt"
    gen_output_root: str = "./test_gen"
    memory_store_path: str = "./test_memory.json"
    human_corpus_path: str = "./test_human.json"
    raw_data_path: str = "data.txt"
    batch_size: int = 2
    grad_accumulate: int = 1
    warmup_steps: int = 10
    total_train_steps: int = 20
    log_print_interval: int = 5
    eval_check_step: int = 10
    eval_gen_length: int = 15
    eval_batch_num: int = 2
    random_seed: int = 42
    use_mixed_precision: bool = False
    label_smooth_factor: float = 0.0
    early_stop_tolerance: int = 5
    temp_init: float = 0.8
    temp_min: float = 0.5
    max_continuous_unpunc: int = 20
    punctuation_set = list('，。！？；：、“”‘’（）…— \n')
    chinese_char_pool = [chr(i) for i in range(0x4e00, 0x9fff + 1)]
    valid_token_pool = sorted(set(punctuation_set + chinese_char_pool))

# 初始化配置
core_cfg = CoreHyperCfg()
train_cfg = TrainRuntimeCfg()
compute_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

def safe_causal_mask(seq_len: int, device) -> torch.Tensor:
    """自研因果掩码，适配FP16无NaN，替代原版-1e9溢出方案"""
    upper_mask = torch.triu(torch.ones((seq_len, seq_len), device=device), diagonal=1)
    fill_val = -60000.0
    mask = torch.where(upper_mask > 0, fill_val, torch.zeros_like(upper_mask))
    return mask.unsqueeze(0).unsqueeze(1)

def token_hash_vector(embedding_weight: torch.Tensor, token_ids: List[int]) -> torch.Tensor:
    """自研哈希特征向量，替代通用余弦相似度惩罚"""
    selected_emb = embedding_weight[torch.tensor(token_ids, device=embedding_weight.device)]
    hash_vec = torch.sum(torch.abs(selected_emb), dim=0)
    return F.normalize(hash_vec.unsqueeze(0), p=2, dim=-1)

class HyperCubeBaguaTransform(nn.Module):
    def __init__(self, cfg: CoreHyperCfg):
        super().__init__()
        self.cfg = cfg
        self.dim = cfg.embed_dim
        self.head_num = cfg.head_count
        self.head_sub_dim = self.dim // self.head_num
        self.group_split = cfg.group_div
        assert self.head_sub_dim % self.group_split == 0
        self.group_total = self.head_sub_dim // self.group_split
        self.bagua_num = cfg.bagua_state_size
        self.shared_proj = nn.Linear(self.dim, self.dim * 3, bias=False)
        self.output_proj = nn.Linear(self.dim, self.dim, bias=False)
        self.drop_inner = nn.Dropout(cfg.inner_drop)
        self.drop_res = nn.Dropout(cfg.base_drop)

        base_4d = torch.tensor([
            [1, 1, 1, 1],
            [1, 1, -1, -1],
            [1, -1, 1, -1],
            [1, -1, -1, 1]
        ], dtype=torch.float32)
        base_4d = F.normalize(base_4d, p=2, dim=-1)
        bagua_trans_mats = []
        for state_idx in range(self.bagua_num):
            mat = torch.eye(4, dtype=torch.float32)
            if state_idx & 1:
                mat *= torch.tensor([1, -1, 1, -1])
            if state_idx & 2:
                mat *= torch.tensor([-1, 1, -1, 1])
            if state_idx & 4:
                swap_mat = torch.zeros((4, 4))
                swap_mat[[0, 1], [1, 0]] = 1
                swap_mat[[2, 3], [3, 2]] = 1
                mat = mat @ swap_mat
            bagua_trans_mats.append(mat @ base_4d)
        self.register_buffer("bagua_matrix_pool", torch.stack(bagua_trans_mats))
        self.bagua_logit_bias = nn.Parameter(torch.full((1, self.head_num, 1, self.group_total, self.bagua_num), -1.8))
        self.time_evo_gru = nn.GRU(input_size=self.group_total, hidden_size=self.group_total, num_layers=1, batch_first=False)
        self.state_project = nn.Linear(self.group_total, self.bagua_num)
        self.group_merge_layer = nn.Linear(self.group_total * 2, self.group_total, bias=False)

    def forward(self, seq_feat: torch.Tensor, gru_hidden: Optional[torch.Tensor] = None) -> Tuple[torch.Tensor, torch.Tensor]:
        B, T, D = seq_feat.shape
        total_proj = self.shared_proj(seq_feat)
        q_raw, k_raw, v_raw = torch.chunk(total_proj, 3, dim=-1)
        q = q_raw.reshape(B, T, self.head_num, self.head_sub_dim).transpose(1, 2)
        k = k_raw.reshape(B, T, self.head_num, self.head_sub_dim).transpose(1, 2)
        v = v_raw.reshape(B, T, self.head_num, self.head_sub_dim).transpose(1, 2)

        q_group = q.reshape(B, self.head_num, T, self.group_total, self.group_split)
        k_group = k.reshape(B, self.head_num, T, self.group_total, self.group_split)

        local_group_mean = q_group.mean(dim=-1)
        global_group_mean = local_group_mean.mean(dim=1, keepdim=True).expand(-1, self.head_num, -1, -1)
        fused_group_feat = self.group_merge_layer(torch.cat([local_group_mean, global_group_mean], dim=-1))

        gru_input = fused_group_feat.permute(2, 0, 1, 3).reshape(T, B * self.head_num, self.group_total)
        gru_out, new_hidden = self.time_evo_gru(gru_input, gru_hidden)
        state_bias = self.state_project(gru_out).view(T, B, self.head_num, self.bagua_num).permute(1, 2, 0, 3).unsqueeze(-2)
        bagua_weight_dist = F.softmax(self.bagua_logit_bias + state_bias, dim=-1)

        q_transform_all = torch.einsum("sdm,bhtgd->bhtgsm", self.bagua_matrix_pool, q_group)
        k_transform_all = torch.einsum("sdm,bhtgd->bhtgsm", self.bagua_matrix_pool, k_group)

        q_selected = torch.sum(q_transform_all * bagua_weight_dist.unsqueeze(-1), dim=-2)
        k_selected = torch.sum(k_transform_all * bagua_weight_dist.unsqueeze(-1), dim=-2)
        fuse_coeff = torch.mean(torch.sum(bagua_weight_dist, dim=-1), dim=-1, keepdim=True).unsqueeze(-1)
        q_final = q_group * (1 - fuse_coeff) + q_selected * fuse_coeff
        k_final = k_group * (1 - fuse_coeff) + k_selected * fuse_coeff
        q_final = q_final.reshape(B, self.head_num, T, self.head_sub_dim)
        k_final = k_final.reshape(B, self.head_num, T, self.head_sub_dim)

        # ========== 自研曼哈顿距离代替内积 ==========
        dist_l1 = torch.abs(q_final.unsqueeze(-2) - k_final.unsqueeze(-3)).sum(dim=-1)
        dim_scale = math.sqrt(self.head_sub_dim) * 1.02
        attn_score = -dist_l1 / dim_scale
        # ===========================================

        causal_mask = safe_causal_mask(T, seq_feat.device)
        attn_score += causal_mask
        attn_weight = self.drop_inner(F.softmax(attn_score, dim=-1))
        attn_out = torch.matmul(attn_weight, v)
        attn_out = attn_out.transpose(1, 2).reshape(B, T, D)
        final_out = self.drop_res(self.output_proj(attn_out))
        return final_out, new_hidden

class EAMTimeGateFFN(nn.Module):
    def __init__(self, cfg: CoreHyperCfg):
        super().__init__()
        self.dim = cfg.embed_dim
        expand_dim = self.dim * cfg.ff_dim_expand
        self.base_mapping = nn.Linear(self.dim, expand_dim, bias=False)
        self.time_gate_gru = nn.GRU(input_size=expand_dim, hidden_size=expand_dim, num_layers=1, batch_first=False)
        self.gate_weight_map = nn.Linear(expand_dim, expand_dim, bias=False)
        self.feature_recover = nn.Linear(expand_dim, self.dim, bias=False)
        self.drop = nn.Dropout(cfg.base_drop)

    def forward(self, feat: torch.Tensor, gru_h: Optional[torch.Tensor] = None) -> Tuple[torch.Tensor, torch.Tensor]:
        B, T, D = feat.shape
        base_map = self.base_mapping(feat)
        gru_in = base_map.permute(1, 0, 2)
        gru_out, new_h = self.time_gate_gru(gru_in, gru_h)
        gate_signal = torch.sigmoid(self.gate_weight_map(gru_out.permute(1, 0, 2)))
        gated_feat = base_map * gate_signal
        recover_out = self.drop(self.feature_recover(gated_feat))
        return recover_out, new_h

class EAMMultiFusionBlock(nn.Module):
    def __init__(self, cfg: CoreHyperCfg):
        super().__init__()
        self.cfg = cfg
        self.bagua_attn = HyperCubeBaguaTransform(cfg)
        self.time_ffn = EAMTimeGateFFN(cfg)
        self.local_conv_extract = nn.Conv1d(cfg.embed_dim, cfg.embed_dim, kernel_size=3, padding=1, bias=False)
        self.layer_norm = nn.LayerNorm(cfg.embed_dim)
        self.w_global = nn.Parameter(torch.tensor(0.55))
        self.w_seq = nn.Parameter(torch.tensor(0.30))
        self.w_local = nn.Parameter(torch.tensor(0.15))
        self.fusion_proj = nn.Linear(cfg.embed_dim, cfg.embed_dim, bias=False)
        self.drop = nn.Dropout(cfg.base_drop)
        self.residual_alpha = nn.Parameter(torch.tensor(0.65))

    def forward(self, x: torch.Tensor, attn_h: Optional[torch.Tensor] = None, ffn_h: Optional[torch.Tensor] = None):
        norm_x = self.layer_norm(x)
        global_feat, new_attn_h = self.bagua_attn(norm_x, attn_h)
        seq_feat, new_ffn_h = self.time_ffn(norm_x, ffn_h)
        local_conv = self.local_conv_extract(norm_x.transpose(1, 2)).transpose(1, 2)
        fused_total = self.w_global * global_feat + self.w_seq * seq_feat + self.w_local * local_conv
        branch_out = self.drop(self.fusion_proj(fused_total))
        final = self.residual_alpha * x + branch_out
        return final, new_attn_h, new_ffn_h

class CharVocabManager:
    def __init__(self, custom_idx_char: Optional[List[str]] = None):
        if custom_idx_char is not None:
            self.idx_to_char = custom_idx_char
        else:
            self.idx_to_char = ["[PAD]","[UNK]","[CLS]","[MASK]","[SEP]","[BOS]","[EOS]"] + list(train_cfg.valid_token_pool)
        self.char_to_idx = {c: i for i, c in enumerate(self.idx_to_char)}
        self.pad_token_id = 0
        self.unk_token_id = 1
        self.vocab_total_size = len(self.idx_to_char)

    def encode_text(self, text: str) -> List[int]:
        return [self.char_to_idx.get(c, self.unk_token_id) for c in text]

    def decode_ids(self, id_list: List[int]) -> str:
        valid_chars = []
        for tid in id_list:
            if tid not in {self.pad_token_id, 3}:
                valid_chars.append(self.idx_to_char[tid])
        return "".join(valid_chars)

class EAMOriginLM(nn.Module):
    def __init__(self, vocab_size: int, cfg: CoreHyperCfg):
        super().__init__()
        self.cfg = cfg
        self.token_embedding = nn.Embedding(vocab_size, cfg.embed_dim, padding_idx=0)
        self.stack_blocks = nn.ModuleList([EAMMultiFusionBlock(cfg) for _ in range(cfg.stack_layers)])
        self.final_norm = nn.LayerNorm(cfg.embed_dim)
        self.token_head = nn.Linear(cfg.embed_dim, vocab_size, bias=False)
        self.vocab_handler: Optional[CharVocabManager] = None

    def forward(self, token_ids: torch.Tensor):
        emb = self.token_embedding(token_ids)
        attn_hidden_cache = [None] * len(self.stack_blocks)
        ffn_hidden_cache = [None] * len(self.stack_blocks)
        current_feat = emb
        for idx, block in enumerate(self.stack_blocks):
            current_feat, attn_hidden_cache[idx], ffn_hidden_cache[idx] = block(
                current_feat, attn_hidden_cache[idx], ffn_hidden_cache[idx]
            )
        logits = self.token_head(self.final_norm(current_feat))
        return logits

    def _sample_single_token(self, last_logit: torch.Tensor, step_cur: int, total_gen_len: int, history_ids: List[int]) -> int:
        progress_ratio = step_cur / max(total_gen_len, 1)
        current_temp = train_cfg.temp_init - (train_cfg.temp_init - train_cfg.temp_min) * progress_ratio
        logit_scaled = last_logit / current_temp

        if len(history_ids) > 3:
            recent_3 = history_ids[-3:]
            hash_ref = token_hash_vector(self.token_embedding.weight, recent_3)
            all_token_hash = F.normalize(torch.abs(self.token_embedding.weight), p=2, dim=-1)
            hash_sim = torch.matmul(hash_ref, all_token_hash.T).squeeze(0)
            penalty_val = torch.clamp(hash_sim, min=0) * 1.1
            logit_scaled = logit_scaled - penalty_val

        prob_dist = F.softmax(logit_scaled, dim=-1)
        selected_id = torch.multinomial(prob_dist, num_samples=1).item()
        return selected_id

    def auto_generate(self, prompt_text: str, generate_length: int = 30) -> str:
        self.eval()
        if self.vocab_handler is None:
            raise RuntimeError("必须绑定 vocab_handler 词表管理器")
        input_ids = self.vocab_handler.encode_text(prompt_text)
        seq_tensor = torch.tensor(input_ids, device=compute_device).unsqueeze(0)
        history_cache = input_ids.copy()
        with torch.no_grad():
            for _ in range(generate_length):
                if seq_tensor.size(1) >= self.cfg.max_context_len:
                    break
                full_logits = self.forward(seq_tensor)
                last_pos_logit = full_logits[0, -1, :]
                next_tok = self._sample_single_token(last_pos_logit, len(history_cache), generate_length, history_cache)
                seq_tensor = torch.cat([seq_tensor, torch.tensor([[next_tok]], device=compute_device)], dim=1)
                history_cache.append(next_tok)
        return self.vocab_handler.decode_ids(history_cache)

@dataclass
class ExperienceSample:
    input_str: str
    target_str: str
    weight_factor: float = 1.0

class SelfDevelopMemoryPool:
    def __init__(self, cfg: CoreHyperCfg):
        self.cfg = cfg
        self.short_term_mem = deque()
        self.long_term_mem = deque(maxlen=cfg.long_memory_cap)
        self.full_data_record = []

    def push_sample(self, exp: ExperienceSample):
        self.short_term_mem.append(exp)
        self.full_data_record.append(asdict(exp))
        if len(self.full_data_record) > 5000:
            self.full_data_record = self.full_data_record[-3000:]
        self._migrate_short_to_long()

    def _migrate_short_to_long(self):
        while len(self.short_term_mem) > self.cfg.short_memory_cap:
            item = self.short_term_mem.popleft()
            item.weight_factor *= 0.4
            self.long_term_mem.append(item)

    def get_all_samples(self) -> List[ExperienceSample]:
        return list(self.short_term_mem) + list(self.long_term_mem)

    def save_to_file(self):
        store_data = {
            "short": [asdict(i) for i in self.short_term_mem],
            "long": [asdict(i) for i in self.long_term_mem],
            "dataset": self.full_data_record
        }
        with open(train_cfg.memory_store_path, "w", encoding="utf-8") as f:
            json.dump(store_data, f, ensure_ascii=False, indent=2)

    def load_from_file(self):
        try:
            with open(train_cfg.memory_store_path, "r", encoding="utf-8") as f:
                load_data = json.load(f)
            self.short_term_mem.clear()
            self.long_term_mem.clear()
            for d in load_data["short"]:
                self.short_term_mem.append(ExperienceSample(d["input_str"], d["target_str"], d["weight_factor"]))
            for d in load_data["long"]:
                self.long_term_mem.append(ExperienceSample(d["input_str"], d["target_str"], d["weight_factor"]))
            self.full_data_record = load_data["dataset"]
            print("记忆池加载完成")
        except Exception as e:
            print(f"记忆文件加载异常: {str(e)}")

@dataclass
class DualBrainRecord:
    prompt: str
    rational_output: str
    emotional_output: str

class SingleBrainLearner:
    def __init__(self, model: EAMOriginLM, vocab: CharVocabManager, lr: float):
        self.model = model
        self.vocab = vocab
        self.opt = torch.optim.AdamW(self.model.parameters(), lr=lr)
        self.train_step = 0

    def incremental_learn(self, input_txt: str, target_txt: str, loss_weight: float):
        token_seq = self.vocab.encode_text(input_txt + target_txt)
        if len(token_seq) < 2:
            return
        token_tensor = torch.tensor(token_seq, device=compute_device)
        x_input = token_tensor[:-1].unsqueeze(0)
        y_label = token_tensor[1:].unsqueeze(0)
        self.model.train()
        self.opt.zero_grad()
        logits = self.model(x_input)
        loss_val = F.cross_entropy(
            logits.reshape(-1, self.vocab.vocab_total_size),
            y_label.reshape(-1),
            ignore_index=self.vocab.pad_token_id
        )
        total_loss = loss_val * loss_weight
        total_loss.backward()
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
        self.opt.step()
        self.model.eval()
        self.train_step += 1

class DualSymbiosisBrain:
    def __init__(self, rational_model: EAMOriginLM, emotional_model: EAMOriginLM, vocab: CharVocabManager, cfg: CoreHyperCfg):
        self.vocab = vocab
        self.rational_brain = SingleBrainLearner(rational_model, vocab, cfg.interact_learn_rate)
        self.emotional_brain = SingleBrainLearner(emotional_model, vocab, cfg.interact_learn_rate)
        self.memory_pool = SelfDevelopMemoryPool(cfg)
        self.gen_count = 0

    def symbiosis_generate(self, prompt: str, gen_func):
        ctx_cut = prompt[:core_cfg.seq_block_limit * 2]
        emo_text = gen_func(ctx_cut, self.emotional_brain.model)
        rat_text = gen_func(emo_text, self.rational_brain.model)
        return DualBrainRecord(prompt, rat_text, emo_text)

    def feedback_optimize(self, rec: DualBrainRecord, feedback_type: str, correct_text: str, gen_func):
        if feedback_type == "accept":
            sample = ExperienceSample(rec.prompt, rec.rational_output, 1.0)
            self.memory_pool.push_sample(sample)
            self.rational_brain.incremental_learn(rec.prompt, rec.rational_output, 1.0)
            self.emotional_brain.incremental_learn(rec.prompt, rec.emotional_output, 1.0)
        elif feedback_type == "correct" and correct_text.strip():
            sample = ExperienceSample(rec.prompt, correct_text, 2.0)
            self.memory_pool.push_sample(sample)
            self.rational_brain.incremental_learn(rec.prompt, correct_text, 2.0)
            self.emotional_brain.incremental_learn(rec.prompt, correct_text, 2.0)

class AvalancheSelfResetCtrl:
    def __init__(self, layer_list: nn.ModuleList, cfg: CoreHyperCfg):
        self.layers = layer_list
        self.cfg = cfg
        self.last_reset_step = -cfg.avalanche_cool_step

    def step_check_reset(self, global_step: int) -> List[str]:
        if global_step - self.last_reset_step < self.cfg.avalanche_cool_step:
            return []
        if global_step % self.cfg.avalanche_step_gap != 0:
            return []
        total_layer_num = len(self.layers)
        protect_last = 1
        candidate_layers = list(range(total_layer_num - protect_last))
        max_reset_num = max(1, int(total_layer_num * 0.5))
        reset_targets = random.sample(candidate_layers, min(max_reset_num, len(candidate_layers)))
        log_info = []
        for lid in reset_targets:
            block = self.layers[lid]
            attn_module = block.bagua_attn
            nn.init.constant_(attn_module.bagua_logit_bias, -1.8)
            for gru_w in attn_module.time_evo_gru.parameters():
                if gru_w.dim() >= 2:
                    nn.init.xavier_uniform_(gru_w)
                else:
                    nn.init.constant_(gru_w, 0)
            nn.init.xavier_uniform_(attn_module.group_merge_layer.weight)
            log_info.append(f"层{lid} 八卦时序模块雪崩重置完成")
        self.last_reset_step = global_step
        return log_info

def test_bagua_transform():
    print("===== 校验 =====")
    bagua_mod = HyperCubeBaguaTransform(core_cfg).to(compute_device)
    dummy_x = torch.randn(2, 16, core_cfg.embed_dim).to(compute_device)
    out, _ = bagua_mod(dummy_x)
    assert out.shape == dummy_x.shape, f"维度异常 输出:{out.shape}"
    print("四维八卦变换前向传播正常\n")

def test_time_ffn():
    print("===== 自校验 =====")
    ffn_mod = EAMTimeGateFFN(core_cfg).to(compute_device)
    dummy_x = torch.randn(2, 16, core_cfg.embed_dim).to(compute_device)
    out, _ = ffn_mod(dummy_x)
    assert out.shape == dummy_x.shape
    print("时序FFN前向正常\n")

def test_fusion_block():
    print("===== EAM=====")
    block = EAMMultiFusionBlock(core_cfg).to(compute_device)
    dummy_x = torch.randn(2, 16, core_cfg.embed_dim).to(compute_device)
    out, _, _ = block(dummy_x)
    assert out.shape == dummy_x.shape
    print("===融合块维度匹配，卷积时序提取正常n===\n")

def test_full_model_gen():
    print("===== 完整模型前向+自回归生成测试 =====")
    vocab = CharVocabManager()
    full_model = EAMOriginLM(vocab.vocab_total_size, core_cfg).to(compute_device)
    full_model.vocab_handler = vocab
    dummy_ids = torch.randint(0, vocab.vocab_total_size, (2, 16)).to(compute_device)
    logits_out = full_model(dummy_ids)
    assert logits_out.shape == (2, 16, vocab.vocab_total_size)
    print("主干前向传播通过，开始生成测试")
    sample_text = full_model.auto_generate(prompt_text="天地大道", generate_length=20)
    print(f"生成输出：{sample_text}")
    assert isinstance(sample_text, str) and len(sample_text) > 0
    print("自回归生成逻辑正常\n")

def test_memory_system():
    print("===== 分级长短记忆池校验 =====")
    mem = SelfDevelopMemoryPool(core_cfg)
    for i in range(15):
        mem.push_sample(ExperienceSample(f"输入{i}", f"输出{i}", 1.0))
    all_samples = mem.get_all_samples()
    assert len(mem.short_term_mem) == core_cfg.short_memory_cap
    print("长短记忆自动迁移正常")
    mem.save_to_file()
    mem_new = SelfDevelopMemoryPool(core_cfg)
    mem_new.load_from_file()
    assert len(mem_new.get_all_samples()) == len(all_samples)
    print("记忆持久化读写无异常\n")

def test_avalanche_reset():
    print("===== 雪崩自适应重置机制测试 =====")
    vocab_tmp = CharVocabManager()
    test_model = EAMOriginLM(vocab_tmp.vocab_total_size, core_cfg).to(compute_device)
    ava_ctrl = AvalancheSelfResetCtrl(test_model.stack_blocks, core_cfg)
    for step in range(0, 200, core_cfg.avalanche_step_gap):
        reset_log = ava_ctrl.step_check_reset(step)
        if reset_log:
            print(f"训练步{step}: {reset_log}")
    print("雪崩重置流程无报错\n")

def test_dual_brain_interact():
    print("===== 理性/感性双脑共生交互测试 =====")
    vocab = CharVocabManager()
    rat_lm = EAMOriginLM(vocab.vocab_total_size, core_cfg).to(compute_device)
    emo_lm = EAMOriginLM(vocab.vocab_total_size, core_cfg).to(compute_device)
    rat_lm.vocab_handler = vocab
    emo_lm.vocab_handler = vocab
    emo_lm.load_state_dict(rat_lm.state_dict())
    with torch.no_grad():
        for blk in emo_lm.stack_blocks:
            attn = blk.bagua_attn
            attn.bagua_logit_bias += torch.randn_like(attn.bagua_logit_bias) * 0.02
    dual_sys = DualSymbiosisBrain(rat_lm, emo_lm, vocab, core_cfg)
    def gen_wrapper(txt, m):
        return m.auto_generate(txt, generate_length=15)
    record = dual_sys.symbiosis_generate("宇宙万物", gen_wrapper)
    print(f"理性输出：{record.rational_output}")
    print(f"感性输出：{record.emotional_output}")
    dual_sys.feedback_optimize(record, "accept", "", gen_wrapper)
    print("双脑反馈增量学习完成\n")

if __name__ == "__main__":
    random.seed(train_cfg.random_seed)
    torch.manual_seed(train_cfg.random_seed)

    test_bagua_transform()
    test_time_ffn()
    test_fusion_block()
    test_full_model_gen()
    test_memory_system()
    test_avalanche_reset()
    test_dual_brain_interact()

    print("========== 全部自研模块验证==========")