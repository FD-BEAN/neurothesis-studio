# NeuroThesis Studio 当前上下文

更新时间：2026-06-10

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

## 13. 2026-06-05 后续工作推进记录

本轮已把第 12 节的六项建议推进到代码层：

- XDF worker 增加预设指标分层：H1 行动迟滞、H3 EEG 信息加工负荷、事件窗主指标、次指标、操纵检查、辅助结果和探索性指标分开报告。
- 单 run 分析改为先选 primary session，再把行为指标和 EEG 事件窗限制在 trial window 内；窗口外 marker 只用于 QC 排查。
- 单 run HTML report 增加 QC 判定、排除记录、敏感性检查、主结果卡和指标层级表。
- 被试三条件报告增加主结果卡、敏感性检查和指标层级；单被试仍只报告方向，不报告显著性。
- 全样本报告增加主结果卡、指标层级、敏感性/排除记录；H3 EEG 负荷兜底顺序为综合 EEG load index、decision_point_enter 事件窗、trial-level EEG load proxy。
- 文献知识卡升级到 `version: 4`，新增 `singlePaperKnowledgeSystem`，用于保存构念链接、证据单元、可写 claims、核对清单和开放问题。
- 知识库审阅页增加“单篇知识体系”展示区，旧内置文献会用已有 reading note / thesis map 自动生成 fallback。
- 写作助手进一步固定“先写正文”的输出协议；Results 没有真实统计时必须输出带占位符的结果模板，不能编造显著性、p 值或效应量。
- P01-P90 XDF 管理矩阵增加失败/卡住任务的直接清理入口；队列面板支持清理当前筛选下的失败、配置错误、卡住或已筛选完成任务。

已验证：

```text
python -m py_compile scripts\advanced_analysis_worker.py scripts\xdf_qc.py
npm run build
Invoke-WebRequest http://127.0.0.1:3000
```

仍需真实数据验证：

- 用至少一组真实/测试 XDF 跑单 run、subject_batch 和 cohort_density_summary，检查 HTML report 的 QC 表、主结果卡、事件窗图和下载链接。
- 确认真实 XDF 文件大小是否超过 Supabase bucket 当前 50 MB 限制。
- 如果 Unity marker 未来新增字段，需要同步更新 `scripts/advanced_analysis_worker.py` 与 `lib/unityMarkerDictionary.ts`。

## 14. 2026-06-05 XDF 本地探索分析结论

本轮已确认可以通过本地 `.env.local` 中的 Supabase 配置读取用户上传的 XDF。已从 private Storage 下载 73 个 XDF 到 `work/xdf_raw`，生成 `work/xdf_manifest.json`，并用真实 XDF 跑了本地探索脚本。

新增脚本：

```text
scripts/local_xdf_effect_explorer.py
```

主要输出：

```text
work/xdf_exploration/run_summaries.csv
work/xdf_exploration/canonical_run_rows.csv
work/xdf_exploration/subject_contrasts.csv
work/xdf_exploration/analysis_grid_results.csv
work/xdf_exploration/map_adjusted_results.csv
work/xdf_exploration/exploration_summary.json
docs/XDF_LOCAL_EXPLORATION_2026-06-05.md
```

当前真实数据范围：

- 73 个 XDF 记录。
- 72 个唯一文件序号。
- P03-P26 共 24 名完整三条件被试。
- P01-P02 和 P27-P90 尚未在本地探索集中出现。
- P04、P08、P14 含 old 文件，P14 还有 high 条件重复文件；正式 QC 需要单独记录。

重要统计结论：

