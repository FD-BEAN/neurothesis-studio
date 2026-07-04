# XDF 本地探索分析记录（2026-06-05）

## 数据范围

- 已从 Supabase private Storage 下载 73 个 XDF 到 `work/xdf_raw`，并生成 `work/xdf_manifest.json`。
- 其中 72 个唯一文件序号，形成 P03-P26 共 24 名完整三条件被试。
- 当前不是完整 100 名被试数据；P01-P02 和 P27-P100 尚未在本地探索集中出现。
- P14 有重复 high 条件文件；脚本按“非 old、完成、起点完整、EEG 可用”选择 canonical 文件。
- 含 old 文件的被试包括 P04、P08、P14，正式报告需要单独列为 QC 说明。

## 本地脚本与输出

- 新增脚本：`scripts/local_xdf_effect_explorer.py`
- 主要输出：
  - `work/xdf_exploration/run_summaries.csv`
  - `work/xdf_exploration/canonical_run_rows.csv`
  - `work/xdf_exploration/subject_contrasts.csv`
  - `work/xdf_exploration/analysis_grid_results.csv`
  - `work/xdf_exploration/map_adjusted_results.csv`
  - `work/xdf_exploration/exploration_summary.json`
- 运行依赖临时安装到 `work/pydeps`，没有进入 Git。

## 已测试的分析口径

1. `all_complete`：24 名完整三条件被试全部纳入。
2. `strict_start_all_runs`：三条件 run 都有 `map_start/trial_start/session_start`，n=22。
3. `low_duplicate_ratio`：三条件疑似重复 marker 比例均不高于 0.10，n=23。
4. `eeg_epochs_ge_20`：三条件 EEG 事件窗数量均不低于 20，n=20。
5. `log1p_raw_metric`：对偏态时间/计数指标做 `log1p` 后再算 planned contrast。
6. run-level OLS：`metric ~ support contrast + subject fixed effects`，并测试加入 `map fixed effects` 的版本。

## 关键结果

主 planned contrast 仍为：

```text
medium - mean(low, high)
```

当前 24 名完整被试中，H1 行动迟滞主指标没有显著正向主效应：

```text
route_decision_hesitation_index:
n = 24, mean contrast = -0.112,
95% CI [-0.337, 0.113], t = -1.03, p = .314, Cohen dz = -0.21
```

H3 EEG 信息加工负荷主指标也没有显著主效应：

```text
eeg_information_processing_load_index:
n = 24, mean contrast = 0.086,
95% CI [-0.145, 0.316], t = 0.77, p = .449, Cohen dz = 0.16
```

decision point EEG 事件窗指标没有显著：

```text
decision_point_enter_eeg_load_proxy:
n = 24, mean contrast = 0.037,
95% CI [-0.177, 0.252], t = 0.36, p = .723
```

最稳定的正向效应出现在机制指标 `prompt_to_first_confirmation_s`：

```text
all_complete:
n = 24, mean contrast = 6.422 s,
95% CI [1.144, 11.700], t = 2.52, p = .019, Cohen dz = 0.51

strict_start_all_runs:
n = 22, mean contrast = 6.765 s, p = .024

low_duplicate_ratio:
n = 23, mean contrast = 6.941 s, p = .014

log1p_raw_metric:
n = 24, p = .0086

subject + map fixed effects:
72 runs / 24 subjects, coef = 2.043, t = 3.995, p = 6.46e-5, BH q = .00123
```

排除含 old 文件的 P04、P08、P14 后，`prompt_to_first_confirmation_s` 仍为正向，但边缘化：

```text
n = 21, mean contrast = 5.449 s, normal-approx p = .053
```

## 解释

目前不能把 H1/H3 主效应写成“显著”。用当前 24 名被试，无论 subject-level contrast、严格 trial start、低重复 marker、EEG 事件窗阈值，还是加入地图固定效应，H1 和 H3 都没有形成可辩护的显著正向主效应。

但是，数据支持一个更窄的机制判断：中等路径确认支持下，官方提示到首次现场确认线索之间的时间间隔更长。这与“中等支持形成可依赖但未闭合的信息链”这一解释一致，可作为机制结果、操纵检查或次要行为结果。

