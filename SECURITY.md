# Security Notes

`main` 分支上的 GitHub Pages 版本是静态站点。GitHub Pages 适合发布 HTML、CSS 和 JavaScript 这类静态文件，但它没有后端会话、数据库权限控制或服务器端 API key 保护。

`next-supabase-secure` 分支使用 Next.js + Supabase Auth + Supabase private Storage + 后端 AI API route，是准备承载真实研究内容的版本。

## 不要放入 public repo 的内容

- 真实论文 PDF
- EEG 原始数据或处理后数据
- 被试信息
- 未公开论文草稿
- OpenAI API key
- 学校/导师/实验室内部资料

## 真实研究阶段建议

真实研究内容应使用带后端的架构：

- 前端：Next.js / React
- 鉴权：Supabase Auth
- 后端：Vercel Functions / Next.js API routes
- 文件：Supabase private Storage
- AI 调用：只在后端保存和调用 API key

这样登录才真正控制谁能读取文件、调用模型和访问研究数据。
