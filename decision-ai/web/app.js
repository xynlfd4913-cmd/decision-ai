const state = {
  usageLimit: 3,
};

const samples = {
  career: "我现在工作很累，老板也不认可我，但我还有房租压力。我到底要不要辞职？",
  relationship: "我和对象经常吵架，他说会改，但每次都一样。我到底要不要分手？",
  life: "我想离开现在的城市，但又怕去了新城市重新开始太难。我应该走吗？",
};

const sceneData = {
  career: {
    label: "职业决策",
    rational: ["确认现金流能撑多久", "不要在情绪顶点辞职", "先用面试验证外部机会", "把离职条件写成清单"],
    emotional: ["你累的可能不是工作量，而是长期不被看见", "你想辞职，也许是在找回掌控感", "害怕房租压力很正常", "先承认这份工作已经消耗你"],
    actions: ["列出存款和每月固定支出", "更新简历并投递 10 个岗位", "和上级做一次边界沟通"],
  },
  relationship: {
    label: "情感决策",
    rational: ["不要只听承诺，要看行动", "记录问题是否重复发生", "明确自己的底线", "给关系一个可观察期限"],
    emotional: ["你舍不得的可能是曾经的好", "你害怕分开，也害怕继续受伤", "你希望被认真对待并不过分", "先把自己的感受放回重要位置"],
    actions: ["写下不可接受的 3 条底线", "约定 14 天观察期", "记录对方是否有具体修复"],
  },
  life: {
    label: "人生选择",
    rational: ["先做低成本试探", "计算迁移成本", "验证新城市机会是否真实", "保留回撤方案"],
    emotional: ["你想离开，也许是在找新的可能性", "害怕重新开始很正常", "困住你的可能是没有选择感", "你可以先证明这条路可行"],
    actions: ["做一份迁移预算表", "联系 3 个新城市同行或朋友", "安排一次 3-7 天实地体验"],
  },
};

function $(id) {
  return document.getElementById(id);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getUser() {
  const raw = localStorage.getItem("decision_ai_user");
  return raw ? JSON.parse(raw) : null;
}

function saveUser(user) {
  localStorage.setItem("decision_ai_user", JSON.stringify(user));
}

function logout() {
  localStorage.removeItem("decision_ai_user");
  refreshUserUi();
  showToast("已退出登录");
}

function getUsage() {
  const raw = localStorage.getItem("decision_ai_usage");
  const data = raw ? JSON.parse(raw) : {};
  if (data.date !== todayKey()) return { date: todayKey(), used: 0 };
  return { date: todayKey(), used: data.used || 0 };
}

function saveUsage(usage) {
  localStorage.setItem("decision_ai_usage", JSON.stringify(usage));
}

function updateUsageUi() {
  const usage = getUsage();
  $("usageText").textContent = `${Math.max(0, state.usageLimit - usage.used)} / ${state.usageLimit}`;
}

function consumeUsage() {
  const usage = getUsage();
  if (usage.used >= state.usageLimit) return false;
  usage.used += 1;
  saveUsage(usage);
  updateUsageUi();
  return true;
}

function getHistory() {
  const raw = localStorage.getItem("decision_ai_history");
  return raw ? JSON.parse(raw) : [];
}

function saveHistory(item) {
  const history = getHistory();
  history.unshift(item);
  localStorage.setItem("decision_ai_history", JSON.stringify(history.slice(0, 50)));
}

function refreshUserUi() {
  const user = getUser();
  const authButton = $("openAuthBtn");
  const logoutButton = $("logoutBtn");
  if (user) {
    $("accountName").textContent = user.name || "决策AI用户";
    $("accountId").textContent = user.account;
    authButton.textContent = user.name || "已登录";
    authButton.classList.add("logged-in");
    logoutButton.classList.remove("hidden");
  } else {
    $("accountName").textContent = "访客用户";
    $("accountId").textContent = "未登录也可免费体验";
    authButton.textContent = "登录 / 注册";
    authButton.classList.remove("logged-in");
    logoutButton.classList.add("hidden");
  }
}

function setAuthMode(mode) {
  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.authMode === mode);
  });
  const label = document.querySelector("#accountLabel span");
  const input = $("accountInput");
  if (mode === "phone") {
    label.textContent = "手机号码";
    input.placeholder = "13800000000";
    input.inputMode = "tel";
  } else {
    label.textContent = "邮箱地址";
    input.placeholder = "name@example.com";
    input.inputMode = "email";
  }
}

function validateAccount(account) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account) || /^1[3-9]\d{9}$/.test(account);
}

function openAuthModal(message = "") {
  $("authModal").classList.remove("hidden");
  $("authHint").textContent = message || "请输入邮箱或手机号，接收验证码后登录。";
  $("accountInput").focus();
}

function closeAuthModal() {
  $("authModal").classList.add("hidden");
}

