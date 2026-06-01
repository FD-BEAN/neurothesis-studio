# NeuroThesis Studio Project Wiki

这个文件是项目的长期上下文。后续继续开发时，先读这里，再改代码。

## 项目定位

NeuroThesis Studio 是给中国研究生使用的私人论文研究工作台，不是面向公众展示的产品官网。

当前核心用户是神经工程管理方向研究生，论文主题围绕：

- EEG
- VR 地铁撤离 / 逃生路线
- 导向标识 / signage / wayfinding
- 不同认知负荷
- Unity 行为日志
- LSL marker
- LabRecorder `.xdf`
- Python / MATLAB 分析
- 英文论文写作，同时保留中文解释

产品应该像一个安静、可长期使用的研究桌面，而不是刻意展示功能的 SaaS dashboard。

## 当前技术架构

- Framework: Next.js
- Auth: Supabase Auth
- Private files: Supabase Storage bucket `research-files`
- File metadata: Supabase table `research_documents`
- AI backend: Next.js API route `/api/ai/research-assistant`
- Lightweight analysis: Next.js API route `/api/data/analyze`
- Advanced analysis: GitHub Actions Python worker `.github/workflows/analysis-worker.yml`
- Deployment: Vercel Hobby
- Source control: GitHub repo `FD-BEAN/neurothesis-studio`
- Production branch: `main`

环境变量：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `GITHUB_ANALYSIS_REPO`
- `GITHUB_ANALYSIS_WORKFLOW`
- `GITHUB_ANALYSIS_REF`
- `GITHUB_ANALYSIS_TOKEN`

GitHub Actions secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

不要提交：

- `.env.local`
- `secrets.py`
- OpenAI key
- Supabase service role key
- 真实未公开论文、EEG 原始数据、个人隐私数据

## 部署流程

本地修改后：

```powershell
cd C:\Python\neurothesis-studio
git status
git add .
git commit -m "描述这次修改"
git push origin main
```

推送到 `main` 后，Vercel 会自动重新部署。

如果只改 Vercel 环境变量，需要在 Vercel 里手动 Redeploy。

## 设计原则

界面语言优先中文，英文只在必要的论文术语、变量名、文件格式和 API 名称中出现。

视觉方向：

- 安静、克制、研究桌面感
- 少营销感，少技术炫耀
- 少大指标卡和“系统能力展示”
- 技术实现隐藏到设置或状态里
- 主界面做模块入口和资料状态，不替用户安排“今天做什么”
- 模块命名要像科研项目管理语言，不要像临时口语拼接

更像：

- Zotero 的文献管理
- Notion 的研究笔记
- 实验室项目台账
- 论文写作工作区

不像：

- 投资人 demo
- SaaS landing page
- 过度包装的 dashboard
- 像教练一样替研究者决定优先级的任务页

首页文案注意：

- 不写“今天先做什么”
- 不写“把材料整理成可以写进论文的证据”这类过度设计感句子
- 用中性的模块名：研究资料库、实验设计、文献与写作助手、数据分析与写作
- 场景平面图与导向标识资料暂时只作为研究背景存档，不作为主界面模块展示；不要在当前界面反复强调这条线
- 用户自己决定研究顺序，系统只提供清楚入口

研究资料库结构：

- 文献与论文：已发表文献、综述、开题材料、论文草稿，并可生成结构化知识卡片
- XDF 原始数据：LabRecorder `.xdf`、EEG stream、Unity marker stream 和正式实验数据
- 分析脚本与输出：Python、MATLAB、notebook、统计表、中间结果、写作材料
- 研究笔记：读书笔记、讨论记录、图表说明、写作备忘

## 研究内容结构

实验设计：

- 3 个地图布局：Metro1 / Metro2 / Metro3
- 3 个标识方案：Signature1 / Signature2 / Signature3
- 2 个音频负荷条件：Low / High
- 共 18 个实验组合

材料文件：

- `Metro1_Signature1_L1_plan.svg`
- `Metro1_Signature2_L1_plan.svg`
- `Metro1_Signature3_L1_plan.svg`
- `Metro2_Signature1_L1_plan.svg`
- `Metro2_Signature2_L1_plan.svg`
- `Metro2_Signature3_L1_plan.svg`
- `Metro3_Signature1_L1_plan.svg`
- `Metro3_Signature2_L1_plan.svg`
- `Metro3_Signature3_L1_plan.svg`
- `研究图纸与图注.md`

注意：真实材料不要提交到 public repo。上传到 Supabase private Storage。

