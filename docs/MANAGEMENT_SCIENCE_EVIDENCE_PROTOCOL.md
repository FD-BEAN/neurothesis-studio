# 神经工程管理证据综合协议

更新日期：2026-06-07

## 1. 论文定位

本研究定位为神经工程管理 / 应急管理 / 管理科学交叉论文，不是医学论文，也不是基础生物学论文。脑电数据的作用不是诊断或解释生理疾病，而是作为过程追踪证据，用来说明应急信息支持设计如何改变人的路线确认成本和关键决策点信息整合负担。

核心表述：

```text
路径确认支持是一种管理信息设计干预。
行为指标是管理主结果。
EEG 是神经工程过程证据。
```

## 2. 管理科学构念

正式研究模型不是单链条，而是倒 U 主效应 + 两个并行中介 + 分段主导机制：

```text
X：路径确认支持水平
Y：行动迟滞
M1：感知可靠性，问卷测量
M2：信息加工负荷，EEG 测量
W：保护性行动指令清晰度，正式调节变量
```

理论基础是启发式决策的两种来源：

```text
理性权衡：个体在准确性收益与操作成本之间做权衡。
当继续确认的操作成本高于准确性提升收益时，采用启发式行动是合理的，但正确率可能受限。

认知局限：个体无法在所有情境下完成充分理性计算。
当确认链未闭合且线索需要整合时，个体可能因处理能力限制而依赖更经济的判断方式。
```

两个中介的理论分工：

```text
M1 感知可靠性 = 理性权衡机制。
M2 信息加工负荷 = 认知局限机制。
```

对应指标：

| 管理构念 | 角色 | 指标 |
| --- | --- | --- |
| 路径确认支持配置 | 管理干预变量 | low / medium / high support |
| 感知可靠性 | 中介一，低->中阶段主导 | 问卷 `perceived_reliability_score` |
| 信息加工负荷 | 中介二，中->高阶段主导 | EEG `decision_point_enter_formal_load_delta` / `decision_point_enter_frontal_theta_delta` |
| 保护性行动指令清晰度 | 正式调节变量 | 问卷 `protective_action_instruction_clarity_score` 或实验条件 |
| 行动迟滞 | 因变量 / 行为主结果 | `route_confirmation_hesitation_index` |
| 路径选择正确率 | 辅助因变量，速度-准确性权衡解释 | `decision_choice_accuracy_ratio` / `first_choice_correct` / `final_arrival_correct` / `exit_label == A3` |
| 信息闭合缺口 | 行为机制线索，不替代 M1 | `prompt_to_first_confirmation_s` |
| 事件窗综合 EEG 负荷 | H3 综合端点 | `decision_point_enter_formal_load_delta` |
| 广义路线执行效率 | 解释边界 | `route_decision_hesitation_index` |

分段主导假设：

```text
低支持 -> 中等支持：M1 感知可靠性主导
中等支持 -> 高支持：M2 信息加工负荷主导
```

约束原则：

```text
可靠性机制和认知负荷的 X->M 具体假设可以根据数据调整。
但中介主导逻辑必须跟随主效应：
低->中阶段解释行动迟滞上升；
中->高阶段解释行动迟滞下降。
```

问卷分工：

```text
每个地图后填写：
1. 官方信息链整体感受 -> M1 感知可靠性。
2. 沿途与 A3 出口相关的现场标识 -> X 操纵检查 / 确认链闭合感。
3. 路线判断正确性的主观把握 -> 主观正确性/信心辅助变量。

完成全部三个地图后填写：
4. 警报信息内容 -> W 保护性行动指令清晰度。
5. 空间/寻路能力 -> 个体差异协变量。
6. 身体感受 / VR 不适 -> QC、敏感性分析或控制变量。
```

## 3. 解释边界

可以写：

- 中等路径确认支持显著增加近端确认负担。
- 低支持到中等支持阶段，理论上由感知可靠性上升主导，本质是准确性收益开始超过继续确认的操作成本；当前必须等待问卷数据检验。
- 中等支持到高支持阶段，理论上由信息加工负荷下降主导，本质是确认链闭合后认知局限造成的信息整合负担下降；当前 formal EEG 提供过程证据。
- W 是正式调节变量，应检验保护性行动指令清晰度是否改变 X 对 M1、M2 或 Y 的影响强度。
- 官方提示到现场确认线索之间的信息闭合缺口是行为机制线索，但不能替代问卷测得的感知可靠性。
- 路径选择正确率是辅助因变量：低支持下被试可能用启发式搜索快速离开，因此迟滞较低但正确率较低；随着支持水平提高，正确率应逐步上升。
- 关键决策点额区 theta 增量提供支持性神经工程过程证据。
- 综合 EEG load composite 为边缘趋势，因此 EEG 不能替代行为主效应。
- 旧版广义路线执行效率不显著，说明结果不是“整体走得更慢”，而是“确认链更费力”。

不能写：

- EEG 证明了医学或生物学结论。
- 额区 theta 是唯一主指标。
- 行为迟滞与 EEG theta 已形成正式中介链。
- `prompt_to_first_confirmation_s` 可以替代感知可靠性问卷。
- X->M 的任意方向都可以脱离主效应来解释。
- 低支持行动更快就代表管理效果更好。
- 正确率也应呈倒 U 型。
- 把空间能力、身体不适或主观正确性当成 M1/M2 中介。
- 信息越多越好或越少越好。

