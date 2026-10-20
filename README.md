# 决策AI

决策AI项目的整理归档仓库。应用、产品设计和早期模型研究分别存放，主项目位于 [`decision-ai/`](decision-ai/)。

```text
decision-ai/
  web/                          网站前端、Vercel API、测试和环境变量模板
  docs/                         产品蓝图、提示词、部署说明与当前状态
  research/eam-private-ai/       最初的 EAM 模型源码与原始 LICENSE
  archive/                      早期测试样例
```

## 使用网站项目

```powershell
cd decision-ai/web
npm test
npx vercel dev
```

生产部署时，Vercel 的 Root Directory 设为 `decision-ai/web`。环境变量按 [`decision-ai/web/.env.example`](decision-ai/web/.env.example) 配置。

## 当前版本

- 包含职业、情感和人生选择的双脑分析，以及行动建议。
- 支持历史搜索、回看、下载和删除，历史保存在当前浏览器。
- 支持 Enter 发送、Shift+Enter 换行。
- 登录后显示退出入口。前台套餐、会员和充值入口已移除。
- 分析优先调用 DeepSeek；未配置或调用失败时有固定规则的兜底内容。
- 邮箱验证码依赖 Resend 和 Redis；阿里云短信发送尚未实现。
- 每日 3 次限制与账号显示目前由前端本地存储实现。
- 后台充值代码作为历史实现保留，未在当前前台使用。

详细状态见 [`project-status.md`](decision-ai/docs/project-status.md)，部署方式见 [`deployment.md`](decision-ai/docs/deployment.md)。早期蓝图属于历史方案，功能状态以项目状态文档和当前源码为准。

## 归档范围

已收集当前网站、产品蓝图、提示词模板、桌面原始 EAM 项目和线程中的测试样例。原目录中的密钥文件、管理员口令、`.vercel` 配置、缓存和依赖目录不在上传范围内。原文件保留在本机，上传版没有真实密钥。

`decision-ai/docs/file-manifest.json` 记录上传文件的大小与 SHA-256。该清单不包含自身。

## 原始模型

[`research/eam-private-ai/`](decision-ai/research/eam-private-ai/) 为独立的 Python/PyTorch 实验，当前网站没有接入它。原始 README、GPL-3.0 LICENSE、运行日志和样例数据均按原文件归档，未修改其许可证。

整理日期：2026-10-20。
