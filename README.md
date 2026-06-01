# NeuroThesis Studio

面向 EEG + VR 实验型研究生论文的中文优先研究工作台。

当前 `next-supabase-secure` 分支是安全版 Next.js 应用，包含 Supabase Auth、私有文件存储和后端 AI API route。旧的 GitHub Pages 静态版保留在 `legacy-static/` 目录中。

## 功能

- 项目总览
- Supabase 登录
- 私有论文 / 数据文件上传
- 私有 Storage 临时签名链接
- AI 研究助手后端接口
- Metro Rescue 研究蓝图
- 3 × 3 × 2 实验条件结构
- 图纸与图注索引
- LSL marker / EEG 同步逻辑
- 材料一致性提醒

## 本地开发

```powershell
npm install
copy .env.example .env.local
npm run dev
```

然后打开：

```text
http://localhost:3000
```

## Supabase 设置

1. 新建 Supabase project。
2. 在 `Authentication` 里创建用户。
3. 复制 project URL 和 publishable key 到 `.env.local`。新版 Supabase 会显示 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`；旧版可能显示 `NEXT_PUBLIC_SUPABASE_ANON_KEY`，两个变量名都可以。
4. 打开 `SQL Editor`，运行 `supabase/schema.sql`。
5. 确认 `research-files` bucket 是 private。

## Vercel 部署

1. 在 Vercel 导入 GitHub repo。
2. 选择 `next-supabase-secure` 分支。
3. 添加环境变量：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL`
4. Deploy。

## 隐私提醒

不要把真实实验数据、EEG 文件、未公开论文草稿、API key 或个人隐私信息提交到 GitHub repo。真实文件应上传到 Supabase private Storage；API key 只能放在 Vercel 环境变量里。