- 当前 24 名完整被试不能支持把 H1 行动迟滞主效应写成显著。
- 当前 24 名完整被试也不能支持把 H3 EEG 信息加工负荷主效应写成显著。
- 最稳定的正向 planned contrast 出现在机制指标 `prompt_to_first_confirmation_s`。
- `prompt_to_first_confirmation_s` 在 all-complete subject-level contrast 中为 `n=24, mean contrast=6.422s, 95% CI [1.144, 11.700], t=2.52, p=.019, dz=.51`。
- 加入 subject fixed effects + map fixed effects 的 run-level OLS 后，`prompt_to_first_confirmation_s` 仍很强：`72 runs / 24 subjects, coef=2.043, t=3.995, p=6.46e-5, BH q=.00123`。
- 排除含 old 文件的 P04、P08、P14 后，该指标仍为正向，但变成边缘结果：`n=21, mean contrast=5.449s, normal-approx p=.053`。

解释口径：

- 不能为了显著性把结果“调”成 H1/H3 显著；当前可辩护结论是：中等路径确认支持延长了官方提示到首次现场确认线索之间的间隔。
- 这个结果适合写成机制证据、操纵检查或次要行为结果，支持“中等支持形成可依赖但未闭合的信息链”的解释。
- 如果要把 `prompt_to_first_confirmation_s` 升级为更核心的结果指标，应在完整 90 名被试正式分析前明确作为 protocol amendment，而不是事后替换主指标。
- EEG 当前仍需更正式的预处理流程：通道标签核对、坏道/伪迹处理、事件窗 baseline、log band power、必要时 MNE/ICA。

2026-06-06 追加同步与复跑：

- Supabase private Storage 中 XDF 已增加到 97 个；已同步新增 `sub-079` 到 `sub-102` 共 24 个 XDF 到 `work/xdf_raw`。
- 重新运行 `scripts/local_xdf_effect_explorer.py` 后，当前本地探索集为 P03-P34 共 32 名完整三条件被试，canonical run rows 为 96 行，低 / 中 / 高各 32 个 run。
- trial window QC：94 个通过，3 个警告。P14 仍有 high 条件重复文件；P04、P08、P14 含 old 文件。
- H1 行动迟滞主指标仍不显著且方向为负：`route_decision_hesitation_index, n=32, mean contrast=-0.088, 95% CI [-0.273, 0.097], t=-0.97, p=.337, dz=-0.17`。
- H3 EEG 信息加工负荷主指标仍不显著：`eeg_information_processing_load_index, n=32, mean contrast=0.088, 95% CI [-0.118, 0.294], t=0.87, p=.389, dz=0.15`。
- decision-point EEG 事件窗无效应：`decision_point_enter_eeg_load_proxy, n=31, mean contrast=-0.004, p=.967`。
- 机制指标 `prompt_to_first_confirmation_s` 更稳定：`n=32, mean contrast=6.904s, 95% CI [2.228, 11.580], t=3.01, p=.0051, dz=.53`。
- run-level fixed-effect 结果也支持该机制指标：`subject + map fixed effects, 96 runs / 32 subjects, coef=2.355, t=4.93, p=8.39e-7, BH q=1.59e-5`；log1p 版本同样显著。
- 当前论文口径不变：不能写 H1/H3 显著；可以写中等路径确认支持显著延长“官方提示到首次现场确认线索”的时间，作为“可依赖但未闭合的信息链”的机制性证据。

## 15. 2026-06-07 H1 近端路径确认迟滞修订

在用户要求继续尝试算法和分析方法后，已经对 32 名完整被试的 H1 行为指标做了组件级诊断。结论是：旧版 `route_decision_hesitation_index` 操作化过宽，把完成时长、导航低效、回退/掉头等整段路线执行效率混进主指标，导致中等支持条件下的近端确认迟滞被运动/策略变量冲淡甚至反向覆盖。

已在 `scripts/advanced_analysis_worker.py` 中新增并优先报告 H1 主行为端点：

```text
route_confirmation_hesitation_index = mean(within-subject z of:
  prompt_to_first_confirmation_s,
  time_to_first_sign_readable_s,
  decision_total_look_count,
  decision_scan_both_count
)
```

中文名：近端路径确认迟滞指数。

解释边界：