## 2026-06-01 新材料检查结论

这批材料包括 Unity 场景平面图、标识坐标表、场景尺度说明、研究介绍文档，以及两份 LabRecorder `.xdf` 测试数据。

场景尺度与可读性口径：

- Unity 单位按 1 unit = 1 m 处理。
- L1 安全包络约为 x = -50..50、z = -28..52，约 100 m × 80 m。
- 主站厅区域约 52 m × 30 m，墙高约 4.2 m。
- 吊挂标识缩放后 y 约为 2.82-2.85 m。
- 标识可读范围已统一为：0-8 m 清晰，8-12 m 模糊/渐隐，12 m 以外保留可见但不可读。新 SVG 图例已经显示 0-8m / 8-12m。
- 场景平面图中的圆只表示距离和可读性范围，不模拟墙体遮挡；运行时 marker 还需要结合正反面判断。

标识坐标表：

- `signage_coordinates.csv` 是当前实验口径表，共 66 个标识点。
- Metro1 每个 Signature 7 个点，Metro2 每个 Signature 8 个点，Metro3 每个 Signature 7 个点。
- `signage_coordinates_all_scene_roots.csv` 共 69 行，包含 Metro1 的 `Service_Emergency` 旧 root；正式实验口径里 Metro1 的该点已排除，Metro2 的 Sign_08 保留。
- 同一地图内 Signature1 / Signature2 / Signature3 的标识点数量与坐标一致，因此 SVG 和坐标表只能证明空间布局一致，不能证明三套 Signature 的操控差异。

研究假设与统计口径：

- 当前核心假设可以写成：检验 Signature2 是否相对 Signature1 和 Signature3 带来更高认知负荷。
- 论文里不要直接写成已经证明 Signature2 更高；应写成 planned contrast，并等待 EEG/行为数据支持。
- 建议 trial-level mixed model：`Load ~ Signature + Metro + Audio + TrialOrder + (1 | Subject)`。
- 主 planned contrast：Signature2 vs Signature1/Signature3 平均值，即 `[-1, 2, -1]`；同时报告 S2-S1 与 S2-S3。
- 需要另建 `signature_manipulation_table.csv`，记录每个 Signature 的贴图、文字信息密度、出口数量、箭头数量、决策相关性、冗余度、歧义度和朝向说明。

XDF 测试数据：

- `sub-P001_ses-S001_task-Default_run-001_eeg_old3.xdf` 更像一条完整测试 trial：包含 `MetroRescueMarkers` 与一个 `Mitsar` EEG stream；主 session 为 subject 005 / Metro2 / Signature3 / Low，marker 有 `session_start`、`trial_start`、`map_start` 和 `evacuation_complete`。
- `sub-P001_ses-S001_task-Default_run-001_eeg.xdf` 包含 `MetroRescueMarkers` 和两个 `Mitsar` EEG stream；主 session 为 subject 006 / Metro3 / Signature1 / Low，有 `evacuation_complete`，但缺少完整开始 marker，并混入少量旧 subject/session marker。
- 正式分析前必须先做 XDF 质控：列出 streams、选择 EEG stream、按 subject/session/map/signature/audio 切分 markers，确认开始与完成事件齐全，再导出 `xdf_quality_report`。
- 重要口径：正式实验分析对象是 LabRecorder `.xdf` 中的 EEG stream + Unity marker stream。PDF、CSV、SVG、研究说明文档只作为文献、刺激材料或辅助索引，不应被包装成主实验数据分析。

当前产品应支持的下一步：

- 研究资料库按文献知识库、XDF 原始数据、分析脚本与输出、研究笔记分区显示。
- 增加或保留 XDF 质控入口，用于判断一个文件是否能进入正式 EEG 预处理。
- 不把 `.xdf`、未公开论文、真实实验日志提交到 GitHub；只保存脚本、schema、wiki 和 UI。

## 后台数据分析模块

第一版在线分析采用确定性解析，不自动把上传文件内容发送给 OpenAI：

- API route: `/api/data/analyze`
- 权限：使用当前 Supabase access token 读取 `research_documents` 和 private Storage，保持 RLS 生效。
- CSV / TSV：输出行列数、数值字段摘要、分类字段分布、坐标散点图；对 `map`、`signature`、`x`、`z`、`clear_radius_m` 等字段做 Metro Rescue 口径识别。
- JSON / JSONL：把对象数组转成表格后走同一套分析。
- SVG：检查 circle/text/title 元素数量和 0-8m / 8-12m 图例。
- Markdown / TXT：统计文本规模和 EEG / VR / Unity / LSL / Signature 等关键词频次。
- XDF：Node route 只做入口说明；正式实验数据分析交给 GitHub Actions Python worker，避免把 EEG 二进制当作普通表格处理。

