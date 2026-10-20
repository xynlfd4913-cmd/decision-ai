import { redisCommand } from "../../lib/redis.js";

async function readRequest(id) {
  const raw = await redisCommand(["GET", `decision-ai:recharge:${id}`]);
  return raw ? JSON.parse(raw) : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const account = String(req.body?.account || "").trim();
  const requestId = String(req.body?.requestId || "").trim();
  if (!account) return res.status(401).json({ error: "请先登录账号" });

  try {
    if (requestId) {
      const request = await readRequest(requestId);
      if (!request || request.account !== account) return res.status(404).json({ error: "申请不存在" });
      return res.status(200).json({ ok: request.status === "APPROVED", request });
    }
    const ids = await redisCommand(["LRANGE", "decision-ai:recharge:list", 0, 100]);
    for (const id of ids || []) {
      const request = await readRequest(id);
      if (request && request.account === account && request.status === "APPROVED") {
        return res.status(200).json({ ok: true, request });
      }
    }
    return res.status(200).json({ ok: false, message: "暂无已通过的充值申请" });
  } catch (error) {
    return res.status(503).json({ error: "充值查询服务未配置", detail: error.message });
  }
}