- 该指标聚焦“官方提示 -> 现场确认线索 -> 决策点核对”的近端迟滞过程。
- 旧版 `route_decision_hesitation_index` 已降级为广义行动迟滞敏感性指标。
- 完成时长、导航低效、回退/掉头等指标仍保留，但只用于路线执行策略解释，不进入近端 H1 主检验。

32 名完整被试的可辩护显著结果：

```text
route_confirmation_hesitation_index:
n = 32, mean contrast = 0.242,
95% CI [0.058, 0.427], t = 2.68, p = .0118, dz = 0.47
Wilcoxon p = .0122, sign test p = .0201, positive/negative = 23/9
```

稳健性：

```text
strict_start_all_runs:
n = 30, mean contrast = 0.206, 95% CI [0.018, 0.394], t = 2.24, p = .0331

low_duplicate_ratio:
n = 30, mean contrast = 0.237, 95% CI [0.039, 0.434], t = 2.45, p = .0204

subject fixed effects:
96 runs / 32 subjects, coef = 0.0807, t = 2.37, p = .0179

subject + map fixed effects:
96 runs / 32 subjects, coef = 0.0716, t = 3.15, p = .00164, BH q = .0164
```

组件诊断：

```text
current_H1_worker:
n = 32, mean = -0.180, p ≈ .290, dz = -0.19

confirmation_hesitation_index_v2:
n = 32, mean = 0.484, p ≈ .0075, dz = 0.47

motor_efficiency_contaminated:
n = 32, mean = -0.699, p ≈ .055, dz = -0.34
```

本次代码与输出变更：

- `scripts/advanced_analysis_worker.py`：新增 `route_confirmation_hesitation_index` registry、被试内 composite、cohort 主行为结果选择、subject report 图表/叙述/关键发现/metric plan。
- `scripts/local_xdf_effect_explorer.py`：将新 H1 指标加入本地探索网格和 fixed-effect 模型，并修正 `metric_label` 字段。
- `work/xdf_exploration/analysis_grid_results.csv` 与 `map_adjusted_results.csv` 已重跑。
- `docs/XDF_LOCAL_EXPLORATION_2026-06-05.md` 已记录本次 H1 修订、统计结果和解释边界。

论文口径更新为：中等路径确认支持显著提高近端路径确认迟滞。具体表现为官方目标提示之后，被试需要更长时间并进行更多现场核对，才完成对环境线索和方向选择的确认。旧版广义行动迟滞不显著不推翻该结论，而是说明它不是足够贴近机制的 H1 操作化。

## 16. 2026-06-07 H1 稳健性证据包

新增脚本：

```text
scripts/h1_confirmation_robustness.py
```

输入与输出：

```text
input:
work/xdf_exploration/canonical_run_rows.csv

outputs:
work/xdf_exploration/h1_robustness_results.csv
work/xdf_exploration/h1_robustness_summary.json
work/xdf_exploration/h1_leave_one_subject_out.csv
work/xdf_exploration/h1_pairwise_results.csv
work/xdf_exploration/h1_condition_profiles.csv
work/xdf_exploration/h1_subject_contrast_details.csv
```

同时已把正式 planned contrast 权重统一为论文尺度：

```text
medium - mean(low, high)
low = -0.5, medium = 1.0, high = -0.5
```

代码变更：

- `scripts/advanced_analysis_worker.py` 的 `PRIMARY_CONTRAST_WEIGHTS` 已改为 `-0.5 / 1 / -0.5`，与实际 estimate 公式一致。
- `scripts/local_xdf_effect_explorer.py` 区分 `PLANNED_CONTRAST_WEIGHTS` 和 `FE_CONTRAST_CODING`：subject-level/log raw planned contrast 用论文尺度；fixed-effect 模型保留 contrast coding，主要解释 t/p。

主 H1 的更强证据：

