import {
  accountType,
  createCode,
  isValidAccount,
  sendEmailCode,
  sendSmsCode,
  storeCode,
} from "../../lib/auth-code-utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const account = String(req.body?.account || "").trim();
  if (!isValidAccount(account)) {
    return res.status(400).json({ error: "请输入有效的邮箱或中国大陆手机号" });
  }

  const type = accountType(account);
  const code = createCode();

  try {
    await storeCode(account, code);
    if (type === "email") await sendEmailCode(account, code);
    else await sendSmsCode(account, code);
    return res.status(200).json({
      ok: true,
      message: type === "email" ? "验证码已发送到邮箱" : "验证码已发送到手机",
    });
  } catch (error) {
    return res.status(503).json({
      error: "验证码服务未配置或发送失败",
      detail: error.message,
    });
  }
}
