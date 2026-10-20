import { requireAdmin } from "../../lib/admin-auth.js";
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
  if (!requireAdmin(req, res)) return;

  try {
    const ids = await redisCommand(["LRANGE", "decision-ai:recharge:list", 0, 100]);
    const requests = [];
    for (const id of ids || []) {
      const request = await readRequest(id);
      if (request) requests.push(request);
    }
    return res.status(200).json({ ok: true, requests });
  } catch (error) {
    return res.status(503).json({ error: "后台列表服务未配置", detail: error.message });
  }
}