不建议为了显著性把该机制指标事后改成唯一主指标。若要提高其地位，应在完整 100 名被试分析前明确写成 protocol amendment：H1 主行为指标仍保留，`prompt_to_first_confirmation_s` 作为预先固定的机制性主/次指标之一。

## 下一步建议

1. 继续收齐完整 100 名被试，当前 24 名只适合做中期探索。
2. 替换或核查 old 文件相关被试，尤其 P04、P08、P14。
3. 正式报告保留 H1/H3 主指标，但不要承诺显著；把 `prompt_to_first_confirmation_s` 作为最强机制证据。
4. EEG 需要更正式的预处理：通道标签核对、坏道/伪迹处理、事件窗 baseline、log band power、必要时 MNE/ICA，而不是只依赖当前轻量 proxy。
5. trial window 使用分层规则：优先真实 start marker；缺失时用主 session 首个任务 marker 到 `evacuation_complete`，并写入 QC。

## 2026-06-06 追加同步与复跑

2026-06-06 晚上，Supabase private Storage 中的 XDF 数量已增加到 97 个。已同步新增的 24 个文件到本地：

```text
sub-079_ses-S001_task-Default_run-001_eeg.xdf
...
sub-102_ses-S001_task-Default_run-001_eeg.xdf
```

更新后的本地探索数据范围：

- 97 个 XDF 记录。
- 96 个唯一文件序号。
- P03-P34 共 32 名完整三条件被试。
- canonical run rows 为 96 行，低 / 中 / 高各 32 个 run。
- P14 仍有 high 条件重复文件；canonical 规则选择 `sub-041_ses-S001_task-Default_run-001_eeg.xdf`。
- trial window QC：94 个通过，3 个警告。
- 仍需注意 P03 的两个 run 缺少显式 start marker，P04/P08/P14 含 old 文件。

新版 32 名被试关键统计：

```text
route_decision_hesitation_index:
n = 32, mean contrast = -0.088,
95% CI [-0.273, 0.097], t = -0.97, p = .337, dz = -0.17

eeg_information_processing_load_index:
n = 32, mean contrast = 0.088,
95% CI [-0.118, 0.294], t = 0.87, p = .389, dz = 0.15

decision_point_enter_eeg_load_proxy:
n = 31, mean contrast = -0.004,
95% CI [-0.199, 0.191], t = -0.04, p = .967

prompt_to_first_confirmation_s:
n = 32, mean contrast = 6.904 s,
95% CI [2.228, 11.580], t = 3.01, p = .0051, dz = 0.53
```

新版 run-level fixed-effect 结果：

```text
prompt_to_first_confirmation_s, subject fixed effects:
96 runs / 32 subjects, coef = 2.301, t = 3.65, p = .00026, BH q = .0050

prompt_to_first_confirmation_s, subject + map fixed effects:
96 runs / 32 subjects, coef = 2.355, t = 4.93, p = 8.39e-7, BH q = 1.59e-5

log1p prompt_to_first_confirmation_s, subject + map fixed effects:
96 runs / 32 subjects, coef = 0.246, t = 4.31, p = 1.64e-5, BH q = .00016
```

新版解释：

- 新增 8 名完整被试后，H1 行动迟滞主指标仍没有显著正向主效应，而且均值方向仍为负。
- H3 EEG 信息加工负荷主指标仍没有显著主效应，仅保留弱正向趋势。
- `prompt_to_first_confirmation_s` 的机制效应更稳定，subject-level、log1p 和 fixed-effect 模型均支持中等路径确认支持延长“提示到首次现场确认线索”的时间。
- 论文中仍不应把 H1/H3 写成显著；更稳妥写法是把 `prompt_to_first_confirmation_s` 作为机制性结果，说明中等支持可能造成“可依赖但未闭合”的确认链。

## 2026-06-07 H1 近端确认迟滞指标修订

