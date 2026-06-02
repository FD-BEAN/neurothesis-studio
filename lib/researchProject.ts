export const researchProject = {
  name: "Metro Rescue",
  subtitle: "VR 地铁撤离任务中的标识密度、导向决策与 EEG 认知负荷研究",
  keywords: ["Metro Rescue", "VR 地铁撤离", "标识密度", "导向标识", "认知负荷", "LSL marker", "EEG .xdf"],
  design: {
    maps: ["Metro1", "Metro2", "Metro3"],
    densityLevels: ["低密度", "中密度", "高密度"],
    expectedSubjects: 90,
    runsPerSubject: 3,
    expectedRuns: 270,
    withinSubjectFactor: "Density",
    primaryHypothesis: "中等密度场景可能产生最高认知负荷。",
    primaryContrast: "medium - mean(low, high)",
  },
  figures: [
    {
      id: "fig-1",
      title: "实验流程图",
      use: "研究设计总览、方法部分第一张图",
      caption:
        "被试依次完成信息输入和密度条件对应的 VR 地铁撤离任务。Unity 同时保存连续行为日志，并通过 LSL 输出 marker stream，用于与 EEG 数据同步。",
    },
    {
      id: "fig-2",
      title: "实验条件结构",
      use: "说明 90 名被试 × 3 个密度条件的组内设计",
      caption: "每名被试完成低密度、中密度和高密度 3 个 VR 地铁撤离 run；正式统计以 Density 为组内因素，主检验为中密度相对低/高密度平均的 planned contrast。",
    },
    {
      id: "fig-3-5",
      title: "Metro1-3 场景平面图与标识可读范围",
      use: "开题、方法、答辩展示",
      caption:
        "绿色方块表示吊挂式导向标识位置，箭头表示标识正面朝向。蓝色圆圈表示文字完全清楚范围，橙色虚线圆圈表示文字逐渐模糊/变淡结束范围。",
    },
    {
      id: "fig-6",
      title: "标识可读性与 LSL marker 逻辑",
      use: "解释 sign_visible / sign_readable marker",
      caption: "标识在 8 m 内完全清楚，8-12 m 逐渐模糊和变淡，12 m 以外不可读但保留整体可见性。",
    },
    {
      id: "fig-7",
      title: "决策点行为 marker 逻辑",
      use: "解释左右看、停留、掉头和疑似走错行为",
      caption: "系统记录进入/离开、左右查看、双侧扫描、掉头以及离开决策点后短时间内的疑似走错/回退行为。",
    },
    {
      id: "fig-8",
      title: "数据同步结构",
      use: "说明 Unity 行为数据和 EEG 数据如何汇合",
      caption:
        "Unity 本地保存连续行为数据、离散事件和回放文件，同时通过 LSL 输出 marker stream。LabRecorder 将 Unity marker 和 SmartBCI EEG stream 同步记录为 .xdf 文件。",
    },
  ],
  planFiles: [
    { map: "Metro1", signature: "Signature1", file: "Metro1_Signature1_L1_plan.svg", signs: 7 },
    { map: "Metro1", signature: "Signature2", file: "Metro1_Signature2_L1_plan.svg", signs: 7 },
    { map: "Metro1", signature: "Signature3", file: "Metro1_Signature3_L1_plan.svg", signs: 7 },
    { map: "Metro2", signature: "Signature1", file: "Metro2_Signature1_L1_plan.svg", signs: 8 },
    { map: "Metro2", signature: "Signature2", file: "Metro2_Signature2_L1_plan.svg", signs: 8 },
    { map: "Metro2", signature: "Signature3", file: "Metro2_Signature3_L1_plan.svg", signs: 8 },
    { map: "Metro3", signature: "Signature1", file: "Metro3_Signature1_L1_plan.svg", signs: 7 },
    { map: "Metro3", signature: "Signature2", file: "Metro3_Signature2_L1_plan.svg", signs: 7 },
    { map: "Metro3", signature: "Signature3", file: "Metro3_Signature3_L1_plan.svg", signs: 7 },
  ],
  markerGroups: [
    {
      title: "标识可读性 marker",
      items: ["sign_visible_enter", "sign_readable", "sign_readable_exit", "sign_visible_exit"],
      detail: "结合距离阈值和玩家是否处于牌面正面一侧。",
    },
    {
      title: "决策点行为 marker",
      items: [
        "decision_point_enter",
        "decision_look_left",
        "decision_look_right",
        "decision_scan_both_sides",
        "decision_point_exit",
        "u_turn_detected",
        "route_backtrack_detected",
      ],
      detail: "以实体标识牌位置为决策点中心，记录进入/离开、扫描和回退。",
    },
    {
      title: "数据同步",
      items: ["MetroRescueMarkers", "Mitsar EEG", ".xdf", "session_start", "evacuation_complete"],
      detail: "LabRecorder 文件需要先完成 stream 检查、会话切分和任务覆盖质量评估，再进入 EEG 分析。",
    },
  ],
  qualityAlerts: [
    {
      title: "密度条件需要稳定记录",
      detail:
        "正式 XDF 文件名或 Unity marker 需要稳定写入 density=low/medium/high，或另建 subject-run 条件表。否则 worker 无法自动计算中密度 planned contrast。",
    },
    {
      title: "XDF 文件需要先做会话级质量检查",
      detail:
        "测试文件中出现过同一 XDF 混入不同 subject/session 的 marker、缺少 session_start/map_start 的 trial，以及重复 Mitsar EEG stream。正式分析前必须输出 xdf_quality_report。",
    },
  ],
};

export const metroAiPrompt =
  "请作为 Metro Rescue 论文写作助理，基于文献知识库和已有 XDF 分析结果，整理：1) 研究问题与理论逻辑；2) 低/中/高密度组内设计；3) EEG 与 Unity marker 指标；4) 主假设 medium - mean(low, high) 的统计路线；5) 可写入英文论文的 Methods/Analysis Plan 段落；6) 目前不能过度声称的边界。";

export const projectWritingContext = [
  "Project: Metro Rescue, a VR subway evacuation wayfinding study with synchronized Unity LSL markers and EEG LabRecorder .xdf files.",
  "Participants/runs: target 90 subjects, each with 3 density-condition runs: low, medium, high; expected 270 XDF files.",
  "Main hypothesis: medium signage/scene density may produce the highest cognitive load, not a simple monotonic higher-density effect.",
  "Primary planned contrast: medium - mean(low, high), weights low:-1, medium:2, high:-1.",
  "Primary data products: subject-level density table, EEG load proxy, theta/alpha ratio, frontal theta, posterior alpha, behavior load proxy, completion time, event-window features around sign_readable and decision_point_enter.",
  "Statistics: within-subject Density model first; between-subject conclusions require subject metadata and Density x Group interaction. Do not claim significance unless cohort summary or user-provided results support it.",
  "Writing rule: distinguish literature evidence, project hypotheses, and actual experimental results. Use Chinese for planning; provide polished English only for manuscript-ready paragraphs.",
].join("\n");