XDF 在线图表的当前路线：

1. 上传 XDF 后只存原文件，不直接进 OpenAI。
2. 后端任务调用 Python worker 下载 private Storage 中的 XDF。
3. Worker 解析 EEG stream 与 Unity marker stream，输出 JSON 到 `research_analysis_jobs.result_json`。
4. 前端展示 stream 表、session 表、event count、trial 行为指标、EEG 覆盖 QC、频带特征和事件窗摘要。

## XDF 高级分析 worker

第二层分析链路已经按异步 job 设计：

- 数据表：`research_analysis_jobs`
- 创建任务 API：`/api/analysis/jobs`
- 运行环境：GitHub Actions `analysis-worker.yml`
- Worker 脚本：`scripts/advanced_analysis_worker.py`
- Python 依赖：`scripts/analysis_requirements.txt`

任务流程：

1. 用户在资料库选择 LabRecorder `.xdf` 并点击 XDF 高级分析。
2. Vercel API 用当前 Supabase access token 验证文件归属，并写入 `research_analysis_jobs`。
3. Vercel API 用 `GITHUB_ANALYSIS_TOKEN` 触发 GitHub Actions workflow。
4. Python worker 用 GitHub Secret 中的 `SUPABASE_SERVICE_ROLE_KEY` 下载 private Storage 文件。
5. Worker 输出 JSON 报告并写回 `result_json`。
6. 前端轮询任务表，完成后可查看结果。

当前 Python worker 只支持 XDF，这是刻意设计的边界。PDF、Markdown、SVG、CSV 等材料仍走即时摘要或 AI 助手，不进入正式 EEG+Unity marker 分析流水线。

XDF worker 目前输出：

- stream 概览：识别 `Mitsar` / EEG stream 与 `MetroRescueMarkers` marker stream。
- marker session：按 `subject / session / map / signage / audio` 切分，检查开始 marker 与 `evacuation_complete`。
- trial 行为指标：完成时长、`sign_readable`、`decision_point_enter`、停留、扫描、回退等事件计数。
- EEG 覆盖 QC：确认 EEG 是否覆盖 `map_start` 到 `evacuation_complete`，估计有效采样率和样本覆盖率。
- EEG 通道 QC：标出 flat、event channel、高方差或缺失通道候选。
- EEG 频带特征：trial-level theta、alpha、beta、theta/alpha，以及 sign_readable / decision_point_enter / audio_play 事件窗摘要。

## 资料分区边界

2026-06-01 后的产品边界：

- 文献与论文：只做文献知识库。上传 PDF 后生成/更新“知识卡片”，卡片包含研究问题、方法、EEG/行为指标、主要发现、局限、可用于论文哪个章节等。AI 写作助手必须优先读取这些卡片，并用论文标题或文件名引用来源。
- XDF 原始数据：只放 LabRecorder `.xdf`、EEG 原始文件和正式实验数据。XDF 高级分析只处理这里的 EEG stream + Unity marker stream。
- 分析脚本与输出：放 Python/MATLAB/notebook、trial_features、event_features、中间统计表和写作产物。后续 90 名被试 × 3 trials = 270 个实验文件，应走批量上传和批量提交 XDF 队列。
- 场景平面图与导向标识配置暂时不作为主要界面模块展示，避免干扰当前文献库和 XDF 分析主线。
- 不把真实论文 PDF、XDF、EEG 原始数据或被试数据提交到公开 GitHub repo 的 `data` 目录。公开 GitHub 只保存代码、schema、wiki 和可公开的模板；私有数据优先放 Supabase private Storage。
- GitHub Actions 的 `SUPABASE_SERVICE_ROLE_KEY` 可以使用新版 `sb_secret_...` 或旧版 JWT `service_role`。worker 请求头需要区分两者：新版 secret key 只放 `apikey`，旧版 JWT 才放 `Authorization: Bearer ...`。
- 文件管理界面必须以“文件为中心”呈现分析状态：XDF 文件旁边直接显示未提交、排队、运行、完成、失败、疑似卡住；任务队列支持状态筛选和进度条。270 个实验文件不能只靠一串卡片堆叠。
- XDF 正式分析必须支持“被试批量任务”：同一被试的 2-3 个 XDF run 一起提交，先逐 run 做 QC，再汇总成 subject-level run table。组内因素包括 Signature、Metro/map、audio/cognitive-load；组间因素需要用户额外提供 subject metadata 表，例如 subject_id、group、age、sex、VR experience、实验顺序/分组等。
- 运行完成、失败、配置错误、疑似卡住的任务应该能从界面删除，避免历史错误任务堆积影响判断。