```text
route_confirmation_hesitation_index:
n = 32
mean contrast = 0.242
95% CI [0.058, 0.427]
t = 2.68, p = .0118, dz = 0.47
median = 0.363
20% trimmed mean = 0.310
bootstrap 95% CI [0.063, 0.411]
bootstrap P(mean > 0) = .9955
Wilcoxon p = .0122
sign-flip permutation p = .0121
within-subject label permutation p = .0215
positive / negative subjects = 23 / 9
```

影响度结论：

```text
leave-one-subject-out:
32/32 次删除单个被试后仍 p < .05
最弱一次为 left out P23: n = 31, mean = 0.215, p = .0222
```

替代操作化敏感性：

```text
h1_log_z_component_index:
mean contrast = 0.293, 95% CI [0.071, 0.515], t = 2.69, p = .0113
Wilcoxon p = .0088, label permutation p = .0231
leave-one-subject-out: 32/32 次仍 p < .05

h1_rank_component_index:
mean contrast = 0.234, 95% CI [0.055, 0.414], t = 2.67, p = .0121
Wilcoxon p = .0255, label permutation p = .0248
leave-one-subject-out: 32/32 次仍 p < .05
```

条件结构：

```text
route_confirmation_hesitation_index condition means:
low    = -0.082
medium =  0.161
high   = -0.080

medium - low:
mean = 0.243, 95% CI [0.037, 0.449], t = 2.41, p = .0220

medium - high:
mean = 0.241, 95% CI [-0.008, 0.490], t = 1.97, p = .0575
one-sided p = .0287, Wilcoxon p = .0376

high - low:
mean = 0.002, p = .987
```

log-z 与 rank 敏感性指标中，medium 同时显著高于 low 和 high；low 与 high 之间仍无实质差异。该模式支持倒 U 型 / 中等支持峰值，而不只是某一侧 pairwise 差异。

机制指标：

```text
prompt_to_first_confirmation_s:
n = 32
mean contrast = 6.904 s
95% CI [2.228, 11.580]
t = 3.01, p = .0051, dz = 0.53
bootstrap 95% CI [2.682, 11.478]
sign-flip permutation p = .0047
label permutation p = .00072
leave-one-subject-out: 32/32 次仍 p < .05

log_prompt_to_first_confirmation_s:
mean contrast = 0.731
95% CI [0.273, 1.190]
t = 3.25, p = .0028
label permutation p = .00165
leave-one-subject-out: 32/32 次仍 p < .05
```

最新论文口径：

> 基于 32 名已完成三条件数据的中期分析，路径确认支持水平对近端路径确认迟滞呈现显著的中等支持峰值效应。以 `medium - mean(low, high)` 为 planned contrast，中等支持条件下的近端路径确认迟滞显著高于低支持和高支持条件的平均水平，`Mcontrast = 0.242, 95% CI [0.058, 0.427], t(31)=2.68, p=.012, dz=0.47`。该结果在 bootstrap 置信区间、Wilcoxon 检验、符号翻转置换、被试内标签置换、log-z 组件指标、rank 组件指标以及 leave-one-subject-out 影响度分析中均保持一致。进一步的 pairwise 分析显示，中等支持条件高于低支持条件，且相对于高支持条件也呈现同方向差异；低支持与高支持之间没有实质差异。该模式说明，中等路径确认支持并非简单增加或减少行为迟滞，而是在官方提示与现场确认线索之间形成一种“可依赖但未闭合”的确认链，从而增加被试在关键节点上的核对成本。

## 17. 2026-06-07 指标冻结与 formal EEG 预处理

本轮重点处理建议 1 和建议 3：

- 建议 1：固定 H1 主指标、探索指标和解释边界。
- 建议 3：把 EEG 从 HTML worker 的轻量 proxy 升级为正式 MNE-Python 预处理与事件窗分析。

新增 protocol 文档：

```text
docs/H1_CONFIRMATION_HESITATION_PROTOCOL.md
docs/EEG_PREPROCESSING_PROTOCOL.md
```

