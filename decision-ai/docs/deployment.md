# 本地运行与部署

## 网站

工作目录为 `decision-ai/web`，当前项目使用原生前端和 Vercel Node.js Serverless API，没有前端打包步骤。

```powershell
cd decision-ai/web
npm test
npx vercel dev
```

纯静态页面可以直接打开 `index.html` 预览，但真实 API 需要 Vercel 开发服务器或已部署环境。

## Vercel

从 GitHub 导入仓库后，将 Root Directory 设置为 `decision-ai/web`，框架选择 Other。使用本目录的 `vercel.json`。也可在该目录执行：

```powershell
npx vercel --prod
```

没有复制原 `.vercel` 本地绑定信息；新环境需要重新关联项目。只导入 GitHub 仓库不会自动迁移 Vercel 环境变量。

## 配置

| 变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek 分析接口 |
| `DEEPSEEK_MODEL` | 模型名，源码默认 `deepseek-chat` |
| `AUTH_CODE_SECRET` | 验证码 HMAC 密钥 |
| `RESEND_API_KEY` | 邮箱验证码发送 |
| `RESEND_FROM_EMAIL` | Resend 允许的发件地址 |
| `UPSTASH_REDIS_REST_URL` | Redis REST 地址 |
| `UPSTASH_REDIS_REST_TOKEN` | Redis REST 令牌 |
| `ADMIN_TOKEN` | 保留的历史管理员后台口令 |
| `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` | 短信配置预留，发送实现尚未完成 |
| `ALIYUN_SMS_SIGN_NAME` / `ALIYUN_SMS_TEMPLATE_CODE` | 短信签名和模板预留 |

仓库仅提供 `.env.example` 的空值模板。真实配置在部署平台设置，不属于本次上传文件。

当前示例发件地址是 `onboarding@resend.dev`；正式发信需使用 Resend 允许的地址和已验证域名。页面 canonical、站点地图及 robots.txt 中保留原部署域名，迁移域名时一起更新。

## 原始模型实验

`decision-ai/research/eam-private-ai/` 单独依赖 Python 和 PyTorch，不是运行网站的依赖。原始使用方式与许可证见该目录 README 和 LICENSE；原 `output.txt` 是历史日志，不是本次测试结果。
