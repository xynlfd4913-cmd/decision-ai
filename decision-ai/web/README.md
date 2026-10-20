# 决策AI网站

本文件记录早期部署说明。当前归档的准确完成程度见 [`项目状态`](../docs/project-status.md)，新环境的运行和部署方式见 [`部署说明`](../docs/deployment.md)。本次没有读取或迁移原生产环境变量。

线上地址：

`https://dualmind-ai-mvp.vercel.app`

后台地址：

`https://dualmind-ai-mvp.vercel.app/admin.html`

## 当前已完成

- ChatGPT 风格对话界面
- 未登录每日免费 3 次
- 已暂时移除会员和充值入口
- 登录后提供退出登录按钮
- DeepSeek 后端分析接口
- 历史记录搜索、下载、删除
- Enter 发送，Shift + Enter 换行
- 邮箱/手机号验证码接口，生产模式不返回测试码
- 后台管理员页面暂时保留，但前台不再展示充值入口
- SEO：title、description、keywords、canonical、Open Graph、结构化数据、robots.txt、sitemap.xml

## 重要环境变量

已经写入 Vercel：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `AUTH_CODE_SECRET`
- `ADMIN_TOKEN`

还需要补齐：

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `ALIYUN_ACCESS_KEY_ID`
- `ALIYUN_ACCESS_KEY_SECRET`
- `ALIYUN_SMS_SIGN_NAME`
- `ALIYUN_SMS_TEMPLATE_CODE`

没有 Upstash Redis 时，验证码、充值申请、后台审核会返回“未配置”，不会假成功。

## 管理员口令

本地生成的后台管理员口令保存在：

`.admin-token.local.txt`

不要提交到公开仓库。

## 当前账号流程

1. 用户可不登录直接使用对话。
2. 点击右上角登录 / 注册，可用邮箱或手机号验证码登录。
3. 登录后右上角显示退出按钮。
4. 退出后回到访客状态。

## 注意

Resend API Key 已经出现在聊天中，正式运营前建议在 Resend 后台重新生成新 Key，并删除旧 Key。
