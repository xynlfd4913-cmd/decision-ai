export function requireAdmin(req, res) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "后台管理员口令未配置" });
    return false;
  }
  const provided = String(req.headers["x-admin-token"] || req.body?.adminToken || req.query?.adminToken || "").trim();
  if (provided !== expected) {
    res.status(401).json({ error: "管理员口令错误" });
    return false;
  }
  return true;
}
