import crypto from "node:crypto";
import { getPlan } from "../../lib/plans.js";
import { redisCommand } from "../../lib/redis.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const account = String(req.body?.account || "").trim();
  const nickname = String(req.body?.nickname || "").trim();
  const plan = getPlan(req.body?.plan);
  if (!account) return res.status(401).json({ error: "请先登录账号" });
  if (!plan) return res.status(400).json({ error: "套餐不存在" });

  const id = `R${Date.now()}${crypto.randomInt(1000, 9999)}`;
  const request = {
    id,
    account,
    nickname,
    plan: plan.id,
    planTitle: plan.title,
    amount: plan.amount,
    credits: plan.credits,
    memberPlan: plan.plan,
    status: "PENDING",
    createdAt: new Date().toISOString(),
    reviewedAt: null,
  };

  try {
    await redisCommand(["SET", `decision-ai:recharge:${id}`, JSON.stringify(request), "EX", 60 * 60 * 24 * 30]);
    await redisCommand(["LPUSH", "decision-ai:recharge:list", id]);
    return res.status(200).json({ ok: true, request });
  } catch (error) {
    return res.status(503).json({ error: "充值申请服务未配置", detail: error.message });
  }
}
