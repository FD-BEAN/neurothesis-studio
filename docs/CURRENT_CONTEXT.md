# NeuroThesis Studio 当前上下文

更新时间：2026-06-05

这份文档用于保存当前项目上下文。以后如果 Codex 临时目录、聊天窗口或记忆状态变化，优先阅读本文件和 `docs/PROJECT_WIKI.md`。

## 1. 项目定位

NeuroThesis Studio 是一个中文科研工作台，主要给神经工程管理方向的研究生论文使用。

目标不是普通 dashboard，而是把以下工作放在一个系统里：

- 管理研究资料和文献 PDF。
- 建立可审阅、可继续扩展的文献知识库。
- 上传和管理 LabRecorder `.xdf` 实验数据。
- 分析 EEG stream 和 Unity marker stream。
- 生成可下载的 HTML 分析报告。
- 辅助中文论文写作，最好能直接生成论文小节、段落和结果写法。

系统语言应以中文为主，表达要科研、清楚、自然。避免过度产品化、AI 味很重、替用户安排任务的文案。

## 2. 项目目录和部署状态

实际项目目录：

```text
C:\Python\neurothesis-studio
```

之前 Codex 临时目录 `C:\Users\Jingbin\Documents\Codex\2026-05-31\codex` 已经不存在，但项目本身没有丢。

主要技术栈：

- Next.js
- Supabase Auth
- Supabase private Storage
- Vercel
- GitHub Actions Python worker
- OpenAI API 用于文献和写作辅助

GitHub repo：

```text
FD-BEAN/neurothesis-studio
```

最近相关提交：

```text
d6751a5 Clarify cohort covariate analysis wording
a248711 Clarify between-participant analysis wording
97778c3 Refine Chinese writing tone
```

最近一次已知状态：Vercel 对 `d6751a5` 显示 deployment completed。

## 3. 研究主题

研究方向是 VR 地铁应急疏散场景中的路径确认、导向标识和认知负荷。

核心关键词：

- 神经工程管理
- VR 地铁应急疏散
- EEG / 脑电
- Unity marker
- LabRecorder XDF
- 路径确认信息链
- 导向标识 / 指示牌
- 标识密度
- 低 / 中 / 高路径确认支持
- 行动迟滞
- 路径判断准确率
- 信息加工负荷
- EEG 事件窗

重点事件通常包括：

- `map_start`
- `evacuation_complete`
- `sign_visible_enter`
- `sign_readable`
- `decision_point_enter`
- `audio_play`
- 左右查看、扫描、回退、掉头等行为 marker

## 4. 实验设计和文件命名

正式实验预期：

- 90 名被试。
- 每名被试 3 个实验 run。
- 总计 270 个 XDF 文件。

文件编号规则：

```text
sub001 / sub002 / sub003 = P01
sub004 / sub005 / sub006 = P02
sub007 / sub008 / sub009 = P03
...
```

不要把 `sub003` 写成被试编号。`sub001` 到 `sub270` 是实验文件序号；分析层面的被试编号应使用 `P01` 到 `P90`。

条件映射：

```text
Signature1 = low / 低路径确认支持 / 低密度
Signature2 = medium / 中路径确认支持 / 中密度
Signature3 = high / 高路径确认支持 / 高密度
```

当前论文口径优先使用：

```text
路径确认支持水平
Density condition
Route-confirmation support level
```

如果后续确认 Signature 同时包含颜色、图形、方向、文字量等其他操纵，Methods 里需要单独写清。

## 5. 主假设和统计口径

当前核心假设：

中等路径确认支持 / 中等标识密度条件可能带来最高认知负荷和行动迟滞。

主 planned contrast：

```text
medium - mean(low, high)
```

等价权重：

```text
low = -1
medium = 2
high = -1
```

单名被试只做方向性观察，不能报告显著性。正式显著性需要汇总 P01-P90 的 subject-level contrast。

推荐主分析：

```text
contrast_i = medium_i - (low_i + high_i) / 2
```

然后对 90 名被试的 `contrast_i` 做 one-sample test，或在 mixed-effects model 中检验等价 contrast。

推荐 run/trial-level 模型：

```text
Load ~ SupportLevel + RunOrder + Map + (1 + SupportLevel | Subject)
```

个体差异或调节分析需要额外被试信息表：

```text
Load ~ SupportLevel * ParticipantCovariate + RunOrder + Map + (1 + SupportLevel | Subject)
```

重要口径：

- 不要默认使用 `group`。
- 不填被试信息 CSV 时，只做全样本主 contrast。
- 被试信息 CSV 只用于解释个体差异或调节效应。
- 可选字段包括 `sex`、`age`、`vr_experience`、`spatial_ability`、`run_order`、`counterbalance`、`instruction_type`。

## 6. XDF 分析目标

XDF 分析应服务正式论文，而不是只做简单文件预览。

分析层级：

1. 单 run 质控  
   检查 EEG stream、Unity marker stream、时间覆盖、采样率、marker 完整性和事件窗数量。

2. 单被试三条件分析  
   把同一被试低 / 中 / 高 3 个 XDF 合并，生成 subject-level support table。

3. 全样本主分析  
   汇总 P01-P90 的 `medium - mean(low, high)`，检验主假设。

