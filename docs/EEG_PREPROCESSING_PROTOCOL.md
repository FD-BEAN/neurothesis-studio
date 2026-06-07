# EEG 正式预处理与 H3 分析协议

更新日期：2026-06-07

## 1. 目标

现有 HTML worker 中的 EEG 输出用于快速 QC 和轻量探索，不能作为论文中 H3 的最终 EEG 证据。正式 EEG 结果必须使用 MNE-Python 预处理、事件窗 baseline、坏道/伪迹处理和可复跑 QC 输出。

正式脚本：

```text
scripts/eeg_mne_preprocessing.py
```

推荐本地运行：

```text
python scripts/eeg_mne_preprocessing.py --raw-dir work/xdf_raw --out-dir work/eeg_mne_preprocessing --line-freq 50
```

## 2. 输入与 stream 选择

输入为 LabRecorder `.xdf` 文件。每个文件必须包含：

- Unity marker stream，例如 `MetroRescueMarkers`。
- EEG/Mitsar stream 或同等 EEG stream。

stream 选择沿用 worker 的 deterministic 规则：

- marker stream：优先 `MetroRescueMarkers`，其次 marker-like stream。
- EEG stream：优先 Mitsar/EEG identity，其次通道数和时长更符合 EEG 的 stream。
- 多 EEG stream 时必须在 QC 中记录，正式论文结果前建议人工复核。

## 3. Trial window 与 marker 过滤

主 trial window：

```text
start = map_start / trial_start / session_start
end = evacuation_complete
```

若起止 marker 缺失，脚本可生成 QC，但该 run 不应直接进入 H3 主分析。marker 去重使用 `marker_duplicate_key`；真实重复的查看、扫描、停留事件不能被误删。

## 4. EEG 预处理步骤

正式预处理顺序固定为：

1. 读取 XDF 并对齐 EEG samples 与 XDF timestamps。
2. 提取通道标签；排除 event/marker/trigger/status/sync 等非 EEG 通道。
3. 将 Mitsar 常见参考后缀规范化，例如 `Fp1-AA` 记为 `Fp1`，以便匹配 10-20 montage 和额区/后部 ROI。
4. 初步坏道检测：flat、missing > 5%、robust SD/MAD-z 或 PTP/MAD-z > 8。
5. 创建 MNE `RawArray`。
6. 若通道标签可匹配 10-20 montage，设置 `standard_1020` montage。
7. notch filter：默认 50 Hz，可用 `--line-freq 60` 或 `--line-freq 0` 调整。
8. band-pass filter：默认 1-40 Hz。
9. 坏道处理：有 montage 且好通道足够时插值；否则删除坏道。
10. average reference。
11. 若原采样率高于 250 Hz，默认重采样到 250 Hz；可用 `--no-resample` 关闭。

ICA 暂不作为自动默认步骤，因为当前 XDF 中未确认稳定 EOG 通道；若后续补充 EOG 或人工标注眼动/肌电成分，应作为单独 amendment 加入。

## 5. 事件窗与 baseline

H3 主事件窗：

```text
decision_point_enter
baseline: -1.0 to 0.0 s
post:      0.0 to 2.0 s
```

H3 次事件窗：

```text
sign_readable
baseline: -1.0 to 0.0 s
post:      0.0 to 1.5 s
```

探索事件窗：

```text
sign_visible_enter
audio_play
```

事件必须满足 baseline 与 post window 完整落在 EEG 覆盖范围内，否则该 epoch 不进入正式事件窗特征。

## 6. 伪迹剔除

每个 event type 内，对候选 epoch 计算跨通道 median peak-to-peak。默认剔除：

```text
robust MAD-z > 6
```

该阈值是单位无关规则，避免 XDF 中 EEG 单位为 V、uV 或设备原始单位时产生不可比的固定微伏阈值。每个 run 必须记录候选 epoch、接受 epoch 和拒绝 epoch 数。

## 7. 频带与正式 EEG 指标

频带定义：

```text
theta = 4-7 Hz
alpha = 8-12 Hz
beta  = 13-30 Hz
```

每个 epoch 分别计算 baseline 与 post 的 Welch log band power，再计算：

```text
band_delta = post_log_power - baseline_log_power
```

区域规则：

- frontal theta：Fz/F3/F4/FC1/FC2；缺失时退化为全通道均值，并在 QC 中记录。
- posterior alpha：Pz/P3/P4/O1/O2/Oz；缺失时退化为全通道均值，并在 QC 中记录。

正式 H3 事件窗指标：

```text
formal_load_delta =
  frontal_theta_delta
  - posterior_alpha_delta
  + theta_alpha_delta
```