## 4. 当前数据证据

H1 行为主结果：

```text
route_confirmation_hesitation_index:
n = 32
mean contrast = 0.242
95% CI [0.058, 0.427]
p = .0118
leave-one-subject-out: 32/32 次仍 p < .05
```

行为机制线索：

```text
prompt_to_first_confirmation_s:
n = 32
mean contrast = 6.904 s
95% CI [2.228, 11.580]
p = .0051
```

formal EEG 过程证据：

```text
decision_point_enter_frontal_theta_delta:
n = 31
mean contrast = 0.171
95% CI [0.023, 0.318]
p = .0247
leave-one-subject-out: 31/31 次仍 p < .05
```

formal EEG 综合端点：

```text
decision_point_enter_formal_load_delta:
n = 31
mean contrast = 0.219
95% CI [-0.009, 0.447]
p = .0588
```

路径选择正确率辅助因变量：

```text
当前 canonical XDF 可使用 exit_label 推断最终正确性。
所有测试唯一正确出口为 A3，exit_label == A3 为正确，其他出口为错误。
当前 32 名完整被试 / 96 个 canonical run 的最终正确性：低支持 0.469，中等支持 0.656，高支持 0.719。
被试内辅助对比：高支持 - 低支持 = 0.250, 95% CI [0.074, 0.426], p = .009；中等支持 - 低支持 = 0.188, 95% CI [0.024, 0.351], p = .032；高支持 - 中等支持 = 0.062, p = .161。
正式辅助假设为 Accuracy_low < Accuracy_medium <= Accuracy_high。
```

## 5. 并行中介状态

正式 M1 感知可靠性问卷数据尚未接入，因此当前不能声称完整并行中介模型已经检验成立。

当前可以报告的是：

- H1 主效应倒 U 成立。
- 行为机制线索 `prompt_to_first_confirmation_s` 支持“可靠但未闭合”的解释。
- M2 的 planned secondary EEG 过程证据支持中等支持下关键决策点信息加工负荷更高。

补充 subject-level 链接分析显示，行为机制线索与行为主结果一致：

```text
信息闭合缺口 -> 近端确认负担:
Pearson r = .395, p = .025
Spearman rho = .415, p = .018
```

但行为负担与 EEG theta 的被试间相关不显著：

```text
近端确认负担 -> 关键决策点额区 theta:
Pearson r = -.140, p = .454
Spearman rho = -.317, p = .083
```

因此，论文中不应声称正式中介成立。更稳妥的管科写法是：行为证据证明管理干预改变确认负担；问卷数据将用于检验 M1；EEG 在关键决策点提供 M2 的过程追踪证据；二者最终服务于分段并行中介模型，而不是单一路径中介。

## 6. 自动生成脚本

新增脚本：

```text
scripts/management_science_synthesis.py
```

默认读取：

```text
work/xdf_exploration/h1_robustness_summary.json
work/xdf_exploration/h1_subject_contrast_details.csv
work/eeg_mne_preprocessing/formal_eeg_robustness_results.csv
work/eeg_mne_preprocessing/formal_eeg_subject_contrasts.csv
work/xdf_exploration/canonical_run_rows.csv
```

默认输出：

```text
work/management_science_synthesis/management_evidence_report.html
work/management_science_synthesis/management_evidence_report.md
work/management_science_synthesis/management_evidence_synthesis.json
work/management_science_synthesis/management_construct_evidence.csv
work/management_science_synthesis/management_accuracy_status.csv
work/management_science_synthesis/management_accuracy_contrasts.csv
work/management_science_synthesis/management_link_analysis.csv
work/management_science_synthesis/management_implications.csv
```

## 7. 论文段落口径

结果段可写：

> 路径确认支持水平对近端确认负担呈现显著的中等支持峰值效应。以 `medium - mean(low, high)` 为 planned contrast，近端路径确认迟滞指数显著高于零，说明中等支持条件下被试需要更多核对与确认才能完成方向决策。机制分析进一步显示，中等支持显著延长官方提示到首次现场确认线索之间的时间间隔，支持“可依赖但未闭合”的信息链解释。正式 EEG 预处理结果显示，关键决策点额区 theta 增量在中等支持条件下更高，为该管理信息设计增加关键节点信息整合负担提供了神经工程过程证据。综合 EEG load composite 呈边缘趋势，因此 EEG 结果应作为支持性过程证据，而非替代行为主结果。

正确率辅助段可写：

> 路径选择正确率在本研究中作为辅助因变量，用于解释速度-准确性权衡。理论上，低支持条件下被试可能较少依赖官方确认链，而是基于启发式搜索或其他环境线索快速行动，因此行动迟滞较低但路线选择正确率较低；随着路径确认支持水平提高，正确率应逐步上升。由于本实验唯一正确出口为 A3，当前可先用最终出口标签 `exit_label == A3` 推断最终路线正确性；后续若补充 `choice_correct` 或 `route_choice_correct`，可进一步报告决策点正确率。

完整并行中介模型的正式检验应见：

```text
docs/PARALLEL_MEDIATION_MODEL_PROTOCOL.md
```