async function sendCode() {
  const account = $("accountInput").value.trim();
  if (!validateAccount(account)) {
    $("authHint").textContent = "请先输入正确的邮箱或中国大陆手机号码。";
    return;
  }
  const button = $("sendCodeBtn");
  button.disabled = true;
  button.textContent = "发送中";
  try {
    const response = await fetch("/api/auth/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "send failed");
    $("authHint").textContent = data.message || "验证码已发送，请查收后填写。";
  } catch {
    $("authHint").textContent = "验证码发送失败：请确认真实邮箱/短信服务已配置。";
  } finally {
    button.disabled = false;
    button.textContent = "发送验证码";
  }
}

async function verifyAndLogin() {
  const account = $("accountInput").value.trim();
  const name = $("nameInput").value.trim();
  const code = $("codeInput").value.trim();
  if (!validateAccount(account)) {
    $("authHint").textContent = "请输入正确的邮箱或中国大陆手机号码。";
    return;
  }
  if (!/^\d{6}$/.test(code)) {
    $("authHint").textContent = "请输入 6 位验证码。";
    return;
  }
  try {
    const response = await fetch("/api/auth/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, code }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "verify failed");
    saveUser({ account, name: name || "决策AI用户" });
    closeAuthModal();
    refreshUserUi();
    showToast("登录成功");
  } catch {
    $("authHint").textContent = "验证码不正确、已过期，或验证码服务暂不可用。";
  }
}

function buildResult(question, scene, depth) {
  const data = sceneData[scene];
  const isDeep = depth === "deep";
  return {
    id: Date.now(),
    question,
    scene,
    sceneLabel: data.label,
    createdAt: new Date().toLocaleString("zh-CN"),
    direction: isDeep ? "建议方向：先验证，再行动" : "建议方向：先补信息，再做决定",
    risk: question.includes("投资") || question.includes("借钱") ? "高" : "中",
    rational: [
      "问题本质：你不是只在问“要不要”，而是在权衡成本、风险和承受力。",
      `理性拆解：${data.rational.join("；")}。`,
      isDeep ? "深度提醒：把不可逆决定拆成可逆测试，先验证，再放大。" : "基础提醒：先补齐关键事实，不要在情绪顶点做决定。",
    ],
    emotional: [
      `你真正难受的点：${data.emotional[0]}。`,
      `你可能没说出口的话：${data.emotional[1]}。`,
      `情绪提醒：${data.emotional[2]}。`,
      data.emotional[3],
    ],
    actions: data.actions,
  };
}

async function requestAnalysis(question, scene, depth) {
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, scene, depth }),
    });
    const data = await response.json();
    const result = data.result || data;
    if (!response.ok && !data.result) throw new Error(data.error || "Analyze failed");
    return {
      id: Date.now(),
      question,
      scene,
      sceneLabel: result.sceneLabel,
      createdAt: new Date().toLocaleString("zh-CN"),
      direction: result.direction,
      risk: result.risk,
      rational: result.rational,
      emotional: result.emotional,
      actions: result.actions,
      provider: result.provider || data.provider || "api",
    };
  } catch {
    return buildResult(question, scene, depth);
  }
}

function addMessage(role, html) {
  const wrapper = document.createElement("article");
  wrapper.className = `message ${role}`;
  wrapper.innerHTML = `
    <div class="avatar">${role === "user" ? "你" : "决"}</div>
    <div class="message-body">${html}</div>
  `;
  $("chatMessages").appendChild(wrapper);
  wrapper.scrollIntoView({ behavior: "smooth", block: "end" });
}

function renderResult(result) {
  const rational = result.rational.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const emotional = result.emotional.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const actions = result.actions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  addMessage("assistant", `
    <h3>${escapeHtml(result.sceneLabel)}分析</h3>
    <p><strong>${escapeHtml(result.direction)}</strong>，风险等级：${escapeHtml(result.risk)}</p>
    <div class="result-grid">
      <section class="result-card rational">
        <h3>理性脑</h3>
        <ul>${rational}</ul>
      </section>
      <section class="result-card emotional">
        <h3>感性脑</h3>
        <ul>${emotional}</ul>
      </section>
    </div>
    <section class="decision-card">
      <h3>下一步行动卡</h3>
      <ol>${actions}</ol>
      <p>提醒：决策AI只做辅助分析，不替你做最终决定。涉及医疗、法律、投资等高风险事项，请咨询专业人士。</p>
    </section>
  `);
}

function renderHistory() {
  const list = $("historyList");
  const keyword = $("historySearch")?.value.trim().toLowerCase() || "";
  const history = getHistory().filter((item) => {
    const text = `${item.question} ${item.sceneLabel} ${item.createdAt}`.toLowerCase();
    return !keyword || text.includes(keyword);
  });
  if (!history.length) {
    list.innerHTML = `<div class="history-item empty"><strong>暂无匹配记录</strong><span>完成分析后可搜索回看</span></div>`;
    return;
  }
  list.innerHTML = history.map((item) => `
    <div class="history-item" data-history-id="${item.id}">
      <button class="history-open" type="button" data-history-action="open" title="打开历史记录">
        <strong>${escapeHtml(item.question)}</strong>
        <span>${escapeHtml(item.sceneLabel)} · ${escapeHtml(item.createdAt)}</span>
      </button>
      <div class="history-actions" aria-label="历史记录操作">
        <button type="button" data-history-action="download" title="下载这条记录">下载</button>
        <button type="button" data-history-action="delete" title="删除这条记录">删除</button>
      </div>
    </div>
  `).join("");
}

