# H1、问卷与分段并行中介正式分析计划

更新日期：2026-06-10

## 1. 目的

本文档把当前研究模型转成可执行分析流程，避免后续因为上下文变长或数据继续整理而改变主指标、改变中介角色或按显著性选择指标。

核心原则：

```text
H1 主效应先行。
M1 必须来自问卷。
M2 必须来自 EEG 事件窗。
正确率只作为辅助因变量解释速度-准确性权衡。
W 是正式调节变量。
```

## 2. 冻结研究模型

```text
X：路径确认支持水平，low / medium / high
Y：行动迟滞，route_confirmation_hesitation_index
M1：感知可靠性，perceived_reliability_score
M2：信息加工负荷，decision_point_enter_formal_load_delta / decision_point_enter_frontal_theta_delta
W：保护性行动指令清晰度，protective_action_instruction_clarity_score
Y_aux：路径选择正确率
```

H1 主效应：

```text
路径确认支持水平对行动迟滞具有倒 U 型影响。
主 planned contrast = medium - mean(low, high)
权重：low = -0.5, medium = 1.0, high = -0.5
```

当前 H1 证据：

```text
route_confirmation_hesitation_index:
n = 32
contrast = 0.242
95% CI [0.058, 0.427]
p = .0118
Wilcoxon p = .012
sign-flip p = .012
leave-one-subject-out = 32/32 p < .05
```

三条件均值：

```text
low = -0.082
medium = 0.161
high = -0.080
```

## 3. 问卷数据接入

脚本：

```text
scripts/questionnaire_integration.py
```

默认输入：

```text
work/questionnaire/questionnaire_responses.csv
```

如果输入不存在，脚本会生成：

```text
work/questionnaire/questionnaire_template.csv
work/questionnaire/questionnaire_codebook.csv
```

默认输出：

```text
work/questionnaire/questionnaire_scale_scores.csv
work/questionnaire/questionnaire_subject_covariates.csv
work/questionnaire/questionnaire_segment_mediation_ready.csv
work/questionnaire/questionnaire_analysis_summary.json
```

### 3.1 每个地图后填写

官方信息链整体感受：

```text
reliability_item_1..5 -> perceived_reliability_score
```

该量表是 M1，不能用 XDF 行为指标替代。

沿途与 A3 出口相关的现场标识：

```text
a3_signage_item_1..4 -> route_closure_manipulation_check_score
```

该量表用于 X 操纵检查 / 确认链闭合感，不是 M1。

路线判断正确性的主观把握：

```text
subjective_correctness_item_1..3 -> subjective_route_confidence_score
```

该量表是主观信心辅助变量，不等于客观正确率。

### 3.2 完成全部三个地图后填写

警报信息内容：

```text
warning_clarity_item_1..4 -> protective_action_instruction_clarity_score
```

该量表是 W。如果后续确认 W 是实验操纵条件，则优先使用实验条件；如果只是问卷测量，则作为 subject-level moderator。

空间 / 寻路能力：

```text
spatial_ability_item_1..7 -> spatial_ability_score
```

其中 `spatial_ability_item_6` 和 `spatial_ability_item_7` 反向计分，因为它们表达迷失方向或依赖他人带路。

身体感受 / VR 不适：

```text
vr_discomfort_* -> vr_discomfort_score
```

该分数用于 QC、敏感性或控制变量，不作为理论中介。

## 4. 分段并行中介检验

本研究不把三水平 X 直接塞进一个线性中介模型，而是先把倒 U 主效应拆成两个相邻阶段。

低支持到中等支持：

```text
ΔY_LM  = Y_medium  - Y_low
ΔM1_LM = M1_medium - M1_low
ΔM2_LM = M2_medium - M2_low
```

预期：

```text
ΔY_LM > 0
ΔM1_LM > 0
ΔM1_LM 预测 ΔY_LM
M1 的低->中间接效应强于 M2
```

中等支持到高支持：

```text
ΔY_MH  = Y_medium  - Y_high
ΔM1_MH = M1_medium - M1_high
ΔM2_MH = M2_medium - M2_high
```

预期：

```text
ΔY_MH > 0
ΔM2_MH > 0
ΔM2_MH 预测 ΔY_MH
M2 的中->高间接效应强于 M1
```

推荐回归表达：

