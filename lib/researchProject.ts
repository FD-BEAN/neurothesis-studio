export const researchProject = {
  name: "Metro Rescue",
  subtitle: "VR 地铁撤离任务中的导向标识、音频负荷与 EEG 同步研究",
  keywords: ["Metro Rescue", "VR 地铁撤离", "导向标识", "认知负荷", "LSL marker", "EEG .xdf"],
  design: {
    maps: ["Metro1", "Metro2", "Metro3"],
    signatures: ["Signature1", "Signature2", "Signature3"],
    audio: ["Low", "High"],
    totalConditions: 18,
  },
  figures: [
    {
      id: "fig-1",
      title: "实验流程图",
      use: "研究设计总览、方法部分第一张图",
      caption:
        "被试依次完成信息输入、地图选择、标识牌方案选择和音频条件选择后进入 VR 地铁撤离任务。Unity 同时保存连续行为日志，并通过 LSL 输出 marker stream，用于与 EEG 数据同步。",
    },
    {
      id: "fig-2",
      title: "实验条件结构",
      use: "说明 3 × 3 × 2 自变量设计",
      caption: "实验包含 3 种地图布局、3 种标识牌方案和 2 种音频条件，形成 18 种地图-标识-音频组合。",
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
      title: "Signature 方案需要记录差异定义",
      detail:
        "当前场景平面图显示同一地图内 Signature1/2/3 的标识点数量和位置一致。论文方法部分需要另建操控表，说明三套 Signature 在贴图、信息密度、箭头数、出口数、冗余度或歧义度上的差异。",
    },
    {
      title: "XDF 文件需要先做会话级质量检查",
      detail:
        "测试文件中出现过同一 XDF 混入不同 subject/session 的 marker、缺少 session_start/map_start 的 trial，以及重复 Mitsar EEG stream。正式分析前必须输出 xdf_quality_report。",
    },
  ],
};

export const metroAiPrompt =
  "请作为 EEG + VR 地铁撤离论文研究助理，基于 Metro Rescue 项目材料，整理：1) 研究问题；2) 3×3×2 实验设计；3) Unity 行为日志与 LSL marker；4) EEG .xdf 同步分析路径；5) 可写入英文 Methods 的段落；6) 需要在开题/论文中澄清的风险点。";
