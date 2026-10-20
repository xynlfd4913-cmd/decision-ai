import { requireAdmin } from "../../lib/admin-auth.js";
import { redisCommand } from "../../lib/redis.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!requireAdmin(req, res)) return;

  const id = String(req.body?.id || "").trim();
  const action = String(req.body?.action || "").trim();
  if (!id || !["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "缺少申请ID或审核动作" });
  }

  try {
    const key = `decision-ai:recharge:${id}`;
    const raw = await redisCommand(["GET", key]);
    if (!raw) return res.status(404).json({ error: "申请不存在" });
    const request = JSON.parse(raw);
    request.status = action === "approve" ? "APPROVED" : "REJECTED";
    request.reviewedAt = new Date().toISOString();
    await redisCommand(["SET", key, JSON.stringify(request), "EX", 60 * 60 * 24 * 30]);
    return res.status(200).json({ ok: true, request });
  } catch (error) {
    return res.status(503).json({ error: "后台审核服务未配置", detail: error.message });
  }
}