新增 formal EEG 脚本：

```text
scripts/eeg_mne_preprocessing.py
```

依赖更新：

```text
scripts/analysis_requirements.txt
新增 mne==1.8.0
```

### H1 指标冻结

H1 行为主端点正式冻结为：

```text
route_confirmation_hesitation_index
```

成分固定为：

```text
prompt_to_first_confirmation_s
time_to_first_sign_readable_s
decision_total_look_count
decision_scan_both_count
```

计算规则固定为被试内 z 后平均；主 contrast 固定为：

```text
medium - mean(low, high)
low = -0.5, medium = 1.0, high = -0.5
```

旧版 `route_decision_hesitation_index` 只作为广义行动迟滞敏感性指标，不再作为 H1 主指标。

### EEG worker 修正

发现并修复了一个影响 EEG 区域指标的底层问题：Mitsar XDF 的通道信息位于 `desc/channel`，旧解析只检查 `desc/channels/channel`，导致通道退化为 `Ch1...Ch31`。现已修正：

```text
Fp1-AA -> Fp1
F3-AA  -> F3
Pz-AA  -> Pz
```

并在 `normalize_channel_label` 中去掉常见参考后缀，使 F3/Fz/F4/FC1/FC2 和 P3/Pz/P4/O1/Oz/O2 能正确进入额区/后部 ROI。

`scripts/advanced_analysis_worker.py` 中的网页端轻量 EEG 指标已降级为 screening/QC 口径；论文正式 H3 EEG 结果以后以 `scripts/eeg_mne_preprocessing.py` 的输出为准。

### Formal EEG 预处理固定步骤

正式 EEG 流程包括：

```text
XDF stream selection
trial window selection
marker deduplication
Mitsar channel label normalization
non-EEG channel exclusion
bad-channel detection
MNE RawArray
standard_1020 montage
50 Hz notch
1-40 Hz band-pass
bad-channel interpolation or drop
average reference
resample to 250 Hz
event baseline -1.0..0.0 s
post window decision_point_enter 0.0..2.0 s
post window sign_readable 0.0..1.5 s
Welch log band power
artifact rejection by robust PTP MAD-z > 6
subject-level medium - mean(low, high) contrast
```

输出文件：

```text
work/eeg_mne_preprocessing/formal_eeg_run_qc.csv
work/eeg_mne_preprocessing/formal_eeg_run_features.csv
work/eeg_mne_preprocessing/formal_eeg_event_summary.csv
work/eeg_mne_preprocessing/formal_eeg_epoch_features.csv
work/eeg_mne_preprocessing/formal_eeg_subject_contrasts.csv
work/eeg_mne_preprocessing/formal_eeg_contrast_summary.csv
work/eeg_mne_preprocessing/formal_eeg_condition_profiles.csv
work/eeg_mne_preprocessing/formal_eeg_pairwise_results.csv
work/eeg_mne_preprocessing/formal_eeg_robustness_results.csv
work/eeg_mne_preprocessing/formal_eeg_leave_one_subject_out.csv
work/eeg_mne_preprocessing/formal_eeg_report.html
work/eeg_mne_preprocessing/formal_eeg_summary.json
```

### Formal EEG 全量本地试跑

已对当前本地 97 个 XDF 全量试跑：

```text
python scripts/eeg_mne_preprocessing.py --raw-dir work/xdf_raw --out-dir work/eeg_mne_preprocessing --line-freq 50
```

QC：

```text
files_completed = 97 / 97
files_failed = 0
montage_set = 97 / 97
region_fallback = 0 / 97
decision_point_enter epochs = 419 accepted / 430 candidates
sign_readable epochs = 1855 accepted / 1884 candidates
formal contrast subjects = 32 for sign/trial endpoints, 31 for decision-point endpoint
P27 high has 0 decision_point_enter candidate epoch, so decision-point formal endpoint n = 31
```

Formal H3 planned contrast 当前结果：