4. 事件窗分析  
   围绕 `sign_readable`、`decision_point_enter`、`audio_play` 等 marker 提取 EEG 和行为指标。

5. 行为机制指标  
   包括完成时间、首次行动延迟、决策点停留、左右查看、扫描、回退、掉头、路径准确率等。

6. 个体差异 / 协变量分析  
   需要被试信息表，不能默认从文件编号里推断。

## 7. Marker 过滤和统计风险

当前最需要注意的风险：

- marker 过滤不能根据显著性结果事后调整。
- 相同 marker 在极短时间内重复出现可以去重，但左右查看、重复阅读标识、反复扫描本身可能是行为证据，不能随便删除。
- 应只分析 `map_start` 到 `evacuation_complete` 之间的 trial window。
- 如果一个 XDF 中存在多个 trial 或 session，需要明确切分规则。
- 缺少 completion marker、EEG 覆盖不足、事件窗太少的 run 应进入 QC 和排除记录。
- 组合指数可以用，但不能只靠组合指数证明主假设。
- 主指标、次指标、探索指标必须分层。

建议主指标：

- 行为主指标：行动迟滞相关指标，例如首次行动延迟、决策点停留、路径确认迟滞指数。
- EEG 主指标：decision_point_enter 事件窗附近的 theta/alpha 或 EEG information-processing load index。
- 辅助指标：完成时间、正确率、sign_readable 事件窗负荷、回退和扫描行为。

如果主假设不显著，不等于论文失败。可以检查：

- 操纵是否真的造成低 / 中 / 高路径确认支持差异。
- 中等支持是否提高了准确率但增加了加工成本。
- EEG 是否比行为指标更敏感，或相反。
- 个体差异是否掩盖了主效应。
- marker 覆盖和 EEG 噪声是否影响统计效力。

## 8. 页面结构偏好

当前希望的主导航顺序：

1. 项目概览
2. 数据分析与写作
3. 文献写作助手
4. 研究资料库
5. 知识库审阅

页面设计偏好：

- 中文为主。
- 模块化。
- 不要替用户决定“今天先做什么”。
- 不要过度解释功能。
- 不要把 dashboard 做成很刻意的产品广告。
- XDF 分析结果不要在 dashboard 里长篇展示，生成可下载 HTML report。
- 大量文件管理应以文件和被试矩阵为中心，方便处理 270 个 XDF。

## 9. 文献知识库和写作助手

用户已经提供过一批文献、知识库 bundle、研究介绍、PPT 和 PDF。

知识库目标：

- 不只是文献摘要。
- 每篇文章应有自己的结构化知识体系。
- 结构要相对统一，但不被死板字段限制。
- 能服务中文论文写作。
- 新论文以后可以继续叠加。
- 旧文献和新上传文献不要表现成两套体系。
- 能审阅每篇文献的知识卡。
- 能知道 S01、S02 等来源代码对应哪篇文章。
- PDF 应尽量入库并可打开，标题尽量使用文章真实标题。

写作助手目标：

- 不是只给建议，而是直接写论文小节、段落、结果模板、讨论边界。
- 最终论文是中文。
- 写作要自然、具体，减少模板感和 AI 味。
- 结果部分只能使用真实分析产物中的统计量；没有结果时必须留占位符，不能假装显著。

## 10. 当前代码中重要模块

常用文件：

```text
app/page.tsx
scripts/advanced_analysis_worker.py
lib/xdfNaming.ts
lib/unityMarkerDictionary.ts
lib/knowledgeBase.ts
lib/literature_article_kb.json
docs/PROJECT_WIKI.md
```

前端主要功能在 `app/page.tsx`。

XDF 高级分析 worker 在：

```text
scripts/advanced_analysis_worker.py
```

XDF 命名和 P01-P90 规则在：

```text
lib/xdfNaming.ts
```

Unity marker 字典和分析管线说明在：

```text
lib/unityMarkerDictionary.ts
```

知识库结构和项目固定知识在：

```text
lib/knowledgeBase.ts
```

## 11. 最近一次重要修改

最近一次修改解决了“组间怎么还是 group”的问题。

已改动：

- 页面从“全样本与被试间分析”改成“全样本统计”。
- “被试间变量列名”改成“协变量列名（可选）”。
- 默认 CSV 不再使用 `participant_id,group`。
- 按钮改成“生成全样本 HTML 报告”。
- Python worker 生成的 HTML 报告也改成“被试信息 / 协变量 / 个体差异或调节分析”。
- wiki 和知识库设计卡同步改掉旧口径。

最新提交：

```text
d6751a5 Clarify cohort covariate analysis wording
```

## 12. 下一步建议

优先级最高的后续工作：

1. 继续严格化 XDF worker 的 marker 过滤、trial window 选择和 QC 记录。
2. 把 HTML report 做得更像正式科研报告，包括主结果、图表、QC、敏感性分析和可写入论文的中文段落。
3. 固定主指标和探索指标，避免多指标选择造成结果解释风险。
4. 重构文献知识卡，让每篇文章都有更强的单篇知识体系。
5. 提升文献写作助手，让它能直接生成中文论文小节，而不是只输出建议。
6. 完善 270 个 XDF 文件的管理视图，包括 P01-P90 矩阵、状态、下载报告和失败处理。

