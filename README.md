# NeuroThesis Studio

面向 EEG + VR 实验型研究生论文的中文优先研究工作台。

当前 `main` 分支是正式部署的 Next.js 应用，包含 Supabase Auth、私有文件存储和后端 AI API route。旧的 GitHub Pages 静态版保留在 `legacy-static/` 目录中。

## 功能

- 项目总览
- Supabase 登录
- 研究资料库：文献、场景与标识材料、原始数据、分析脚本和写作材料
- 私有 Storage 临时签名链接
- 文献与写作助手后端接口
- Metro Rescue 研究蓝图
- 3 × 3 × 2 实验条件结构
- 场景与标识配置索引
- LSL marker / EEG 同步逻辑
- LabRecorder XDF 质量检查脚本
- 材料一致性提醒

## 项目 Wiki

长期上下文、设计原则、部署方式和研究决策记录在：

```text
docs/PROJECT_WIKI.md
```

后续继续开发前先读这个文件，并在重要需求或决策变化后更新它。

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

## XDF 质控

LabRecorder 文件进入正式 EEG 分析前，可以先运行：

```powershell
python scripts\xdf_qc.py C:\path\to\file.xdf
```

脚本会检查 stream 数量、Mitsar EEG、MetroRescueMarkers、session 切分、开始/完成 marker 是否齐全。原始 `.xdf` 不要提交到 GitHub。

## Supabase 设置

1. 新建 Supabase project。
2. 在 `Authentication` 里创建用户。
3. 复制 project URL 和 publishable key 到 `.env.local`。新版 Supabase 会显示 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`；旧版可能显示 `NEXT_PUBLIC_SUPABASE_ANON_KEY`，两个变量名都可以。
4. 打开 `SQL Editor`，运行 `supabase/schema.sql`。
5. 确认 `research-files` bucket 是 private。

### 新用户无法登录时

- 登录框必须填写邮箱地址，不能填写用户名。
- 如果 Supabase 提示 `Email not confirmed`，在 `Authentication > Users` 里确认该用户邮箱，或重新创建用户时勾选 `Auto Confirm User`。
- 如果使用的是 `Invite user`，用户需要先接受邀请并设置密码；更简单的方式是用 `Create user` 直接设置 email/password。
- 如果 Vercel 上失败、本地正常，检查 Vercel 环境变量是否和当前 Supabase project 一致。

## Vercel 部署

1. 在 Vercel 导入 GitHub repo。
2. 使用 `main` 分支。
3. 添加环境变量：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL`
4. Deploy。

## 隐私提醒

不要把真实实验数据、EEG 文件、未公开论文草稿、API key 或个人隐私信息提交到 GitHub repo。真实文件应上传到 Supabase private Storage；API key 只能放在 Vercel 环境变量里。
