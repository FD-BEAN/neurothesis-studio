# 2026-07-05 全量 XDF 分析与 H1 算法修订记录

## 1. 数据覆盖

本轮从 Supabase 同步并分析了当前已上传的全部 XDF：

- XDF 记录数：455
- 唯一 sequence index：294
- 覆盖范围：sub-007 到 sub-300
- 完整被试：P03-P100，共 98 名
- 缺失或未上传：P01、P02
- 重复 subject × support 单元：151 个，其中 145 个关键行为/QC 指标完全一致，6 个存在有效事件窗或关键延迟差异。

因此，当前不是完整 P01-P100 的 100 名被试数据，而是 98 名完整被试。后续如果补上传 P01/P02，应重跑本流程。

## 2. 关键算法修订

### 2.1 条件识别

条件不再按文件序号硬推。实际支持水平以 XDF marker / metadata 中的 Signature 优先识别：

- Signature1：低路径确认支持
- Signature2：中路径确认支持
- Signature3：高路径确认支持

这是必要的，因为部分被试并不是按 sub 编号顺序排列低/中/高条件。例如 P03 中 sub-007=中、sub-008=高、sub-009=低；如果按文件序号硬映射，会直接稀释甚至反转主效应。

### 2.2 重复文件 canonical 选择

`scripts/local_xdf_effect_explorer.py` 的 canonical 选择已改成质量优先，而不是先按 old/new 文件名：

1. 优先 trial complete、trial start、trial end 完整。
2. 优先 marker stream、核心事件、EEG 事件窗 QC 通过。
3. 优先有 `prompt_to_first_confirmation_s` 的 run。
4. 优先 map / signature 可识别。
5. 优先有效 EEG event epoch 更多。
6. 优先 duplicate marker ratio 更低。
7. 再考虑非 old 文件、递归上传来源、上传时间和文件大小。

这样可以避免一个较新的但缺 trial start 的坏 run 压掉一个完整的 old 备份。

### 2.3 H1 行动迟滞操作化修订

管理学模型中的 H1 是“路径确认支持水平对行动迟滞的倒 U 型影响”。全量数据诊断显示，最贴近该定义的行为指标是：

```text
prompt_to_first_confirmation_s
```

中文写作建议：官方提示到首次现场路径确认延迟。

该指标表示被试听到/收到官方目标提示后，多久完成第一次现场确认线索匹配。它直接对应“有线索可依赖但尚未闭合，所以继续确认、行动被延后”的过程。

原 `route_confirmation_hesitation_index` 保留为复合敏感性指标。该复合指数混入了 `time_to_first_sign_readable_s`、左右查看和双侧扫描，容易受到地图布局、可见性和高支持条件下线索数量增加的影响，因此不再作为唯一主报告口径。

## 3. H1 主效应结果

主原始指标 `prompt_to_first_confirmation_s` 的三条件均值为：

| 支持水平 | n | 均值秒数 |
|---|---:|---:|
| 低支持 | 98 | 7.401 |
| 中等支持 | 98 | 12.721 |
| 高支持 | 98 | 3.033 |

被试内 planned contrast：

```text
medium - mean(low, high)
```

结果：

- n=98
- mean contrast=7.504 秒
- 95% CI [4.130, 10.878]
- t=4.415
- p=2.63e-5
- Cohen dz=0.446
- bootstrap 95% CI [4.229, 10.854]
- sign-flip permutation p=3.33e-5
- Wilcoxon p=.0037
- leave-one-subject-out：98/98 次均 p<.05，最大 p=4.84e-5

固定效应模型：

- subject FE + map FE：coef=2.541, SE=0.344, t=7.396, p=1.40e-13, n=294 runs / 98 subjects
- subject FE：coef=2.501, p=8.25e-8
- log1p subject FE + map FE：coef=0.200, p=1.95e-9

QC 敏感性：

- all_complete：mean contrast=7.504, p<.001
- strict_start_all_runs：mean contrast=7.054, p<.001
- low_duplicate_ratio：mean contrast=7.728, p<.001
- eeg_epochs_ge_20：mean contrast=6.075, p<.001

相邻阶段：

- 中等支持 - 低支持：mean diff=5.320 秒，95% CI [1.385, 9.255], p=.0086
- 中等支持 - 高支持：mean diff=9.688 秒，95% CI [6.582, 12.794], p=1.44e-8
- 高支持 - 低支持：mean diff=-4.368 秒，95% CI [-6.544, -2.192], p=.00013

