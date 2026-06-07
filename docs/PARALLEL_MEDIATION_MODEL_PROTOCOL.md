# 倒 U 主效应与分段并行中介模型协议

更新日期：2026-06-07

## 1. 研究模型

本论文的核心模型为：

```text
X：路径确认支持水平
Y：行动迟滞
M1：感知可靠性，问卷测量
M2：信息加工负荷，EEG 测量
```

主效应假设：

```text
路径确认支持水平 -> 行动迟滞
中等支持 > 低支持和高支持平均
```

该主效应不是线性效应，而是倒 U 型效应。正式 planned contrast 固定为：

```text
medium - mean(low, high)
low = -0.5
medium = 1.0
high = -0.5
```

## 2. 理论逻辑

路径确认支持水平并非“越多越好”或“越少越好”。其管理效应取决于个体是否愿意依赖官方线索，以及这些线索是否足以快速闭合路线确认。

本研究借用启发式决策理论解释这一过程。启发式决策不是简单的“不理性”，而包含两个来源：

```text
1. 理性权衡：
   个体会在准确性收益与操作成本之间权衡。
   当继续搜索和确认的成本高于准确性提升带来的收益时，采用省时省力的启发式行动是合理的。
   但这种行动通常伴随准确性局限。

2. 认知局限：
   个体的信息处理能力有限，无法在所有情境下完成充分、最优的理性计算。
   因此，个体可能忽略部分信息，用更经济的方式完成判断和选择。
```

这正是本研究设置两个并行中介的原因：

```text
M1 感知可靠性：对应理性权衡过程，解释个体是否认为官方线索值得继续依赖。
M2 信息加工负荷：对应认知局限过程，解释个体在确认链未闭合时是否承担过高的信息整合负担。
```

低支持条件下，官方线索不够可靠或不值得持续依赖，个体更可能放弃官方确认链，转向自主行动，因此行动迟滞较低。

中等支持条件下，官方线索变得足够可靠，个体愿意继续参考；但线索仍不足以快速完成路线确认，个体需要持续搜索、核对和整合信息，因此行动迟滞最高。

高支持条件下，线索更连续、更明确、更容易闭合确认链，信息加工负荷下降，个体能更快完成确认，行动迟滞降低。

## 3. 并行中介与分段主导

本研究不是单一中介模型，而是两个并行中介在不同阶段主导同一个倒 U 型主效应。

```text
低支持 -> 中等支持：M1 感知可靠性主导
中等支持 -> 高支持：M2 信息加工负荷主导
```

重要约束：

```text
X -> M1 和 X -> M2 的具体形态可以随着问卷、EEG 和行为证据微调。
但中介主导逻辑必须跟随主效应：
low -> medium 阶段要解释行动迟滞为什么上升；
medium -> high 阶段要解释行动迟滞为什么下降。
```

### 3.1 低支持到中等支持：感知可靠性主导

假设：

```text
low -> medium:
路径确认支持提高
  -> 感知可靠性提高，准确性收益开始超过操作成本
  -> 个体从启发式快速行动转向持续依赖官方线索并进行更多确认
  -> 行动迟滞上升
```

统计检验以相邻差值为主：

```text
ΔY_LM  = Y_medium  - Y_low
ΔM1_LM = M1_medium - M1_low
ΔM2_LM = M2_medium - M2_low
```

预期：

```text
ΔM1_LM > 0
ΔY_LM > 0
ΔM1_LM 与 ΔY_LM 正相关
M1 的 low -> medium 间接效应强于 M2
```

### 3.2 中等支持到高支持：信息加工负荷主导

假设：

```text
medium -> high:
路径确认支持进一步提高
  -> 确认链更容易闭合
  -> 认知局限造成的信息整合负担降低
  -> 行动迟滞降低
```

为了让方向与主效应一致，统计上使用：

```text
ΔY_MH  = Y_medium  - Y_high
ΔM1_MH = M1_medium - M1_high
ΔM2_MH = M2_medium - M2_high
```

预期：

```text
ΔM2_MH > 0
ΔY_MH > 0
ΔM2_MH 与 ΔY_MH 正相关
M2 的 medium -> high 间接效应强于 M1
```

## 4. 变量测量

### 4.1 X：路径确认支持水平

正式条件：

```text
low
medium
high
```

文件映射：

```text
三连号第 1 个 run = low
三连号第 2 个 run = medium
三连号第 3 个 run = high
```

或：

```text
Signature1 = low
Signature2 = medium
Signature3 = high
```

操纵维度固定为：

```text
线索数量
线索连续性
关键决策点覆盖
首次可见 / 首次可读线索出现时机
```

### 4.2 Y：行动迟滞

正式主指标：

```text
route_confirmation_hesitation_index
```

该指标聚焦近端路径确认迟滞，由以下行为成分构成：

