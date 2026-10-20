const sceneLabels = {
  career: "职业决策",
  relationship: "情感决策",
  life: "人生选择"
};

function fallbackAnalyze({ question, scene, depth }) {
  const label = sceneLabels[scene] || "人生决策";
  const isDeep = depth === "deep";
  const risk = question.includes("投资") || question.includes("借钱") ? "高" : "中";
  return {
    provider: "fallback",
    sceneLabel: label,
    direction: isDeep ? "建议方向：先验证，再行动" : "建议方向：先补信息，再做决定",
    risk,
    rational: [
      "问题本质：你不是只在问“要不要”，而是在权衡成本、风险和承受力。",
      "理性拆解：先确认关键事实，再把不可逆决定拆成可验证的小步骤。",
      isDeep ? "深度提醒：先做低成本测试，验证结果后再放大行动。" : "基础提醒：不要在情绪顶点做决定。"
    ],
    emotional: [
      "你真正难受的点，可能是长期压力和不确定感叠在一起。",
      "你可能没说出口的是：你希望有人认真看见你的处境。",
      "情绪提醒：焦虑是真实信号，但不适合单独作为决策依据。",
      "先允许自己慢一点，把选择拆小，你会更有掌控感。"
    ],
    actions: [
      "写下最担心的 3 个后果",
      "补齐做决定前必须知道的事实",
      "设计一个 7 天内可完成的小测试"
    ]
  };
}

function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeResult(raw, input) {
  const fallback = fallbackAnalyze(input);
  return {
    provider: raw?.provider || "deepseek",
    sceneLabel: raw?.sceneLabel || fallback.sceneLabel,
    direction: raw?.direction || fallback.direction,
    risk: raw?.risk || fallback.risk,
    rational: Array.isArray(raw?.rational) && raw.rational.length ? raw.rational.slice(0, 5) : fallback.rational,
    emotional: Array.isArray(raw?.emotional) && raw.emotional.length ? raw.emotional.slice(0, 5) : fallback.emotional,
    actions: Array.isArray(raw?.actions) && raw.actions.length ? raw.actions.slice(0, 5) : fallback.actions
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { question = "", scene = "life", depth = "basic" } = req.body || {};
  const cleanQuestion = String(question).trim();
  const input = { question: cleanQuestion, scene, depth };

  if (cleanQuestion.length < 8) {
    return res.status(400).json({ error: "Question is too short" });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(200).json(normalizeResult({ provider: "fallback" }, input));
  }

  const systemPrompt = [
    "你是决策AI，一个帮助用户做人生选择的双脑分析助手。",
    "你必须用中文回答，并且只返回 JSON，不要 Markdown。",
    "不要替用户做最终决定，只给出辅助分析。",
    "涉及医疗、法律、投资等高风险事项，要提醒咨询专业人士。",
    "JSON 字段必须是：sceneLabel, direction, risk, rational, emotional, actions。",
    "rational、emotional、actions 都必须是字符串数组。"
  ].join("\n");

  const userPrompt = JSON.stringify({
    sceneLabel: sceneLabels[scene] || "人生决策",
    depth,
    question: cleanQuestion,
    outputShape: {
      sceneLabel: "场景中文名",
      direction: "建议方向",
      risk: "低/中/高",
      rational: ["理性脑要点1", "理性脑要点2", "理性脑要点3"],
      emotional: ["感性脑要点1", "感性脑要点2", "感性脑要点3"],
      actions: ["未来7天行动1", "未来7天行动2", "未来7天行动3"]
    }
  });

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        temperature: depth === "deep" ? 0.4 : 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      return res.status(502).json({
        error: "DeepSeek request failed",
        result: normalizeResult({ provider: "fallback" }, input)
      });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const parsed = extractJson(content);
    return res.status(200).json(normalizeResult(parsed, input));
  } catch {
    return res.status(502).json({
      error: "DeepSeek request failed",
      result: normalizeResult({ provider: "fallback" }, input)
    });
  }
}