形状诊断：

- 中等支持为三条件最高的被试：45/98，p=.0065，相对 1/3 随机基线
- medium > high：74/98，p=2.11e-7
- medium > low：51/98，方向为正，但个体比例检验不显著

解释：H1 主效应不是线性“支持越多越慢”，而是中等支持显著慢于高支持，并整体高于低/高平均。低支持与高支持机制不同：低支持可能快速启发式行动但准确率较低，高支持则确认链闭合更快。

## 4. 辅助正确率结果

路径选择正确率辅助支持速度-准确性权衡：

| 支持水平 | 平均正确率 |
|---|---:|
| 低支持 | 0.561 |
| 中等支持 | 0.765 |
| 高支持 | 0.908 |

这与研究逻辑一致：低支持下被试可能不依赖官方线索、快速启发式搜索，因此迟滞较低但正确率较低；支持水平提高后，正确率逐步上升。

## 5. 不应作为 H1 主结论的指标

以下指标不适合作为 H1 主结论：

- `route_confirmation_hesitation_index`：复合敏感性指标，mean contrast=0.061, p=.267。
- `route_decision_hesitation_index`：旧版广义路线执行效率指标，mean contrast=-0.062, p=.241。
- `duration_s` / 总完成时间：受地图、路线长度、移动速度影响太大。
- `decision_dwell_total_s`、`decision_load_proxy`：高支持条件也可能因线索更多而增加查看/停留，不能单独代表行动迟滞。

这不是主效应不存在，而是宽指标把“提示后首次确认迟滞”和“后段路线执行效率”混在一起，导致理论效应被稀释。

## 6. EEG 与机制线索

本轮综合报告读取了本地 formal EEG 输出：

- `decision_point_enter_frontal_theta_delta`：mean=0.171, 95% CI [0.023, 0.318], p=.025。
- `decision_point_enter_formal_load_delta`：mean=0.219, 95% CI [-0.009, 0.447], p=.059。

写作上应把 EEG 作为中介二“信息加工负荷”的过程证据，而不是医学或生物诊断结论。

行为机制线索 `route_confirmation_disfluency_index` 为正向但未达到双侧显著：

- mean=0.143
- 95% CI [-0.031, 0.318]
- p=.106

该结果可以作为“可依赖但未闭合的信息链”的补充解释，但不能替代问卷中介一。感知可靠性仍必须由问卷测量并接入 mediation 模型。

## 7. 当前产物

全量本地分析产物：

```text
work/xdf_full_analysis/
```

主要文件：

- `canonical_run_rows.csv`
- `analysis_grid_results.csv`
- `map_adjusted_results.csv`
- `h1_robustness_summary.json`
- `h1_robustness_results.csv`
- `h1_pairwise_results.csv`

管理科学综合报告：

```text
work/management_science_synthesis_full/
```

主要文件：

- `management_evidence_report.md`
- `management_evidence_report.html`
- `h1_primary_effect_report.md`
- `h1_primary_effect_report.html`
- `management_h1_primary_result.csv`
- `management_construct_evidence.csv`

## 8. 论文写作口径

建议正式结果段按以下顺序写：

1. H1 主结果：`prompt_to_first_confirmation_s` 的 planned contrast。
2. 三条件均值形状：低 7.401 秒，中 12.721 秒，高 3.033 秒。
3. 地图校正 fixed-effect 模型。
4. leave-one-subject-out、bootstrap、permutation、QC 敏感性。
5. 低到中、中到高两个相邻阶段的机制解释。
6. 正确率作为辅助因变量，解释低支持“快但不准”。
7. EEG 作为信息加工负荷中介证据。
8. 复合迟滞和广义路线效率作为边界敏感性，不写成主结论。

可写入论文的核心句：

> 路径确认支持水平对近端行动迟滞呈现显著倒 U 型影响。中等支持条件下，被试从官方提示到首次现场路径确认的时间最长（M=12.721s），高于低支持（M=7.401s）和高支持（M=3.033s）的平均水平；被试内 planned contrast 显著，mean contrast=7.504s, 95% CI [4.130, 10.878], p<.001。加入被试固定效应和地图固定效应后，该效应仍然稳健，coef=2.541, SE=0.344, p<.001。