```text
ΔY_LM ~ ΔM1_LM + ΔM2_LM + W + spatial_ability + vr_discomfort + run_order
ΔY_MH ~ ΔM1_MH + ΔM2_MH + W + spatial_ability + vr_discomfort + run_order
```

如样本量允许，使用 bootstrap 报告间接效应置信区间。若问卷信度不足，应先报告量表诊断，不应硬写中介成立。

## 5. W 调节检验

W 的理论角色是改变官方目标提醒与现场路径确认线索之间的匹配效果。优先检验：

```text
H1 contrast ~ W
ΔM1_LM ~ W
ΔM2_MH ~ W
ΔY_LM ~ ΔM1_LM * W + ΔM2_LM
ΔY_MH ~ ΔM2_MH * W + ΔM1_MH
```

如果 W 只有很小方差或所有被试评分接近，应写为“W 未能提供足够被试间差异进行调节检验”，不要强行解释不稳定交互。

## 6. 正确率辅助分析

正确率理论方向是单调提高，而不是倒 U。

```text
Accuracy_low < Accuracy_medium <= Accuracy_high
```

优先级：

```text
1. decision_choice_accuracy_ratio
2. first_choice_correct
3. final_arrival_correct / success / correct_exit
4. exit_label == A3
```

当前实验唯一正确出口为 A3，因此可用：

```text
exit_label == A3 -> correct
其他出口 -> incorrect
```

当前辅助结果：

```text
low = 0.469
medium = 0.656
high = 0.719
high - low = 0.250, p = .009
medium - low = 0.188, p = .032
high - medium = 0.062, p = .161
```

写作口径：

```text
低支持下被试可能更快采用启发式行动，但路线正确性较低。
随着路径确认支持提升，正确率上升；这支持速度-准确性权衡解释。
正确率不替代行动迟滞，也不参与倒 U 主效应检验。
```

## 7. 报告顺序

论文结果部分建议固定顺序：

```text
1. H1 主 planned contrast
2. 三条件均值和倒 U 形状
3. 个体峰值诊断
4. 地图校正模型
5. 低->中 / 中->高相邻阶段
6. 组件敏感性
7. QC 敏感性
8. 正确率辅助结果
9. M2 EEG 过程证据
10. M1/M2/W 问卷接入后的分段并行中介与调节检验
```

不要把 `prompt_to_first_confirmation_s`、EEG theta 或正确率放在 H1 主结果之前。它们是解释机制和过程证据，不是替代主效应的指标。

## 8. 不能过度声称

不能写：

```text
完整并行中介已经成立。
行为指标可以替代感知可靠性问卷。
EEG 证明医学或生物学结论。
正确率也呈倒 U 型。
低支持行动快就是管理效果更好。
W 调节成立，除非问卷或实验条件模型支持。
```

可以写：

```text
当前行为数据支持 H1 倒 U 主效应。
正确率辅助结果支持低支持下速度-准确性权衡解释。
EEG 在关键决策点提供 M2 信息加工负荷的神经工程过程证据。
完整 M1/M2 分段并行中介和 W 调节需要问卷数据接入后检验。
```

## 9. 2026-07-05 H1 指标 amendment

全量 XDF 分析后，正式 H1 行动迟滞主原始指标改为：

```text
prompt_to_first_confirmation_s
```

中文写作：

```text
官方提示到首次现场路径确认延迟
```

修订理由：

```text
1. 它直接测量官方提示之后个体多久完成首次现场路径确认，最贴近行动迟滞的理论定义。
2. route_confirmation_hesitation_index 混入首次可读线索、查看次数和双侧扫描，容易受地图可见性和高支持线索数量影响。
3. route_decision_hesitation_index 混入整段路线执行效率，不适合检验“官方确认链导致的近端迟滞”。
```

全量结果：

```text
n = 98
low = 7.401 秒
medium = 12.721 秒
high = 3.033 秒
planned contrast = 7.504 秒
95% CI [4.130, 10.878]
p = 2.63e-5
```

后续问卷接入时：

```text
Y = prompt_to_first_confirmation_s 的 subject-level planned contrast
M1 = perceived_reliability_score 的 low->medium 机制
M2 = formal EEG information-processing load 的 medium->high 机制
route_confirmation_hesitation_index 只作为复合敏感性结果
```