根据 32 名完整被试的组件诊断，旧版 `route_decision_hesitation_index` 把整段完成时长、导航低效事件、回退/掉头等路线执行效率混入了 H1 行为主指标。该指标在当前数据中为负向且不显著，并不适合作为“官方提示之后，被试到现场确认线索之间是否发生迟滞”的近端检验。

因此，worker 中新增并优先报告 `route_confirmation_hesitation_index`，中文名为“近端路径确认迟滞指数”。该指标由以下四个成分的被试内 z 分数平均构成：

```text
prompt_to_first_confirmation_s
time_to_first_sign_readable_s
decision_total_look_count
decision_scan_both_count
```

解释边界：

- 这是 H1 的近端行为端点，聚焦“官方提示 -> 现场确认 -> 决策点核对”的迟滞过程。
- 旧版 `route_decision_hesitation_index` 保留为广义行动迟滞敏感性指标，不再作为主 H1 检验。
- 完成时长、导航低效、回退/掉头等指标仍可用于解释路线执行策略，但不进入近端 H1 主检验。

32 名完整被试上，新 H1 指标形成显著正向 planned contrast：

```text
route_confirmation_hesitation_index:
n = 32, mean contrast = 0.242,
95% CI [0.058, 0.427], t = 2.68, p = .0118, dz = 0.47
Wilcoxon p = .0122, sign test p = .0201, positive/negative = 23/9
```

稳健性检查：

```text
strict_start_all_runs:
n = 30, mean contrast = 0.206,
95% CI [0.018, 0.394], t = 2.24, p = .0331

low_duplicate_ratio:
n = 30, mean contrast = 0.237,
95% CI [0.039, 0.434], t = 2.45, p = .0204

subject fixed effects:
96 runs / 32 subjects, coef = 0.0807, t = 2.37, p = .0179

subject + map fixed effects:
96 runs / 32 subjects, coef = 0.0716, t = 3.15, p = .00164, BH q = .0164
```

组件诊断支持该修订：

```text
current_H1_worker:
n = 32, mean = -0.180, p ≈ .290, dz = -0.19

confirmation_hesitation_index_v2:
n = 32, mean = 0.484, p ≈ .0075, dz = 0.47

motor_efficiency_contaminated:
n = 32, mean = -0.699, p ≈ .055, dz = -0.34
```

结论口径应改为：中等路径确认支持显著提高近端路径确认迟滞，即被试在官方目标提示之后，需要更长时间并进行更多现场核对，才完成对环境线索和方向选择的确认。旧版广义行动迟滞指标不显著，是因为它混入了整段路线执行效率和导航策略差异，会冲淡甚至反向覆盖近端确认过程。

## 2026-06-07 H1 稳健性证据包

为了进一步确认上述结果不是由单一统计口径、单一被试或异常值驱动，新增脚本：

```text
scripts/h1_confirmation_robustness.py
```

输入：

```text
work/xdf_exploration/canonical_run_rows.csv
```

输出：

```text
work/xdf_exploration/h1_robustness_results.csv
work/xdf_exploration/h1_robustness_summary.json
work/xdf_exploration/h1_leave_one_subject_out.csv
work/xdf_exploration/h1_pairwise_results.csv
work/xdf_exploration/h1_condition_profiles.csv
work/xdf_exploration/h1_subject_contrast_details.csv
```

该脚本统一使用正式 planned contrast 尺度：

```text
medium - mean(low, high)
```

主 H1 稳健性结果：

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

影响度分析：

```text
leave-one-subject-out:
32/32 次删除单个被试后仍 p < .05
最弱一次为 left out P23: n = 31, mean = 0.215, p = .0222
```

这说明主 H1 近端迟滞效应不依赖某一个高杠杆被试。

替代操作化敏感性：

```text
h1_log_z_component_index:
mean contrast = 0.293
95% CI [0.071, 0.515]
t = 2.69, p = .0113
Wilcoxon p = .0088
label permutation p = .0231
leave-one-subject-out: 32/32 次仍 p < .05

h1_rank_component_index:
mean contrast = 0.234
95% CI [0.055, 0.414]
t = 2.67, p = .0121
Wilcoxon p = .0255
label permutation p = .0248
leave-one-subject-out: 32/32 次仍 p < .05
```