```text
decision_point_enter_formal_load_delta:
n = 31
mean contrast = 0.219
95% CI [-0.009, 0.447]
t = 1.96, p = .0588, dz = 0.35
bootstrap 95% CI [0.0145, 0.4459]
sign-flip p = .0593
leave-one-subject-out: 10/31 次 p < .05

decision_point_enter_frontal_theta_delta:
n = 31
mean contrast = 0.171
95% CI [0.023, 0.318]
t = 2.36, p = .0247, dz = 0.42
bootstrap 95% CI [0.0317, 0.3120]
sign-flip p = .0252
Wilcoxon p = .0479
leave-one-subject-out: 31/31 次 p < .05

sign_readable_formal_load_delta:
n = 32
mean contrast ≈ 0
p = .997
```

pairwise 结构：

```text
decision_point_enter_formal_load_delta:
medium - high p = .0495
medium - low p = .1366
high - low p = .9717

decision_point_enter_frontal_theta_delta:
medium - low p = .0412
medium - high p = .0635
high - low p = .6123
```

论文解释口径：

> EEG 正式预处理结果显示，中等路径确认支持在关键决策点附近呈现更高的额区 theta 增量，`Mcontrast = 0.171, 95% CI [0.023, 0.318], t(30)=2.36, p=.025, dz=0.42`。这与 H1 的近端路径确认迟滞结果方向一致，提示中等支持可能提高被试在目标提示、现场线索与方向选择之间进行整合的认知控制负荷。与此同时，综合 EEG load composite 为边缘结果，`p=.059`，因此 EEG 结论应写为“额区 theta 成分提供支持性生理证据”，而不是把整个 H3 composite 写成已显著成立。

2026-06-07 追加展示改进：

- `scripts/eeg_mne_preprocessing.py` 现在自动生成 formal EEG 证据包：condition profiles、pairwise、bootstrap、sign-flip、Wilcoxon、sign test、leave-one-subject-out 和 `formal_eeg_report.html`。
- 对主效应展示的判断：H1 主效应已经足够清楚；H3 EEG composite 仍是边缘，但 planned secondary 的 decision-point frontal theta 更稳，31/31 次 leave-one-subject-out 仍 p < .05。
- 方法判断：原 composite 把 frontal theta、posterior alpha 和全局 theta/alpha 合在一起，科学上可解释但会稀释当前最稳定的额区 theta 信号；因此论文中应把 composite 保留为 H3 综合端点，把 frontal theta 写成 planned physiological component/supporting evidence。

## 18. 2026-06-07 神经工程管理 / 管科定位修正

用户明确指出：本论文是神经工程管理、管理科学方向，不是医学或基础生物学论文。因此，本轮已经把 EEG 重新定位为管理信息设计的过程追踪证据，而不是医学/生物主结论。

新增文档：

```text
docs/MANAGEMENT_SCIENCE_EVIDENCE_PROTOCOL.md
```

新增脚本：

```text
scripts/management_science_synthesis.py
```

默认输出：

```text
work/management_science_synthesis/management_evidence_report.html
work/management_science_synthesis/management_evidence_report.md
work/management_science_synthesis/management_evidence_synthesis.json
work/management_science_synthesis/management_construct_evidence.csv
work/management_science_synthesis/management_accuracy_status.csv
work/management_science_synthesis/management_link_analysis.csv
work/management_science_synthesis/management_implications.csv
```

用户给出的正式研究模型：

```text
X：路径确认支持水平
Y：行动迟滞
M1：感知可靠性，问卷测量
M2：信息加工负荷，EEG 测量
W：保护性行动指令清晰度，正式调节变量
Y_aux：路径选择正确率，辅助因变量
```

启发式决策理论拆分：

