# Metro Rescue 研究决策备忘录

更新日期：2026-06-07

用途：这是给后续分析和写作使用的“短上下文”。如果对项目口径不确定，先读本文件，再读 `CURRENT_CONTEXT.md`、`PARALLEL_MEDIATION_MODEL_PROTOCOL.md` 和 `MANAGEMENT_SCIENCE_EVIDENCE_PROTOCOL.md`。

## 1. 论文定位

本研究是神经工程管理 / 管理科学 / 应急管理交叉论文，不是医学或基础生物学论文。

核心对象不是脑电本身，而是：

```text
路径确认支持这种管理信息设计，如何影响个体的路线确认、行动迟滞、路径正确性和信息加工负荷。
```

EEG 的角色是神经工程过程证据，用来追踪关键决策点的信息加工负荷，不应被写成医学诊断或生物学主结论。

## 2. 核心研究模型

```text
X：路径确认支持水平
Y：行动迟滞
M1：感知可靠性，问卷测量
M2：信息加工负荷，EEG 测量
W：保护性行动指令清晰度，正式调节变量
Y_aux：路径选择正确率，辅助因变量
```

主效应固定为倒 U 型：

```text
路径确认支持水平 -> 行动迟滞
medium > mean(low, high)
```

正式主 contrast：

```text
medium - mean(low, high)
low = -0.5
medium = 1.0
high = -0.5
```

## 3. 启发式决策理论拆分

两个并行中介来自启发式决策理论的两个来源。

1. 理性权衡：
个体会在准确性收益与操作成本之间权衡。当继续搜索或确认的成本高于准确性提升收益时，采用省时省力的启发式行动是合理的，但正确率可能较低。该过程对应 M1 感知可靠性。

2. 认知局限：
个体处理能力有限，无法在所有情境下完成充分理性计算，因此可能忽略部分信息，用更经济的方式完成判断和选择。该过程对应 M2 信息加工负荷。

## 4. 分段并行中介逻辑

中介主导逻辑必须跟随主效应。

```text
low -> medium：
M1 感知可靠性主导。
低支持下，继续依赖官方线索的操作成本高于准确性收益，个体倾向于终止官方确认并自主行动。
中等支持下可靠性上升，准确性收益开始超过操作成本，个体愿意持续参考官方线索，搜索/核对增加，行动迟滞上升。

medium -> high：
M2 信息加工负荷主导。
中等支持下线索可靠但未充分闭合，个体必须整合大量线索，认知负荷和行动迟滞最高。
高支持下确认更容易，认知负荷下降，行动迟滞减少。
```

约束：

```text
X -> M1 和 X -> M2 的具体形态可以根据问卷、EEG 和行为证据微调。
但 low -> medium 阶段必须解释行动迟滞为什么上升。
medium -> high 阶段必须解释行动迟滞为什么下降。
```

## 5. X 操纵维度

路径确认支持水平由以下维度构成：

```text
线索数量
线索连续性
关键决策点覆盖
首次可见 / 首次可读线索出现时机
```

文件/条件映射当前采用：

```text
Signature1 = low
Signature2 = medium
Signature3 = high
```

## 6. 指标冻结

Y 主指标：

```text
route_confirmation_hesitation_index
```

由以下成分构成：

```text
prompt_to_first_confirmation_s
time_to_first_sign_readable_s
decision_total_look_count
decision_scan_both_count
```

旧版 `route_decision_hesitation_index` 只作为广义路线执行效率 / 敏感性指标，不再作为 Y 主指标。

M2 formal EEG 指标：

```text
综合端点：decision_point_enter_formal_load_delta
计划次级过程指标：decision_point_enter_frontal_theta_delta
```

行为机制线索：

```text
prompt_to_first_confirmation_s
```

该指标支持“可靠但未闭合”的解释，但不能替代 M1 问卷。

## 7. 问卷分工

用户已收集问卷，数据尚在整理。

每个地图 / 路线任务完成后填写：

```text
1. 官方信息链整体感受 -> M1 感知可靠性。
   包括官方路径确认线索可靠、准确支持路线判断、前后一致、值得继续依赖、沿线索继续判断可信。

2. 沿途与 A3 出口相关的现场标识 -> X 操纵检查 / 确认链闭合感。
   包括 A3 标识是否有效、是否及时看到、是否连续出现、是否避免长时间失去方向确认、关键分岔处是否帮助判断下一步方向。

3. 路线判断正确性的主观把握 -> 主观正确性 / 信心辅助变量。
   包括路线选择有信心、过程中确信每次方向正确、认为路线判断可靠。
```

