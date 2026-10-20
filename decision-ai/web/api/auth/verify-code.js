import {
  deleteCode,
  hashCode,
  isValidAccount,
  readCodeHash,
  safeEqualHash,
} from "../../lib/auth-code-utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const account = String(req.body?.account || "").trim();
  const code = String(req.body?.code || "").trim();
  if (!isValidAccount(account)) return res.status(400).json({ error: "请输入有效的邮箱或中国大陆手机号" });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "请输入6位验证码" });

  try {
    const storedHash = await readCodeHash(account);
    if (!safeEqualHash(storedHash, hashCode(code))) {
      return res.status(400).json({ error: "验证码错误或已过期" });
    }
    await deleteCode(account);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(503).json({
      error: "验证码校验服务未配置或暂不可用",
      detail: error.message,
    });
  }
}