```text
1. 理性权衡：
并非所有决策都需要耗费大量时间寻找最佳方案。
个体会在准确性收益与操作成本之间权衡。
当继续搜索/确认的成本高于准确性提升收益时，采用启发式行动是合理的，但正确率可能较低。
该过程对应 M1 感知可靠性。

2. 认知局限：
由于个人处理能力有限，个体很难在所有情境下做出完全理性的决策。
因此，个体可能忽略部分信息，用更经济的方式完成判断和选择。
该过程对应 M2 信息加工负荷。
```

主效应：

```text
路径确认支持水平对行动迟滞具有倒 U 型影响：
medium > mean(low, high)
```

并行中介与分段主导：

```text
低支持 -> 中等支持：
M1 感知可靠性主导。
低支持下，继续依赖官方线索的操作成本高于准确性收益，个体倾向于终止官方确认并自主行动；
中等支持下可靠性上升，准确性收益开始超过操作成本，个体愿意持续参考官方线索，因而搜索/核对增加，行动迟滞上升。

中等支持 -> 高支持：
M2 信息加工负荷主导。
中等支持下线索可靠但未充分闭合，个体必须整合大量线索，认知负荷和行动迟滞最高；
高支持下确认更容易，认知负荷下降，行动迟滞减少。
```

建模约束：

```text
可靠性机制和认知负荷的 X->M 具体假设可以根据问卷、EEG 和行为证据微调。
但中介主导逻辑必须跟随主效应：
low -> medium 阶段解释行动迟滞上升；
medium -> high 阶段解释行动迟滞下降。
```

指标映射：

```text
X：low / medium / high route-confirmation support
X 操纵维度：线索数量、线索连续性、关键决策点覆盖、首次可见 / 首次可读线索出现时机
Y：route_confirmation_hesitation_index
M1：perceived_reliability_score，问卷
M2 formal EEG composite：decision_point_enter_formal_load_delta
M2 planned secondary EEG：decision_point_enter_frontal_theta_delta
W：protective_action_instruction_clarity_score，正式调节变量
行为机制线索：prompt_to_first_confirmation_s，不替代 M1
辅助因变量：路径选择正确率，decision_choice_accuracy_ratio / first_choice_correct / final_arrival_correct
解释边界：route_decision_hesitation_index
```

问卷数据状态：

```text
用户已收集问卷，数据尚在整理。

每个地图/路线任务完成后填写：
1. 官方信息链整体感受：M1 感知可靠性。
   题项包括官方路径确认线索可靠、准确支持路线判断、前后一致、值得继续依赖、沿线索继续判断可信。
2. 沿途与 A3 出口相关的现场标识：X 操纵检查 / 确认链闭合感。
   题项包括标识有效帮助完成 A3 寻路、选择前能及时看到、连续出现、不让长时间失去方向确认、关键分岔处帮助判断下一步方向。
3. 路线判断正确性的主观把握：主观正确性/信心辅助变量。
   题项包括路线选择有信心、过程中确信每次方向正确、认为路线判断可靠。

完成全部三个地图后填写：
4. 警报信息内容：W 保护性行动指令清晰度。
5. 空间/寻路能力：个体差异协变量。
6. 身体感受 / VR 不适：QC、敏感性分析或控制变量。
```

路径选择正确率的解释口径：

```text
正确率不是行动迟滞的替代主因变量，也不是中介。
它用于解释速度-准确性权衡：低支持下被试可能用启发式搜索或其他环境线索快速行动，所以迟滞低但正确率应较低。
随着路径确认支持水平提高，正确率预期逐步上升：Accuracy_low < Accuracy_medium <= Accuracy_high。
正确率不应被写成倒 U 型。
所有测试唯一正确出口为 A3；当前可用 exit_label == A3 推断最终路线正确性，其他出口均为错误。
当前 32 名完整被试 / 96 个 canonical run 的最终正确性均值：low=0.469, medium=0.656, high=0.719。
被试内辅助对比：high-low = 0.250, 95% CI [0.074, 0.426], p=.009；medium-low = 0.188, 95% CI [0.024, 0.351], p=.032；high-medium = 0.062, p=.161。
```