用户提供的 XDF 报告脚本参考：

- `xdf_report.py`：适合作为 XDF/marker/stream QC 报告参考，包括 primary EEG stream 选择、完整 session 选择、EEG 覆盖、事件数量、时间线、音频间隔、出口/距离字段和行为负荷代理指标。
- `xdf_eeg_analysis_report.py`：适合作为 EEG 事件窗报告参考，包括 frontal theta、posterior alpha、theta/alpha ratio、sign_readable / decision_point_enter / audio_play 事件窗，以及跨 run 的 z-score/load index 汇总。
- 当前 GitHub Actions worker 已吸收其中的核心思路：只处理 `.xdf`，输出 stream/session/behavior/EEG QC、trial-level 频带特征和事件锁定 EEG 表；后续可继续把 HTML 报告渲染与跨被试汇总页面接入前端。

限制：

- GitHub Actions 不是实时交互内核，适合“提交任务、稍后看结果”。
- 大型 EEG 预处理、滤波、ICA、artifact rejection、epoch 和正式 MNE 报告可以继续在这个 worker 上扩展，但需要明确数据量和运行时间。
- `SUPABASE_SERVICE_ROLE_KEY` 只允许放在 GitHub Actions Secret，不放在 Vercel 前端环境变量，也不写入仓库。

## 已发现的研究口径问题

场景图图例半径口径已经基本统一：

- 以新材料为准：0-8m clear，8-12m blur/fade，12m+ intended unreadable。
- 如果论文图注、Unity 配置或后续导出图再次出现 0-5m / 5-8m，应立即修正。

Signature 方案需要补充定义：

- 当前已知 9 张 SVG 中同一地图的标识点数量和位置一致
- Signature1/2/3 可能代表贴图、信息设计或朝向配置差异
- Methods 里必须说明每个 Signature 操作的具体含义

## AI 助手边界

AI 可以协助：

- 文献摘要
- 双语文献矩阵
- Methods 初稿
- 图注
- marker 逻辑说明
- EEG 分析计划
- Python / MATLAB 分析脚本草稿

AI 不应该：

- 编造实验结果
- 编造统计显著性
- 编造不存在的引用
- 替代真实数据分析
- 把未上传材料当作已知事实

## 当前实现决策

上传文件时：

- 页面显示原始文件名
- Supabase Storage path 使用 ASCII 安全文件名
- 这样可以避免中文、括号、站点水印等字符触发 `Invalid key`

登录方式：

- 使用 Supabase email/password
- 旧静态版的 `wondernionio / neuro1204` 已不再是正式认证方式
- 登录框需要邮箱地址，不能直接使用用户名。
- 新用户无法登录时优先检查 Supabase Auth 用户是否已确认邮箱；私人工具可以在创建用户时勾选 Auto Confirm User。
- 使用 Invite user 时，用户需要先接受邀请并设置密码；更直接的方式是在 Dashboard 里 Create user 并设置 email/password。

分支策略：

- `main` 是正式部署分支
- 旧静态 GitHub Pages 版本保留在 `legacy-static/`

## 后续优先级

1. 文献知识库：PDF 生成结构化知识卡片，包含研究问题、方法、指标、局限、可引用章节和与本研究的关系
2. 文献矩阵：按 wayfinding / VR evacuation / EEG cognitive load 分类，并支持写作助手引用来源
3. XDF 质控：stream 检查、session 切分、marker 完整性、EEG stream 选择
4. EEG 分析：MNE-Python / EEGLAB 预处理脚本模板和 trial/event-level 特征表
5. 批量实验数据：支持 90 名被试 × 3 次实验的 XDF 上传、排队和结果汇总
6. 写作模块：英文 Methods、Introduction 证据链、Discussion 风险点
7. 场景与标识配置：当前暂不作为主界面模块，未来确有需要再恢复

## 给后续开发者或 Codex 的提醒

- 开工前先读这个 wiki。
- 大改前先确认是否会影响 Vercel 部署。
- 真实数据不要提交到 GitHub。
- UI 文案要像研究者自己的工作台，不要像产品宣传。
- 每次发现新需求、新约束、新坑，更新本文件。
