# 分段并行中介与 W 调节协议

更新日期：2026-07-05

## 1. 固定变量

本研究是神经工程管理论文，不按医学诊断或生物标志物来解释 EEG。EEG 在这里是信息加工过程证据，用来说明路径确认支持这种管理信息设计是否改变了关键决策点的确认成本。

```text
X  = 路径确认支持水平：low / medium / high
Y  = 行动迟滞：prompt_to_first_confirmation_s
M1 = 感知可靠性：perceived_reliability_score
M2 = 信息加工负荷：decision_point_enter_frontal_theta_delta
W  = 保护性行动指令清晰度：protective_action_instruction_clarity_score
```

`prompt_to_first_confirmation_s` 是 H1 的主原始指标，中文写作固定为“官方提示到首次现场路径确认延迟”。`route_confirmation_hesitation_index` 保留为复合敏感性指标，`route_decision_hesitation_index` 只作为广义路线执行效率边界指标。

## 2. 主效应先行

H1 不用线性趋势解释，而用 planned contrast 检验倒 U 型：

```text
H1 contrast = Y_medium - mean(Y_low, Y_high)
权重：low = -0.5, medium = 1.0, high = -0.5
```

当前全量 XDF 结果：

```text
n = 98
low = 7.401 s
medium = 12.721 s
high = 3.033 s
planned contrast = 7.504 s
95% CI [4.130, 10.878]
p = 2.63e-5
```

这部分已经可以写作“行为数据支持中等路径确认支持条件下行动迟滞最高”。正确率只做辅助解释：低支持下行动较快，但正确率较低；高支持下确认闭合更充分，正确率最高。

## 3. 分段中介

倒 U 主效应拆成两个相邻阶段，不把三水平 X 硬塞进一个线性中介模型。

低支持到中等支持：

```text
delta_y_lm  = Y_medium - Y_low
delta_m1_lm = M1_medium - M1_low
```

这一段的理论主导变量是 M1。低支持下，个体认为官方线索不值得持续依赖，更容易转向启发式行动；中等支持下，官方线索开始变得可参考，个体愿意继续搜索和核对，行动迟滞上升。

中等支持到高支持：

```text
delta_y_mh  = Y_medium - Y_high
delta_m2_mh = M2_medium - M2_high
```

这一段的理论主导变量是 M2。中等支持下，线索足够可靠但未完全闭合，个体需要整合更多信息；高支持下，确认链更完整，信息加工负荷下降，行动迟滞随之下降。

## 4. 回归和交互

脚本：

```text
scripts/questionnaire_integration.py
scripts/segmented_mediation_analysis.py
```

正式问卷接入后，先生成：

```text
work/questionnaire/questionnaire_segment_mediation_ready.csv
```

然后运行：

```text
python scripts/segmented_mediation_analysis.py
```

主要模型：

```text
delta_y_lm ~ delta_m1_lm + spatial_ability_score + vr_discomfort_score
delta_y_mh ~ delta_m2_mh + spatial_ability_score + vr_discomfort_score
```

W 调节模型：

```text
delta_y_lm ~ delta_m1_lm * W + spatial_ability_score + vr_discomfort_score
delta_y_mh ~ delta_m2_mh * W + spatial_ability_score + vr_discomfort_score
h1_planned_contrast ~ W + spatial_ability_score + vr_discomfort_score
```

W 只解释调节，不替代 M1 或 M2。若 W 方差很小，报告为“W 未提供足够被试间差异进行稳定调节检验”，不强行解释交互。

## 5. 当前边界

当前仓库里还没有真实 `work/questionnaire/questionnaire_responses.csv`。因此现在可以正式报告：

```text
H1 倒 U 主效应
正确率辅助结果
EEG M2 过程证据
```

现在不能报告：

```text
完整 M1/M2 分段并行中介已经成立
W 调节已经成立
感知可靠性可以由 XDF 行为指标替代
```

问卷到位后，`questionnaire_integration.py` 会接受两种格式：

```text
长表：一名被试 × 一个支持条件一行
宽表：一名被试一行，low/medium/high 题项分列
```

如果只有宽表，脚本会自动拆成 low / medium / high 三行，再合并 H1 行为表和 EEG 被试表。
