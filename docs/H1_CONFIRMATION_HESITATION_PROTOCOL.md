# H1 近端路径确认迟滞指标协议

更新日期：2026-06-07

## 1. 研究问题与端点冻结

H1 检验的问题不是“中等支持是否让整段撤离更慢”，而是“官方目标提示之后，被试在现场线索确认与关键决策点核对上是否出现额外迟滞”。因此，正式 H1 行为主端点冻结为：

```text
route_confirmation_hesitation_index
```

中文名：近端路径确认迟滞指数。

本指标自 2026-06-07 起作为 H1 行为主指标。后续完整 90 名被试分析中，不再根据显著性增删其组成成分；任何修改必须作为新的 protocol amendment 单独记录，并同时保留当前版本结果。

## 2. 指标构成

每名被试在低 / 中 / 高三个路径确认支持条件内计算以下四个 run-level 成分：

```text
prompt_to_first_confirmation_s
time_to_first_sign_readable_s
decision_total_look_count
decision_scan_both_count
```

四个成分分别反映：

- 官方提示到首次现场确认线索之间的衔接成本。
- trial 起点到首次可读路径线索之间的确认启动时间。
- 决策点左右查看总量。
- 决策点双侧扫描次数。

不纳入主指标的变量：

- `duration_s`
- `navigation_inefficiency_proxy`
- `u_turn_count`
- `backtrack_count`
- `dwell_count`
- 其他整段路线效率或事后纠错变量

这些变量保留为路线执行策略、敏感性分析或机制解释材料，不能替代 H1 主端点。

## 3. 标准化与主 contrast

每个成分先在被试内三条件之间做 z 标准化：

```text
z_component = (component - subject_mean(component)) / subject_sd(component)
```

当某成分在该被试三个条件中没有方差或缺失严重时，该成分不参与该被试 composite；每个 run 至少需要 2 个有效成分才生成主指标。

主指标为有效 z 成分的平均：

```text
route_confirmation_hesitation_index = mean(valid within-subject z components)
```

主 planned contrast 固定为：

```text
medium - mean(low, high)
low = -0.5
medium = 1.0
high = -0.5
```

主统计单位为被试。每名完整被试贡献一个 contrast 值，再对 contrast 值做单样本检验。

## 4. 缺失、重复与排除规则

纳入正式 H1 主分析的被试必须满足：

- 同一被试低 / 中 / 高三个条件各有一个 canonical XDF run。
- 主 trial 有可识别的开始和完成窗口；缺少开始 marker 时可进入敏感性分析，但需在 QC 中标注。
- marker 去重后仍保留 H1 所需事件或可计算成分。

重复 marker 处理：

- 完全重复的 Unity marker 按 `marker_duplicate_key` 去重。
- 行为上真实重复的查看、扫描、停留事件不得因为“数量多”而删除。

重复文件处理：

- 同一被试同一条件存在多个版本时，优先选择非 `old` 文件、trial window 完整、marker/EEG 覆盖更好的 canonical run。
- 被替代文件只进入 QC 说明，不进入主 contrast。

## 5. 主结果与敏感性分析

主结果：

```text
route_confirmation_hesitation_index
subject-level planned contrast
two-sided one-sample t test on subject contrasts
95% CI and dz
```

必须同时报告：

- Wilcoxon signed-rank test。
- sign-flip permutation。
- within-subject condition-label permutation。
- bootstrap 95% CI。
- leave-one-subject-out 影响度。

固定敏感性指标：

```text
h1_log_z_component_index
h1_rank_component_index
prompt_to_first_confirmation_s
log_prompt_to_first_confirmation_s
route_decision_hesitation_index
```

其中 `route_decision_hesitation_index` 为旧版广义行动迟滞敏感性指标，不能再称为 H1 主指标。

## 6. 论文写法边界

可以写：

中等路径确认支持显著提高近端路径确认迟滞，表现为官方目标提示之后，被试需要更长时间并进行更多现场核对，才完成环境线索和方向选择确认。

不能写：

- 中等支持让整体撤离更慢，除非 `duration_s` 或对应路线效率模型也支持。
- EEG 或机制指标显著，除非对应 formal EEG 或机制模型独立成立。
- 根据完整样本结果临时更换主指标。

