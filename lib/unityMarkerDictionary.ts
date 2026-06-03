export type UnityMarkerFamily = "trial" | "instruction" | "signage" | "decision" | "navigation" | "accuracy";

export type UnityMarkerSpec = {
  event: string;
  family: UnityMarkerFamily;
  label: string;
  required: "required" | "recommended" | "optional";
  purpose: string;
  payload?: string;
};

export const unityMarkerFamilyLabels: Record<UnityMarkerFamily, string> = {
  trial: "实验时段",
  instruction: "指令与提醒",
  signage: "标识确认",
  decision: "决策点行为",
  navigation: "路径执行",
  accuracy: "正确性",
};

export const unityMarkerDictionary: UnityMarkerSpec[] = [
  {
    event: "map_start",
    family: "trial",
    label: "场景开始",
    required: "required",
    purpose: "确定 trial 起点，用于计算完成时长和 EEG 分析窗。",
    payload: "subject/session/map/signature/support_level/run_order",
  },
  {
    event: "evacuation_complete",
    family: "trial",
    label: "疏散完成",
    required: "required",
    purpose: "确定 trial 终点，并记录是否到达正确出口。",
    payload: "exit/final_correct/success/horizontal_distance_m",
  },
  {
    event: "audio_play",
    family: "instruction",
    label: "官方目标提醒",
    required: "recommended",
    purpose: "标记保护性行动指令出现时间，用于计算提醒到首次现场确认线索的延迟。",
    payload: "message_id/instruction_clarity/target_exit",
  },
  {
    event: "movement_start",
    family: "navigation",
    label: "首次行动启动",
    required: "recommended",
    purpose: "计算行动启动延迟，避免只用总时长解释行动迟滞。",
  },
  {
    event: "sign_visible_enter",
    family: "signage",
    label: "标识进入可见范围",
    required: "recommended",
    purpose: "作为标识可读比例、可见到可读延迟和线索覆盖的分母。",
    payload: "sign_id/signature/location/decision_point_id",
  },
  {
    event: "sign_readable",
    family: "signage",
    label: "标识达到可读状态",
    required: "required",
    purpose: "核心路径确认线索，用于确认链连续性和 sign_readable EEG 事件窗。",
    payload: "sign_id/signature/location/decision_point_id/direction_hint",
  },
  {
    event: "sign_readable_exit",
    family: "signage",
    label: "离开可读状态",
    required: "optional",
    purpose: "用于估计标识可读停留时长。",
  },
  {
    event: "decision_point_enter",
    family: "decision",
    label: "进入关键决策点",
    required: "required",
    purpose: "核心事件窗，用于计算决策点停留、扫描行为和 decision_point EEG 负荷。",
    payload: "decision_point_id/correct_direction",
  },
  {
    event: "decision_look_left",
    family: "decision",
    label: "向左查看",
    required: "recommended",
    purpose: "刻画关键节点的主动扫描与核对。",
  },
  {
    event: "decision_look_right",
    family: "decision",
    label: "向右查看",
    required: "recommended",
    purpose: "与向左查看共同计算查看总数与左右不平衡。",
  },
  {
    event: "decision_scan_both_sides",
    family: "decision",
    label: "双侧扫描",
    required: "recommended",
    purpose: "作为反复核对和行动迟滞的行为证据。",
  },
  {
    event: "decision_point_exit",
    family: "decision",
    label: "离开关键决策点",
    required: "recommended",
    purpose: "与 decision_point_enter 配对计算决策点停留时长。",
  },
  {
    event: "choice_made",
    family: "accuracy",
    label: "做出方向选择",
    required: "recommended",
    purpose: "记录每个关键节点的选择正确性，用于区分快速但错误和快速且正确。",
    payload: "decision_point_id/chosen_direction/correct_direction/choice_correct",
  },
  {
    event: "dwell_detected",
    family: "navigation",
    label: "停留",
    required: "optional",
    purpose: "辅助识别迟滞和低效导航。",
  },
  {
    event: "u_turn_detected",
    family: "navigation",
    label: "掉头",
    required: "optional",
    purpose: "辅助识别路径确认失败或路线修正。",
  },
  {
    event: "route_backtrack_detected",
    family: "navigation",
    label: "回退",
    required: "optional",
    purpose: "辅助识别走回头路和路径执行低效。",
  },
];

export const analysisPipelineStages = [
  {
    title: "单 run 质控",
    detail: "解析 XDF streams，确认 Mitsar EEG 与 MetroRescueMarkers 时间覆盖、采样率、marker 完整性和事件窗数量。",
  },
  {
    title: "事件与行为特征",
    detail: "从 Unity marker 提取完成时长、启动延迟、标识可读、决策点停留、左右查看、扫描、掉头、回退和正确性线索。",
  },
  {
    title: "EEG 事件窗特征",
    detail: "围绕 sign_readable 与 decision_point_enter 提取 theta、alpha、theta/alpha 和 EEG load proxy。",
  },
  {
    title: "单被试三条件",
    detail: "把同一被试低/中/高三个 XDF 合并，计算 medium - mean(low, high) planned contrast。",
  },
  {
    title: "全样本组内检验",
    detail: "汇总 P01-P90 的 subject-level contrast，检验中等路径确认支持是否带来更高行动迟滞和 EEG 负荷。",
  },
  {
    title: "组间与调节分析",
    detail: "用 subject metadata 检验 SupportLevel × Group，正式论文中优先使用 mixed-effects model。",
  },
];
