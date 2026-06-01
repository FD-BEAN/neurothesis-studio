# Security Notes

当前 GitHub Pages 版本是静态站点。GitHub Pages 适合发布 HTML、CSS 和 JavaScript 这类静态文件，但它没有后端会话、数据库权限控制或服务器端 API key 保护。

本项目里的登录页用于产品原型和轻量门禁体验，不能作为真实数据保护方案。原因是前端代码、静态资源和 demo 数据都会随网页一起发送到浏览器，懂技术的人可以绕过前端判断。

## 不要放入 public repo 的内容

- 真实论文 PDF
- EEG 原始数据或处理后数据
- 被试信息
- 未公开论文草稿
- OpenAI API key
- 学校/导师/实验室内部资料

## 真实研究阶段建议

进入真实研究内容后，建议迁移到带后端的架构：

- 前端：Next.js / React
- 鉴权：Supabase Auth、Firebase Auth、Auth0 或自建登录
- 后端：Vercel Functions、Netlify Functions、FastAPI 或 Supabase Edge Functions
- 文件：私有对象存储，例如 Supabase Storage、S3、Cloudflare R2
- AI 调用：只在后端保存和调用 API key

这样登录才真正控制谁能读取文件、调用模型和访问研究数据。