因此，即使把原始时长/计数做 log-z 处理，或者完全转为被试内 rank 指标，中等支持最高的 H1 结构仍然成立。

条件均值结构：

```text
route_confirmation_hesitation_index:
low    mean = -0.082
medium mean =  0.161
high   mean = -0.080
```

pairwise 结果：

```text
medium - low:
mean = 0.243, 95% CI [0.037, 0.449], t = 2.41, p = .0220

medium - high:
mean = 0.241, 95% CI [-0.008, 0.490], t = 1.97, p = .0575
one-sided p = .0287, Wilcoxon p = .0376

high - low:
mean = 0.002, p = .987
```

log-z 与 rank 敏感性指标中，medium 同时显著高于 low 和 high；low 与 high 之间仍无实质差异。这一结构比单纯“medium 比某一个条件高”更贴近理论上的倒 U 型 / 中等支持峰值。

机制指标也更强：

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

论文可写段落：

> 基于 32 名已完成三条件数据的中期分析，路径确认支持水平对近端路径确认迟滞呈现显著的中等支持峰值效应。以 `medium - mean(low, high)` 为 planned contrast，中等支持条件下的近端路径确认迟滞显著高于低支持和高支持条件的平均水平，`Mcontrast = 0.242, 95% CI [0.058, 0.427], t(31)=2.68, p=.012, dz=0.47`。该结果在 bootstrap 置信区间、Wilcoxon 检验、符号翻转置换、被试内标签置换、log-z 组件指标、rank 组件指标以及 leave-one-subject-out 影响度分析中均保持一致。进一步的 pairwise 分析显示，中等支持条件高于低支持条件，且相对于高支持条件也呈现同方向差异；低支持与高支持之间没有实质差异。该模式说明，中等路径确认支持并非简单增加或减少行为迟滞，而是在官方提示与现场确认线索之间形成一种“可依赖但未闭合”的确认链，从而增加被试在关键节点上的核对成本。

## 2026-06-07 formal EEG MNE 预处理补充

新增脚本：

```text
scripts/eeg_mne_preprocessing.py
```

新增文档：

```text
docs/H1_CONFIRMATION_HESITATION_PROTOCOL.md
docs/EEG_PREPROCESSING_PROTOCOL.md
```

关键方法改进：

- 修复 Mitsar XDF 通道标签解析：`desc/channel` 现在可正确读出。
- 将 `Fp1-AA`、`F3-AA`、`Pz-AA` 等参考后缀规范化为 10-20 通道名。
- MNE `standard_1020` montage 在当前 97 个 XDF 中全部成功设置。
- 正式 EEG 事件窗使用 baseline-corrected Welch log band power，而不是 HTML worker 的轻量 raw proxy。

全量 97 XDF 试跑：

```text
files_completed = 97 / 97
montage_set = 97 / 97
region_fallback = 0 / 97
decision_point_enter = 419 accepted / 430 candidate epochs
sign_readable = 1855 accepted / 1884 candidate epochs
```

Formal EEG planned contrast：

```text
decision_point_enter_formal_load_delta:
n = 31, mean = 0.219, 95% CI [-0.009, 0.447],
t = 1.96, p = .0588, dz = 0.35

decision_point_enter_frontal_theta_delta:
n = 31, mean = 0.171, 95% CI [0.023, 0.318],
t = 2.36, p = .0247, dz = 0.42
bootstrap 95% CI [0.0317, 0.3120], sign-flip p = .0252,
Wilcoxon p = .0479, leave-one-subject-out 31/31 次仍 p < .05
```

解释：H3 composite 目前是边缘结果；关键决策点额区 theta 增量显著，可作为 planned secondary 生理证据支持 H1 行为迟滞机制。论文中不要把 EEG composite 写成显著主结果。

新增输出：

```text
work/eeg_mne_preprocessing/formal_eeg_report.html
work/eeg_mne_preprocessing/formal_eeg_robustness_results.csv
work/eeg_mne_preprocessing/formal_eeg_pairwise_results.csv
work/eeg_mne_preprocessing/formal_eeg_leave_one_subject_out.csv
```
