# 当前功能与归档说明

整理日期：2026-10-20。以下结论来自本次归档的源码检查，不代表对线上环境变量或线上服务重新验收。

## 已包含的功能

| 内容 | 当前实现 |
| --- | --- |
| 对话 | 原生 HTML/CSS/JavaScript；职业、情感、人生选择；基础和深度分析 |
| 分析接口 | Vercel `POST /api/analyze`；DeepSeek；配置缺失或错误时规则兜底 |
| 历史 | localStorage；搜索、回看、TXT 下载、删除；最多 50 条 |
| 输入 | Enter 发送；Shift+Enter 换行；中文输入法组合输入时不触发发送 |
| 账号 | 验证码入口、前端登录显示、退出；当前没有服务端会话 |
| 免费次数 | 当前浏览器 localStorage 按 UTC 日期记录，每日 3 次 |
| SEO | 标题、描述、canonical、Open Graph、JSON-LD、robots.txt、sitemap.xml |

## 外部服务与完成程度

- DeepSeek：有真实 API 调用代码。实际使用需配置 `DEEPSEEK_API_KEY`。
- 邮箱验证码：有 Resend 发送与 Redis 存储、验证代码。需有效的发件域名和服务配置。
- 手机验证码：`lib/auth-code-utils.js` 的 `sendSmsCode()` 仍为占位实现，即使配置阿里云参数也会报未完成。
- 当前登录成功后仅写入本地账号信息；退出删除本地账号信息。没有服务端登录会话、跨设备历史同步或权限控制。
- 每日次数没有在服务端执行，直接调用分析 API 不受这个前端计数约束。
- 原始 EAM 模型没有与网站推理接口连接；已有日志记录过生成过程的矩阵维度错误。本次仅归档，没有运行模型训练或修复模型。

## 会员与充值

按最后一次前台调整，当前页面没有会员、套餐或充值入口，基础和深度分析共用免费次数。

下列文件为历史实现，因本次要求整理所有项目文件而保留：

- `web/admin.html`、`web/admin.js`
- `web/api/admin/`、`web/api/recharge/`
- `web/lib/admin-auth.js`、`web/lib/plans.js`
- `web/assets/admin-wechat.jpg`、`web/assets/wechat-pay.jpg`

保留文件不等于当前开放收费。旧充值申请按传入账号标识记录，管理员口令用于审核；它没有完整的服务端用户会话和权益账本。

## 本地校验

现有测试覆盖分析接口的兜底与输入校验，以及验证码未配置时失败、不返回测试码的行为。不包含真实邮件投递、短信发送、实际支付或管理员端到端审核验收。

## 来源

- 网站：原 `outputs/dualmind-ai-mvp/`。
- 蓝图与提示词：原输出目录中的两份 Markdown 文档。
- EAM 原始代码：原桌面 `eam-private-ai-HyperCubeBaguaTransform/`。
- 早期样例：原线程目录中的 `test_memory.json`。

本次只整理副本和补充交接文档，原网站代码与部署未做功能变更。
