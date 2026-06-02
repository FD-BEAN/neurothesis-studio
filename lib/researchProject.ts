export const researchProject = {
  name: "Metro Rescue",
  subtitle: "VR 地铁撤离任务中的路径确认信息链、行动迟滞与 EEG 信息加工负荷研究",
  keywords: ["Metro Rescue", "VR 地铁撤离", "路径确认信息链", "路径确认支持", "行动迟滞", "导向标识", "EEG 信息加工负荷", "LSL marker", "EEG .xdf"],
  design: {
    maps: ["Metro1", "Metro2", "Metro3"],
    densityLevels: ["低路径确认支持", "中路径确认支持", "高路径确认支持"],
    expectedSubjects: 90,
    runsPerSubject: 3,
    expectedRuns: 270,
    withinSubjectFactor: "Route-confirmation support level",
    primaryHypothesis: "中等路径确认支持可能产生最高行动迟滞和最高信息加工负荷。",
    primaryContrast: "medium - mean(low, high)",
  },
  routeConfirmationFramework: {
    coreProblem:
      "在公共空间应急疏散中，官方目标提醒和现场路径标识的关键问题不是信息是否存在，而是能否形成一条让人持续确认、快速理解、顺畅行动的路径确认信息链。",
    scientificQuestion:
      "个体接收到官方目标提醒后，如何依据后续官方路径确认线索进行路径判断；为什么不同水平的路径确认支持会导致不同程度的行动迟滞。",
    constructs: [
      {
        id: "X",
        name: "路径确认支持水平",
        english: "Route-confirmation support level",
        role: "实验操纵变量",
        dimensions: ["首次确认线索接近性", "确认链连续性", "关键决策点覆盖", "平均间距"],
      },
      {
        id: "Y",
        name: "行动迟滞",
        english: "Route-decision hesitation",
        role: "主要客观因变量",
        dimensions: ["首次行动启动时间", "决策点停顿时间", "重复核对次数"],
      },
      {
        id: "auxY",
        name: "路径判断准确率",
        english: "Wayfinding decision accuracy",
        role: "辅助因变量",
        dimensions: ["首次方向选择是否正确", "决策点选择正确率", "最终是否到达正确目标"],
      },
      {
        id: "M1",
        name: "感知信息可靠性",
        english: "Perceived information reliability",
        role: "中介变量，accuracy side",
        dimensions: ["官方路径确认线索是否一致", "稳定", "可追踪", "值得继续依赖"],
      },
      {
        id: "M2",
        name: "信息加工负荷",
        english: "Information-processing load",
        role: "中介变量，effort side；EEG 表征",
        dimensions: ["信息断裂", "不连贯", "目标-线索-方向匹配负担", "确认过程负荷"],
      },
      {
        id: "W",
        name: "保护性行动指令清晰度",
        english: "Protective action instruction clarity",
        role: "调节变量",
        dimensions: ["目标明确", "应依据的现场线索明确", "关键决策点确认规则明确"],
      },
    ],
    hypotheses: [
      "H1: 路径确认支持水平对行动迟滞具有倒 U 型影响，中等支持高于低支持和高支持。",
      "H2: 从低支持到中等支持会增强感知信息可靠性，使个体更愿意继续参考和核对官方线索，从而提高行动迟滞。",
      "H3: 中等支持下官方信息链处于可依赖但未闭合状态，个体需要更多目标-线索-方向匹配资源，表现为更高 EEG 信息加工负荷，并进一步导致更高行动迟滞。",
      "H4: 保护性行动指令清晰度调节路径确认支持对感知信息可靠性和 EEG 信息加工负荷的影响。",
      "H5: 路径确认支持水平正向影响路径判断准确率；高支持应在较低行动迟滞下实现较高准确率。",
    ],
  },
  figures: [
    {
      id: "fig-1",
      title: "实验流程图",
      use: "研究设计总览、方法部分第一张图",
      caption:
        "被试依次接收保护性行动指令，并完成不同路径确认支持条件下的 VR 地铁撤离任务。Unity 同时保存连续行为日志，并通过 LSL 输出 marker stream，用于与 EEG 数据同步。",
    },
    {
      id: "fig-2",
      title: "实验条件结构",
      use: "说明 90 名被试 × 3 个路径确认支持条件的组内设计",
      caption: "每名被试完成低、中、高路径确认支持 3 个 VR 地铁撤离 run；正式统计以 Route-confirmation support level 为组内因素，主检验为中等支持相对低/高支持平均的 planned contrast。",
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
      title: "路径确认支持条件需要稳定记录",
      detail:
        "正式 XDF 文件名或 Unity marker 需要稳定写入 support_level=low/medium/high，或另建 subject-run 条件表。否则 worker 无法自动计算中等支持 planned contrast。",
    },
    {
      title: "XDF 文件需要先做会话级质量检查",
      detail:
        "测试文件中出现过同一 XDF 混入不同 subject/session 的 marker、缺少 session_start/map_start 的 trial，以及重复 Mitsar EEG stream。正式分析前必须输出 xdf_quality_report。",
    },
  ],
};