```text
prompt_to_first_confirmation_s
time_to_first_sign_readable_s
decision_total_look_count
decision_scan_both_count
```

旧版 `route_decision_hesitation_index` 仅作为广义路线执行效率敏感性指标，不再作为 Y 的主指标。

### 4.3 M1：感知可靠性

M1 必须来自问卷，不从 XDF 行为或 EEG 中代理。

用户已收集 per-map 问卷：每名被试每完成一个地图/路线任务后填写一次。M1 推荐使用“官方信息链整体感受”题组作为正式感知可靠性量表。

M1 正式候选题项：

```text
当前官方路径确认线索是可靠的。
当前官方路径确认线索能够准确支持我的路线判断。
当前官方路径确认线索前后一致。
当前官方路径确认线索值得我继续依赖。
我认为沿着当前官方路径确认线索继续判断路线是可信的。
```

推荐 7 点 Likert：

```text
1 = 非常不同意
7 = 非常同意
```

数据结构建议：

```text
participant_id, condition, reliability_item_1, reliability_item_2, reliability_item_3, reliability_item_4
P03, low, ...
P03, medium, ...
P03, high, ...
```

正式 M1 指标：

```text
perceived_reliability_score = mean(valid reliability items)
```

另一个 per-map 题组“沿途与目标出口相关的现场标识”更适合作为 X 操纵检查 / 确认链闭合感，而不是替代 M1：

```text
这些出口相关标识能够有效帮助我完成前往 A3 出口的逃生寻路任务。
在我需要做出路线选择之前，我能够及时看到与 A3 出口相关的标识。
沿途 A3 出口的相关标识是连续出现的，不会让我长时间失去方向确认。
在关键分岔处，A3 的相关标识能够帮助我判断下一步方向。
```

per-map “路线判断正确性的主观把握程度”题组应作为主观信心 / 主观正确性辅助变量，而不是客观正确率：

```text
我对自己刚才的路线选择有信心。
我在过程中确信自己每次选择的方向是正确的。
我认为自己刚才的路线判断是可靠的。
```

需报告 Cronbach alpha 或 McDonald's omega；如果信度不足，应报告单项或重新审查问卷结构。

最小 CSV 模板：

```csv
participant_id,condition,reliability_item_1,reliability_item_2,reliability_item_3,reliability_item_4
P03,low,,,,
P03,medium,,,,
P03,high,,,,
```

可接受的宽表模板：

```csv
participant_id,reliability_low,reliability_medium,reliability_high
P03,,,
```

后续脚本应把宽表转换为长表，并与 `route_confirmation_hesitation_index` 和 formal EEG subject contrasts 通过 `participant_id` / `subject` 合并。

### 4.4 M2：信息加工负荷

M2 由 formal EEG 测量。

正式 H3 综合端点：

```text
decision_point_enter_formal_load_delta
```

计划次级过程指标：

```text
decision_point_enter_frontal_theta_delta
```

当前数据中，综合 EEG 端点为边缘结果，额区 theta 增量更稳定。因此论文应写为：M2 的综合指标呈趋势，额区 theta 作为计划次级神经工程过程证据支持中等支持下的关键节点信息加工负荷上升。

### 4.5 Y_aux：路径选择正确率

路径选择正确率是辅助因变量，用于解释速度-准确性权衡，不替代 Y，也不作为中介变量。

理论位置：

```text
低支持：启发式搜索 / 自主行动更快，但正确率较低
中等支持：开始依赖官方线索并持续核对，正确率应提高，但行动迟滞最高
高支持：确认链更闭合，正确率继续提高或保持高水平，行动迟滞下降
```

正式辅助假设：

```text
Accuracy_low < Accuracy_medium <= Accuracy_high
```

可接受的 marker / 日志字段：

```text
decision_choice_accuracy_ratio
first_choice_correct
choice_correct
decision_correct
route_choice_correct
final_arrival_correct
success
reached_target
correct_exit
exit_label
```

优先级：

```text
1. 决策点选择正确率：decision_choice_accuracy_ratio
2. 首次方向选择是否正确：first_choice_correct
3. 最终是否到达正确出口：final_arrival_correct / success / correct_exit
4. 若 correctness marker 缺失，则使用最终出口标签：exit_label == A3 为正确，其他出口为错误
```

当前实验规则：所有测试的唯一正确出口为 A3。因此，最终到达正确性可由 `exit_label == A3` 推断。

### 4.6 W：保护性行动指令清晰度

W 是正式调节变量。用户已收集 post-all 问卷：被试完成全部三个地图后填写。

推荐 W 题项来自“警报信息内容”题组：

```text
警报中的信息内容有助于我判断应该如何撤离。
警报中的信息内容清楚地指导我应前往哪个出口以及采取什么撤离行动。
警报中的信息内容准确说明了目标出口、撤离方向和行动要求。
警报中的信息细节程度是合适的，足以让我知道下一步该怎么做。
```