其中：

```text
theta_alpha_delta = global_theta_delta - global_alpha_delta
```

主 H3 EEG 端点冻结为：

```text
decision_point_enter_formal_load_delta
```

次端点：

```text
sign_readable_formal_load_delta
trial_formal_load_proxy
decision_point_enter_frontal_theta_delta
decision_point_enter_posterior_alpha_delta
```

## 8. 统计计划

统计单位为被试。每名完整被试需要低 / 中 / 高三个条件都有可用正式 EEG 特征。

如果同一被试同一条件存在多个 XDF，formal contrast 的 canonical run 选择顺序固定为：

```text
1. 优先非 old 文件
2. decision_point_enter 接受 epoch 更多
3. sign_readable 接受 epoch 更多
4. trial_formal_load_proxy 可计算
```

主 planned contrast：

```text
medium - mean(low, high)
low = -0.5
medium = 1.0
high = -0.5
```

主检验：

```text
decision_point_enter_formal_load_delta
two-sided one-sample t test on subject contrasts
95% CI and dz
```

必须同时报告：

- 每个条件的接受 epoch 数。
- 每个条件的坏道数、插值/删除数。
- trial EEG coverage ratio。
- H3 主端点缺失的被试数及原因。
- 对 `sign_readable_formal_load_delta` 的次分析。

探索端点需要控制多重比较或明确标为 exploratory，不能反向改变 H3 主端点。

## 9. 输出文件

脚本输出：

```text
formal_eeg_run_qc.csv
formal_eeg_run_features.csv
formal_eeg_event_summary.csv
formal_eeg_epoch_features.csv
formal_eeg_subject_contrasts.csv
formal_eeg_contrast_summary.csv
formal_eeg_condition_profiles.csv
formal_eeg_pairwise_results.csv
formal_eeg_robustness_results.csv
formal_eeg_leave_one_subject_out.csv
formal_eeg_report.html
formal_eeg_summary.json
```

这些文件位于 `work/eeg_mne_preprocessing`，不进入 Git；论文和报告只引用由脚本复跑得到的结果。

## 10. 2026-06-07 本地全量验证

已在当前本地 97 个 XDF 上试跑：

```text
python scripts/eeg_mne_preprocessing.py --raw-dir work/xdf_raw --out-dir work/eeg_mne_preprocessing --line-freq 50
```

QC 结果：

```text
files_completed = 97 / 97
montage_set = 97 / 97
region_fallback = 0 / 97
decision_point_enter epochs = 419 accepted / 430 candidates
sign_readable epochs = 1855 accepted / 1884 candidates
complete subjects for formal contrast = P03-P34, 32 subjects
decision_point_enter formal endpoint n = 31, because P27 high has 0 decision-point candidate epoch
```

当前 formal EEG planned contrast：

```text
decision_point_enter_formal_load_delta:
n = 31, mean contrast = 0.219,
95% CI [-0.009, 0.447], t = 1.96, p = .0588, dz = 0.35
bootstrap 95% CI [0.0145, 0.4459]
bootstrap P(mean > 0) = .982
sign-flip p = .0593
leave-one-subject-out: 10/31 次 p < .05

decision_point_enter_frontal_theta_delta:
n = 31, mean contrast = 0.171,
95% CI [0.023, 0.318], t = 2.36, p = .0247, dz = 0.42
bootstrap 95% CI [0.0317, 0.3120]
bootstrap P(mean > 0) = .993
sign-flip p = .0252
Wilcoxon p = .0479
leave-one-subject-out: 31/31 次 p < .05
```

解释边界：formal load composite 作为 H3 事件窗综合端点目前是边缘结果；decision-point frontal theta 是预先保留的生理成分证据，可以作为支持“中等支持增加关键决策点加工负荷”的 planned secondary EEG 结果报告。不能把该次成分事后改写成唯一主 EEG 端点，除非在最终 90 名被试数据锁定前明确写成 protocol amendment，并保留 composite 的结果。

pairwise 结构：

```text
decision_point_enter_formal_load_delta:
medium - high: mean = 0.217, p = .0495
medium - low:  mean = 0.221, p = .1366
high - low:    mean = 0.004, p = .9717

decision_point_enter_frontal_theta_delta:
medium - low:  mean = 0.193, p = .0412
medium - high: mean = 0.149, p = .0635
high - low:    mean = 0.044, p = .6123
```

展示建议：`formal_eeg_report.html` 是当前最适合给导师/论文草稿看的版本；它把 QC、主端点、planned secondary 生理成分、稳健性和 pairwise 结果放在同一份报告里。
