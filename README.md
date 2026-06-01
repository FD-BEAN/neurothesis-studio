# NeuroThesis Studio

面向 EEG + VR 实验型研究生论文的中文优先研究工作台。

当前 `main` 分支是正式部署的 Next.js 应用，包含 Supabase Auth、私有文件存储和后端 AI API route。旧的 GitHub Pages 静态版保留在 `legacy-static/` 目录中。

## 功能

- 项目总览
- Supabase 登录
- 研究资料库：文献知识库、XDF 原始数据、分析脚本、统计输出和写作材料
- 私有 Storage 临时签名链接
- 文献与写作助手后端接口
- Metro Rescue 研究蓝图
- 3 × 3 × 2 实验条件结构
- 实验设计、marker 逻辑和 XDF 分析队列索引
- LSL marker / EEG 同步逻辑
- LabRecorder XDF 质量检查脚本
- 上传文件后的后台分析摘要、统计表和图表预览
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

## 后台数据分析

资料库现在分成三条主线：

- 文献与论文：上传 PDF 后生成/更新文献知识卡片；写作助手会读取这些卡片，而不是只靠一次性 prompt 回答。
- XDF 原始数据：上传 LabRecorder `.xdf` 后运行 `XDF 高级分析`；可以批量上传并批量提交队列。
- 分析脚本与输出：上传 Python、MATLAB、notebook、CSV/TSV/JSON/XLSX 等分析产物和写作材料。

登录后在研究资料库中选择文件，点击即时摘要入口。当前在线摘要支持：

- CSV / TSV：行列数、数值变量摘要、分类变量分布、坐标散点图。
- JSON / JSONL：将对象数组转成表格后生成摘要。
- SVG：检查图形元素和可读范围图例。
- Markdown / TXT：文本规模和研究关键词频次。
- PDF：提示建立文献知识卡片，不进入 XDF 分析。
- XDF：即时摘要只给出质控入口；正式实验数据分析请使用 `运行 XDF 高级分析`。

## XDF 高级分析

点击 `运行 XDF 高级分析` 会创建 `research_analysis_jobs` 任务，并触发 GitHub Actions 中的 Python worker。worker 只处理 LabRecorder `.xdf`，下载 Supabase private Storage 中的文件，使用 `pyxdf / numpy` 解析 EEG stream 与 Unity marker stream，再把 JSON 报告写回 Supabase。

当前 XDF worker 的目标不是分析 PDF 或 CSV，而是服务这个 VR 地铁撤离研究的核心数据链路：

- 识别 `Mitsar` / EEG stream 与 `MetroRescueMarkers` marker stream。
- 按 `subject / session / map / signage / audio` 切分 marker session。
- 确认 `map_start` 到 `evacuation_complete` 的 EEG 覆盖关系。
- 提取 Unity 行为 marker：`sign_readable`、`decision_point_enter`、停留、扫描、回退和完成时长。
- 计算 trial-level theta、alpha、theta/alpha，以及 `sign_readable` / `decision_point_enter` 事件窗特征。

需要配置：

- Supabase SQL Editor 重新运行 `supabase/schema.sql`，创建 `research_analysis_jobs`。
- Vercel Environment Variables:
  - `GITHUB_ANALYSIS_REPO`
  - `GITHUB_ANALYSIS_WORKFLOW`
  - `GITHUB_ANALYSIS_REF`
  - `GITHUB_ANALYSIS_TOKEN`
- GitHub repo `Settings > Secrets and variables > Actions`:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

`SUPABASE_SERVICE_ROLE_KEY` 只能放在 GitHub Actions Secret，不要放进前端代码或提交到 GitHub。

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
   - `GITHUB_ANALYSIS_REPO`
   - `GITHUB_ANALYSIS_WORKFLOW`
   - `GITHUB_ANALYSIS_REF`
   - `GITHUB_ANALYSIS_TOKEN`
4. Deploy。

## 隐私提醒

不要把真实实验数据、EEG 文件、未公开论文草稿、API key 或个人隐私信息提交到 GitHub repo。真实文件应上传到 Supabase private Storage；API key 只能放在 Vercel 环境变量里。