正式 W 指标：

```text
protective_action_instruction_clarity_score = mean(valid warning clarity items)
```

如果 W 在实验设计中是组间操纵，应优先使用实验条件；如果只是问卷测量，应作为 subject-level moderator 与 X 的交互进入模型。

其他 post-all 题组处理：

```text
空间/寻路能力题组：个体差异协变量。
身体感受 / VR 不适题组：QC、敏感性分析或控制变量，不作为理论中介。
```

解释边界：

- 低支持条件下行动迟滞较低，不能直接写成“绩效更好”。
- 如果低支持同时正确率较低，可解释为被试放弃官方确认链，转向启发式快速行动。
- 正确率的理论方向应是随路径确认支持水平提高而逐步上升；这与行动迟滞的倒 U 型主效应并不矛盾。
- 正确率只服务于辅助解释，不改变主效应 planned contrast。

## 5. 统计分析计划

### 5.1 主效应

主检验：

```text
Y_medium - mean(Y_low, Y_high)
```

同时报告：

```text
Y_medium - Y_low
Y_medium - Y_high
Y_high - Y_low
```

主效应成立的理想模式：

```text
medium - mean(low, high) > 0
medium - low > 0
medium - high > 0
high - low 接近 0 或不显著
```

### 5.2 分段中介

采用相邻差值模型，而不是把三水平 X 直接塞进一个线性中介。

#### 低 -> 中阶段

```text
ΔY_LM  = Y_medium  - Y_low
ΔM1_LM = M1_medium - M1_low
```

检验：

```text
ΔM1_LM 是否 > 0
ΔY_LM 是否 > 0
ΔM1_LM 是否预测 ΔY_LM
bootstrap indirect effect: low -> medium -> M1 -> Y
```

M2 在这一阶段作为并行竞争中介进入模型，用于证明 M1 主导而非唯一存在。

#### 中 -> 高阶段

```text
ΔY_MH  = Y_medium  - Y_high
ΔM2_MH = M2_medium - M2_high
```

检验：

```text
ΔM2_MH 是否 > 0
ΔY_MH 是否 > 0
ΔM2_MH 是否预测 ΔY_MH
bootstrap indirect effect: medium -> high -> M2 -> Y
```

M1 在这一阶段作为并行竞争中介进入模型，用于证明 M2 主导。

### 5.3 正式模型表达

推荐报告两类结果：

1. 被试内 planned contrast：

```text
Y ~ support_level
主 contrast: medium - mean(low, high)
```

2. 分段差值中介：

```text
ΔY_LM ~ ΔM1_LM + ΔM2_LM + covariates
ΔY_MH ~ ΔM1_MH + ΔM2_MH + covariates
```

如果样本量允许，可使用 bootstrap 估计间接效应置信区间。

### 5.4 辅助正确率分析

路径选择正确率采用单调趋势检验，而不是倒 U 型 planned contrast。

主辅助检验：

```text
Accuracy_low < Accuracy_medium < Accuracy_high
```

同时报告：

```text
Accuracy_medium - Accuracy_low
Accuracy_high - Accuracy_medium
Accuracy_high - Accuracy_low
```

如果正确率只有二分类结果，应使用被试内二项/逻辑模型或先聚合为每条件正确率；如果只有最终到达正确性，则写为“最终正确性辅助结果”，不能替代决策点正确率。

## 6. 当前数据状态

已支持：

```text
Y 主效应倒 U：
route_confirmation_hesitation_index
n = 32, mean contrast = 0.242, p = .0118
```

已有行为机制线索：

```text
prompt_to_first_confirmation_s
n = 32, mean contrast = 6.904 s, p = .0051
```

已有 M2 EEG 过程证据：

```text
decision_point_enter_frontal_theta_delta
n = 31, mean contrast = 0.171, p = .0247
```

尚缺：

```text
M1 感知可靠性问卷数据
W 保护性行动指令清晰度问卷数据
正式 M1/M2 并行中介检验
低->中与中->高两段间接效应 bootstrap
```

当前 `canonical_run_rows.csv` 已有 `exit_label`，且 A3 为唯一正确出口，因此可以先报告最终路线正确性辅助结果；若后续 Unity marker 能写入 `choice_correct` 或 `route_choice_correct`，再升级为决策点正确率。现在可以强写主效应、M2 过程证据和最终正确性辅助结果，但不能声称完整并行中介模型已经被检验成立。下一步最高优先级是接入感知可靠性问卷数据和 W 问卷数据，并做分段差值中介与调节效应检验。

当前最终路线正确性辅助结果：

```text
low = 0.469
medium = 0.656
high = 0.719

high - low = 0.250, 95% CI [0.074, 0.426], p = .009
medium - low = 0.188, 95% CI [0.024, 0.351], p = .032
high - medium = 0.062, 95% CI [-0.023, 0.148], p = .161
```