function openHistoryItem(id) {
  const item = getHistory().find((entry) => String(entry.id) === String(id));
  if (!item) return;
  startNewChat();
  addMessage("user", `<p>${escapeHtml(item.question)}</p>`);
  renderResult(item);
}

function deleteHistoryItem(id) {
  localStorage.setItem("decision_ai_history", JSON.stringify(getHistory().filter((entry) => String(entry.id) !== String(id))));
  renderHistory();
  showToast("历史记录已删除");
}

function downloadHistoryItem(id) {
  const item = getHistory().find((entry) => String(entry.id) === String(id));
  if (!item) return;
  const blob = new Blob([formatHistoryText(item)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `decision-ai-${item.id}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("历史记录已下载");
}

function formatHistoryText(item) {
  return [
    "决策AI历史记录",
    `时间：${item.createdAt || ""}`,
    `场景：${item.sceneLabel || ""}`,
    `问题：${item.question || ""}`,
    "",
    `建议方向：${item.direction || ""}`,
    `风险等级：${item.risk || ""}`,
    "",
    "理性脑：",
    ...(item.rational || []).map((text, index) => `${index + 1}. ${text}`),
    "",
    "感性脑：",
    ...(item.emotional || []).map((text, index) => `${index + 1}. ${text}`),
    "",
    "下一步行动：",
    ...(item.actions || []).map((text, index) => `${index + 1}. ${text}`),
  ].join("\n");
}

async function handleSubmit(event) {
  event.preventDefault();
  const input = $("questionInput");
  const question = input.value.trim();
  const scene = $("sceneSelect").value;
  const depth = $("depthSelect").value;
  if (question.length < 8) {
    $("inputHint").textContent = "请至少输入 8 个字，让决策AI能理解背景。";
    return;
  }
  if (!consumeUsage()) {
    $("inputHint").textContent = "今日免费 3 次已用完，请明天再来。";
    return;
  }
  addMessage("user", `<p>${escapeHtml(question)}</p>`);
  $("inputHint").textContent = "正在生成双脑分析...";
  const result = await requestAnalysis(question, scene, depth);
  renderResult(result);
  saveHistory(result);
  renderHistory();
  input.value = "";
  $("inputHint").textContent = "可以继续输入下一个问题。";
}

function startNewChat() {
  $("chatMessages").innerHTML = `
    <article class="message assistant">
      <div class="avatar">决</div>
      <div class="message-body">
        <h2>今天想分析哪个选择？</h2>
        <p>你可以直接免费体验 3 次。登录后可保存账号状态，也可以随时退出。</p>
        <div class="quick-prompts">
          <button class="quick-prompt" data-scene="career" type="button">我要不要辞职？</button>
          <button class="quick-prompt" data-scene="relationship" type="button">我要不要分手？</button>
          <button class="quick-prompt" data-scene="life" type="button">我要不要换城市？</button>
        </div>
      </div>
    </article>
  `;
  bindQuickPrompts();
}

function bindQuickPrompts() {
  document.querySelectorAll(".quick-prompt").forEach((button) => {
    button.addEventListener("click", () => {
      const scene = button.dataset.scene;
      $("sceneSelect").value = scene;
      $("questionInput").value = samples[scene];
      $("questionInput").focus();
    });
  });
}

function showToast(text) {
  const toast = $("toast");
  toast.textContent = text;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 1800);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode));
});

$("sendCodeBtn").addEventListener("click", sendCode);
$("loginBtn").addEventListener("click", verifyAndLogin);
$("openAuthBtn").addEventListener("click", () => openAuthModal());
$("logoutBtn").addEventListener("click", logout);
$("closeAuthBtn").addEventListener("click", closeAuthModal);
$("authModal").addEventListener("click", (event) => {
  if (event.target.id === "authModal") closeAuthModal();
});
$("historySearch").addEventListener("input", renderHistory);
$("historyList").addEventListener("click", (event) => {
  const item = event.target.closest("[data-history-id]");
  if (!item) return;
  const action = event.target.closest("[data-history-action]")?.dataset.historyAction || "open";
  if (action === "download") return downloadHistoryItem(item.dataset.historyId);
  if (action === "delete") return deleteHistoryItem(item.dataset.historyId);
  openHistoryItem(item.dataset.historyId);
});
$("newChatBtn").addEventListener("click", startNewChat);
$("composerForm").addEventListener("submit", handleSubmit);
$("questionInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("composerForm").requestSubmit();
  }
});

bindQuickPrompts();
updateUsageUi();
refreshUserUi();
renderHistory();
