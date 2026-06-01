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
- Deployment: Vercel Hobby
- Source control: GitHub repo `FD-BEAN/neurothesis-studio`
- Production branch: `main`

环境变量：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

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
- 用中性的模块名：研究资料库、实验设计、实验材料、文献与写作助手、数据分析与写作
- UI 中优先使用“场景平面图”“导向标识方案”“实验材料”，少用笼统的“图纸”，不要使用“图纸与刺激材料”这种混合说法
- 用户自己决定研究顺序，系统只提供清楚入口

研究资料库结构：

- 文献与论文：已发表文献、综述、开题材料、论文草稿
- 实验材料：VR 场景平面图、导向标识方案、图注、实验说明
- 原始数据：Unity 日志、LSL marker、EEG 文件、行为数据表
- 分析脚本与输出：Python、MATLAB、notebook、统计表、中间结果
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

## 已发现的研究口径问题

场景图图例半径口径需要统一：

- 图注文档和 SVG 元数据指向 clear radius = 8m、blur end radius = 12m
- SVG 可见图例曾出现 Blue 0-5m / Orange 5-8m
- 建议统一为：
  - 0-8m clear
  - 8-12m blur/fade
  - 12m+ intended unreadable

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

分支策略：

- `main` 是正式部署分支
- 旧静态 GitHub Pages 版本保留在 `legacy-static/`

## 后续优先级

1. 文献库：PDF 自动摘要、关键词、方法、指标、局限、可引用句子
2. 文献矩阵：按 wayfinding / VR evacuation / EEG cognitive load 分类
3. 实验材料模块：把 SVG 场景平面图和图注结构化展示
4. 实验条件表：3×3×2 条件、marker、数据文件命名统一
5. EEG 分析：MNE-Python / EEGLAB 预处理脚本模板
6. 写作模块：英文 Methods、Introduction 证据链、Discussion 风险点

## 给后续开发者或 Codex 的提醒

- 开工前先读这个 wiki。
- 大改前先确认是否会影响 Vercel 部署。
- 真实数据不要提交到 GitHub。
- UI 文案要像研究者自己的工作台，不要像产品宣传。
- 每次发现新需求、新约束、新坑，更新本文件。