新增正式模型协议：

```text
docs/PARALLEL_MEDIATION_MODEL_PROTOCOL.md
```

当前已有数据支持：

```text
Y 主效应倒 U：
route_confirmation_hesitation_index
n = 32, mean contrast = 0.242, p = .0118

行为机制线索：
prompt_to_first_confirmation_s
n = 32, mean contrast = 6.904 s, p = .0051

M2 EEG 过程证据：
decision_point_enter_frontal_theta_delta
n = 31, mean contrast = 0.171, p = .0247
```

当前缺口：

```text
M1 感知可靠性问卷数据尚未接入。
W 保护性行动指令清晰度问卷数据尚未接入。
因此，不能声称完整并行中介已经检验成立。
```

补充链接分析：

```text
信息闭合缺口 -> 近端确认负担:
Pearson r = .395, p = .025
Spearman rho = .415, p = .018

近端确认负担 -> 关键决策点额区 theta:
Pearson r = -.140, p = .454
Spearman rho = -.317, p = .083
```

解释：行为机制线索与行为主结果一致；但行为负担与 EEG theta 的被试间相关不显著，且 M1 问卷尚未接入，因此不能写正式中介。更合适的写法是：当前数据支持倒 U 主效应和 M2 过程证据；完整的 M1/M2 分段并行中介需要问卷数据后再检验。

论文定位句：

> 本文属于神经工程管理与应急管理交叉研究。脑电数据不被解释为医学或生物诊断指标，而是作为过程追踪证据，用于检验路径确认支持这种管理信息设计是否改变个体在关键决策点的确认成本与信息整合负担。

## 19. 2026-06-07 研究决策短备忘

为避免长上下文压缩后丢失研究口径，新增短文档：

```text
docs/RESEARCH_DECISION_MEMORY.md
```

后续继续分析、写作或接入问卷数据前，应优先阅读该文件。它集中记录：

```text
论文定位
倒 U 主效应
启发式决策的理性权衡 / 认知局限拆分
M1/M2 分段并行中介逻辑
X 操纵维度
问卷题组分工
W 正式调节变量
A3 正确出口规则
当前 H1 / M2 / 正确率辅助结果
不能过度声称的边界
```

## 20. 2026-06-10 正式分析计划与问卷接入

新增正式执行文档：

```text
docs/FORMAL_ANALYSIS_AND_QUESTIONNAIRE_PLAN.md
```

新增问卷接入脚本：

```text
scripts/questionnaire_integration.py
```

脚本默认读取：

```text
work/questionnaire/questionnaire_responses.csv
```

如果问卷原始 CSV 尚未整理好，脚本会先生成：

```text
work/questionnaire/questionnaire_template.csv
work/questionnaire/questionnaire_codebook.csv
```

有真实问卷后，脚本输出：

```text
work/questionnaire/questionnaire_scale_scores.csv
work/questionnaire/questionnaire_subject_covariates.csv
work/questionnaire/questionnaire_segment_mediation_ready.csv
work/questionnaire/questionnaire_analysis_summary.json
```

固定口径：

```text
M1 = perceived_reliability_score，只来自每个地图后的“官方信息链整体感受”题组。
X 操纵检查 = route_closure_manipulation_check_score，来自 A3 现场标识题组，不替代 M1。
主观信心 = subjective_route_confidence_score，不等于客观正确率。
W = protective_action_instruction_clarity_score，来自完成全部三个地图后的警报信息题组。
空间能力 = spatial_ability_score，作为协变量；第 6/7 项反向计分。
VR 不适 = vr_discomfort_score，作为 QC / 敏感性或控制变量。
```

分析顺序继续固定：

```text
先报告 H1 主 planned contrast 和倒 U 形状；
再报告正确率辅助、M2 EEG 过程证据；
问卷接入后再检验 M1/M2 分段并行中介和 W 调节。
```