export const metroAiPrompt =
  "请作为 Metro Rescue 论文写作者，基于文献知识库和已有 XDF 分析结果，直接写出论文正文：1) 路径确认信息链的研究问题与理论逻辑；2) 低/中/高路径确认支持的组内设计；3) 行动迟滞、路径判断准确率、感知信息可靠性、EEG 信息加工负荷与保护性行动指令清晰度的变量定义；4) 主假设 medium - mean(low, high) 的统计路线；5) Methods / Theory / Hypotheses / Results template 的英文正文；6) 目前不能过度声称的边界。";

export const projectWritingContext = [
  "Project: Metro Rescue, a VR subway evacuation wayfinding study with synchronized Unity LSL markers and EEG LabRecorder .xdf files.",
  "Current theoretical framing: the core construct is a route-confirmation information chain after an official target alert. The question is not whether signage exists, but whether official target reminders and subsequent on-site confirmation cues form a continuous, traceable, and confirmable chain for action.",
  "Participants/runs: target 90 subjects, each with 3 route-confirmation support runs: low, medium, high; expected 270 XDF files.",
  "Manipulated X: route-confirmation support level, operationalized through first confirmation cue proximity, chain continuity, decision-point coverage, and cue spacing. Signature1/2/3 currently map to low/medium/high support unless a later condition table says otherwise.",
  "Primary Y: route-decision hesitation, measured by initial action onset time, decision-point dwell time, repeated checking, stopping, scanning, U-turns, and backtracking. Auxiliary Y: wayfinding decision accuracy.",
  "M1: perceived information reliability, the subjective belief that the official route-confirmation cues are consistent, stable, traceable, and worth relying on. M2: information-processing load, represented by EEG/event-window load features during target-cue-direction matching.",
  "Moderator W: protective action instruction clarity, comparing vague target-only instruction versus clear instruction that links the target, official on-site cues, and decision-point confirmation rules.",
  "Main hypothesis: medium route-confirmation support may produce the highest route-decision hesitation and EEG information-processing load, because the official information chain is reliable enough to keep checking but not closed enough to resolve the decision quickly.",
  "Primary planned contrast: medium - mean(low, high), weights low:-1, medium:2, high:-1.",
  "Primary data products: subject-level support-level table, EEG load proxy, theta/alpha ratio, frontal theta, posterior alpha, behavior hesitation proxy, completion time, decision accuracy, and event-window features around sign_readable and decision_point_enter.",
  "Statistics: within-subject route-confirmation support model first; between-subject conclusions require subject metadata and Support x Group interaction. Do not claim significance unless cohort summary or user-provided results support it.",
  "Writing rule: produce manuscript-ready English paragraphs when asked for writing; put Chinese explanation, evidence trace, and limitations after the draft. Distinguish literature evidence, project hypotheses, and actual experimental results.",
].join("\n");