完成全部三个地图后填写：

```text
4. 警报信息内容 -> W 保护性行动指令清晰度。
5. 空间 / 寻路能力 -> 个体差异协变量。
6. 身体感受 / VR 不适 -> QC、敏感性分析或控制变量。
```

W 是正式调节变量。后续需要确认 W 是实验操纵条件，还是仅以问卷分数作为 subject-level moderator。

## 8. 路径选择正确率

路径选择正确率是辅助因变量，不替代 Y，也不是中介。

用途：

```text
解释低支持下“行动快”不等于“绩效更好”。
低支持下可能启发式快速行动，但正确率较低。
随着路径确认支持水平提高，正确率预期逐步上升。
```

正式辅助假设：

```text
Accuracy_low < Accuracy_medium <= Accuracy_high
```

当前规则：

```text
所有测试唯一正确出口为 A3。
exit_label == A3 为正确，其他出口均为错误。
```

当前 32 名完整被试 / 96 个 canonical run 的最终路线正确性：

```text
low = 0.469
medium = 0.656
high = 0.719

high - low = 0.250, 95% CI [0.074, 0.426], p = .009
medium - low = 0.188, 95% CI [0.024, 0.351], p = .032
high - medium = 0.062, 95% CI [-0.023, 0.148], p = .161
```

解释：方向符合辅助假设，支持“低支持快但不准；支持提高后正确率上升”的速度-准确性权衡解释。

## 9. 当前主要结果

H1 行为主效应：

```text
route_confirmation_hesitation_index
n = 32
mean contrast = 0.242
95% CI [0.058, 0.427]
p = .0118
leave-one-subject-out: 32/32 次仍 p < .05
```

行为机制线索：

```text
prompt_to_first_confirmation_s
n = 32
mean contrast = 6.904 s
95% CI [2.228, 11.580]
p = .0051
```

M2 EEG 过程证据：

```text
decision_point_enter_frontal_theta_delta
n = 31
mean contrast = 0.171
95% CI [0.023, 0.318]
p = .0247
```

Formal EEG 综合端点：

```text
decision_point_enter_formal_load_delta
n = 31
mean contrast = 0.219
95% CI [-0.009, 0.447]
p = .0588
```

## 10. 不能过度声称

不能写：

```text
完整并行中介已经成立。
prompt_to_first_confirmation_s 可以替代 M1 问卷。
EEG 证明医学或生物学结论。
低支持行动快就代表管理效果更好。
正确率也应呈倒 U 型。
空间能力、身体不适或主观正确性是 M1/M2 中介。
信息越多越好，或信息越少越好。
```

可以写：

```text
当前数据支持倒 U 主效应。
当前数据支持 M2 的关键决策点 EEG 过程证据。
当前正确率辅助结果支持速度-准确性权衡解释。
完整 M1/M2 分段并行中介需要接入问卷数据后正式检验。
```

## 11. 重要文件

协议与备忘：

```text
docs/RESEARCH_DECISION_MEMORY.md
docs/CURRENT_CONTEXT.md
docs/PARALLEL_MEDIATION_MODEL_PROTOCOL.md
docs/MANAGEMENT_SCIENCE_EVIDENCE_PROTOCOL.md
docs/H1_CONFIRMATION_HESITATION_PROTOCOL.md
docs/EEG_PREPROCESSING_PROTOCOL.md
docs/XDF_LOCAL_EXPLORATION_2026-06-05.md
```

脚本：

```text
scripts/advanced_analysis_worker.py
scripts/h1_confirmation_robustness.py
scripts/eeg_mne_preprocessing.py
scripts/management_science_synthesis.py
scripts/local_xdf_effect_explorer.py
```

当前关键输出：

```text
work/xdf_exploration/canonical_run_rows.csv
work/xdf_exploration/h1_robustness_summary.json
work/eeg_mne_preprocessing/formal_eeg_report.html
work/management_science_synthesis/management_evidence_report.md
work/management_science_synthesis/management_accuracy_status.csv
work/management_science_synthesis/management_accuracy_contrasts.csv
```
