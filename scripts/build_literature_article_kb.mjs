import fs from "node:fs";
import path from "node:path";
import seedKnowledgeBase from "../lib/metro_rescue_seed_kb.json" with { type: "json" };
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(projectRoot, "lib", "literature_article_kb.json");
const workRoot = path.join(projectRoot, "work", "literature_article_rebuild");
const evidenceRoot = path.join(workRoot, "evidence");
const textRoot = path.join(workRoot, "texts");
const defaultPdfBase = "C:/Users/Jingbin/Documents/xwechat_files/wangjingbin1996_11f7/msg/file/2026-06";
const maxExtractedChars = 220_000;

const curatedArticleNotes = {
  S001: {
    summary: "该文用沉浸式 VR 火灾疏散实验讨论从众线索如何改变路线选择，适合作为社会线索或人群行为混杂因素的背景文献。",
    question: "研究问题是：在室内火灾疏散场景中，周围人群的路线选择和性别构成是否会影响个体的 wayfinding decision。",
    method: "方法上是 VR 图书馆火灾场景，被试在多种人群分流和性别比例条件下完成疏散选择任务。",
    findings: ["多数人群选择的路线会吸引个体跟随，但该效应会受到群体构成调节。", "它说明路线选择不只由导向标识决定，还会受社会线索影响。"],
    use: ["如果后续 VR 场景加入 NPC 或群体线索，可用它解释 social cue confound。", "当前主实验若没有人群线索，不应把它作为标识密度效应的直接证据。"],
    boundaries: ["不能作为 EEG 或标识密度主效应证据。"],
  },
  S002: {
    summary: "该文把 BIM 与 VR 用于导向标识可见性评估，重点是覆盖、遮挡、视域和布点优化。",
    question: "研究问题是：如何在复杂公共建筑中更系统地评估导向标识是否真正可见、连续且覆盖关键决策点。",
    method: "方法上结合 BIM、虚拟环境和可见性分析，对标识位置、遮挡和覆盖范围进行工程化评估。",
    findings: ["标识有效性不能只按数量理解，还要看视域、遮挡、连续性和关键节点覆盖。", "这为把低/中/高密度从简单数量差异升级为可见性和信息负荷变量提供方法参考。"],
    use: ["支持在 Metro Rescue 中建立 sign-level 操作表，例如可读距离、遮挡、方位、决策点覆盖。"],
    boundaries: ["不能把当前 8m/12m readable circle 说成完整可见性模型。"],
  },
  S003: {
    summary: "该文用 VR 与 fNIRS 提出灾害刺激清晰度和强度可能产生非线性心理/脑反应。",
    question: "研究问题是：灾害线索的 clarity 与 intensity 如何共同影响恐慌或脑激活水平。",
    method: "方法上是 VR 灾害刺激结合 fNIRS，使用 clarity-intensity 框架建模生理反应。",
    findings: ["刺激强度与认知/情绪负荷不一定单调递增。", "非线性结果可以帮助论证中等密度场景可能比低/高密度更容易诱发不确定性或认知负荷。"],
    use: ["作为中等密度最高假设的理论类比，而不是本研究 EEG 结果。"],
    boundaries: ["fNIRS PFC 活动不能直接替代 EEG theta/alpha 指标。"],
  },
  S004: {
    summary: "该文比较虚拟与真实实验范式下的 hostile emergency pedestrian responses，用于支持 VR 疏散研究的生态效度讨论。",
    question: "研究问题是：VR 能否在安全可控条件下复现现实紧急事件中的心理和行动反应。",
    method: "方法上把虚拟实验与实体实验进行量化比较，关注应急反应和运动行为是否一致。",
    findings: ["VR 可以在一定程度上产生与现实接近的心理和移动反应。", "它适合为 VR metro rescue task 的合理性提供方法论支持。"],
    use: ["放在 Methods 或 limitation 中解释为什么使用 VR，同时承认场景特异性。"],
    boundaries: ["该文不是地铁标识或 EEG 文献，不应作为主假设证据。"],
  },
  S005: {
    summary: "该综述讨论大规模疏散中的行为建模和路径优化，指出人类行为模型与优化模型之间常有断裂。",
    question: "研究问题是：疏散规划中如何同时考虑人的决策行为和路径/容量优化。",
    method: "方法上系统回顾疏散建模与 routing optimization 文献，梳理 ABM、离散选择和优化方法。",
    findings: ["许多模型过度依赖最短路径或理想行为假设。", "真实行为数据可用于改进人因导向的疏散模型。"],
    use: ["用于说明 Metro Rescue 的行为与 EEG 数据为什么能服务更真实的 evacuation modeling。"],
    boundaries: ["不能作为导向标识密度或 EEG 指标的直接实验证据。"],
  },
  S006: {
    summary: "该文直接讨论疏散标识如何影响个体疏散行为，是标识变量操作和行为结果定义的重要核心文献。",
    question: "研究问题是：标识位置、间距、连续性和设计属性如何影响路线遵从、速度、距离和疏散效率。",
    method: "方法上围绕建筑疏散标识进行实验或行为评估，关注标识属性与个体行为输出之间的关系。",
    findings: ["标识配置会影响个体是否沿指示路线行动，也会影响速度、路径长度和疏散效率。", "标识效应不是“越多越好”，需要结合位置、可见性、连续性和空间情境。"],
    use: ["用于定义 Signature/密度条件的操作化变量和 behavioral outcome。"],
    boundaries: ["不能简化为标识数量越多效果越好。"],
  },
  S007: {
    summary: "该文关注人是否遵从 emergency evacuation signage 的方向，是区分看见标识与服从标识的关键依据。",
    question: "研究问题是：人在地下或复杂疏散空间中是否会按照紧急标识箭头选择路线。",
    method: "方法上使用地下/VR 疏散任务，对标识方向、路径选择和 compliance 进行比较。",
    findings: ["导向标识能影响选择，但 compliance 不是自动发生。", "标识方向、空间几何和个人策略会共同决定是否遵从。"],
    use: ["支持建立 sign_visible/sign_readable/sign_compliance 三层指标。"],
    boundaries: ["不要把 readable 直接等同于理解或遵从。"],
  },
  S008: {
    summary: "该文将 BIM 与 AR 用于室内应急导航，适合作为动态导向和数字化导航的背景方法。",
    question: "研究问题是：AR/BIM 能否在建筑应急中提供实时或情境化导航辅助。",
    method: "方法上结合 BIM 模型、路径规划和 AR 显示，对室内疏散导航进行系统设计。",
    findings: ["数字化导航能提高信息呈现的情境性，但与传统静态标识的认知过程不同。", "它说明未来可把 Metro Rescue 数据接入 adaptive guidance 或 digital twin。"],
    use: ["用于 future work，不宜放在当前静态标识密度主证据里。"],
    boundaries: ["AR 导航不是本研究的实验条件。"],
  },
  S009: {
    summary: "该文用机器学习、离散选择和 agent-based simulation 建模建筑疏散，是把实验行为数据转入仿真的方法参考。",
    question: "研究问题是：如何用数据驱动方式把个体 exit/route choice 转化为可模拟的疏散行为模型。",
    method: "方法上结合行为数据、离散选择模型、机器学习和 agent-based simulation。",
    findings: ["微观路线选择数据可以改进 agent 行为规则。", "离散选择和可解释机器学习适合连接实验数据与疏散仿真。"],
    use: ["用于后续把 Metro Rescue 的 trial features 汇总为 choice model 或 simulation input。"],
    boundaries: ["不要把仿真输出当作本研究的被试实验结果。"],
  },
  S010: {
    summary: "该文讨论情绪刺激对运动抑制的影响，和疏散场景中的反应抑制/迟疑有弱相关。",
    question: "研究问题是：情绪内容是否会改变反应抑制或运动准备。",
    method: "方法上是情绪刺激与 motor inhibition 任务，不是疏散或标识实验。",
    findings: ["情绪线索可能影响行动抑制。", "它只能作为 emergency affect 对行动控制影响的背景。"],
    use: ["若讨论压力或情绪负荷，可作为远端理论补充。"],
    boundaries: ["不能用于证明地铁标识密度对 EEG 或行为的影响。"],
  },
  S011: {
    summary: "该系统综述总结 VR evacuation drills 的研究特点、优势和限制，是 VR 实验合理性的总背景。",
    question: "研究问题是：VR 疏散演练在安全建成环境研究中有哪些应用、优势和方法限制。",
    method: "方法上系统综述 VR evacuation drill 文献，整理场景、指标、设备和验证问题。",
    findings: ["VR 能安全地操控危险情境并记录行为，但生态效度、晕动、样本和迁移性需要报告。", "它适合支撑 Methods 中的 VR 选择和 limitations。"],
    use: ["作为 VR 研究设计与局限讨论的框架文献。"],
    boundaries: ["综述不能替代当前实验结果。"],
  },
  S012: {
    summary: "该文使用 wearable EEG 与 VR 识别施工危险感知，说明 EEG 可用于 VR 中的风险/注意状态分类。",
    question: "研究问题是：VR 危险识别任务中的 EEG 特征能否区分不同 hazard perception 状态。",
    method: "方法上结合 VR hazard 场景、可穿戴 EEG 和分类模型。",
    findings: ["EEG 可为风险感知和注意状态提供神经生理指标。", "这种范式与 Metro Rescue 的 EEG + VR 数据结构相近。"],
    use: ["支持 EEG 预处理、特征提取和分类/回归分析思路。"],
    boundaries: ["施工危险识别不同于地铁导向标识，不可直接迁移结论。"],
  },
  S013: {
    summary: "CogDNA 关注基于认知状态的应急室内导航辅助，是连接认知负荷、导航帮助和自适应系统的关键文献。",
    question: "研究问题是：能否通过认知状态或负荷指标来触发更合适的室内 wayfinding assistance。",
    method: "方法上是 proof-of-concept 系统，结合导航任务、认知负荷线索和辅助策略。",
    findings: ["导航辅助的有效性应考虑人的当前认知状态。", "这支持把中等密度解释为信息不足与信息过载之间的不确定区间。"],
    use: ["用于论证认知负荷不是标识数量的线性函数，而与可解释性和决策状态有关。"],
    boundaries: ["不能把 proof-of-concept 当成已验证的地铁标识密度结论。"],
  },
  S014: {
    summary: "该文比较 immersive 与 non-immersive VR 中的火灾疏散决策，用于说明沉浸程度会影响 exit choice。",
    question: "研究问题是：不同 VR 沉浸程度是否改变疏散决策和行为。",
    method: "方法上比较沉浸式与非沉浸式虚拟环境下的火灾疏散选择。",
    findings: ["沉浸性会影响场景临场感和决策反应。", "这支持在论文中明确报告设备、视角、交互方式和场景沉浸程度。"],
    use: ["用于 Methods validity 和 limitations。"],
    boundaries: ["不直接支持标识密度主效应。"],
  },
  S015: {
    summary: "该文讨论训练和紧急事件类型如何影响疏散行为，适合控制熟悉度、训练和任务顺序。",
    question: "研究问题是：不同训练经验和 emergency type 是否改变人们的疏散行为。",
    method: "方法上比较训练状态、事件类型与疏散选择或准备行为。",
    findings: ["训练和事件解释框架会影响行动准备、路线选择和反应时间。", "实验中 trial order、熟悉度和说明方式需要控制。"],
    use: ["用于分析模型中的 TrialOrder/familiarity 控制项。"],
    boundaries: ["不能用于直接解释 EEG 密度效应。"],
  },
  S016: {
    summary: "该文介绍 crowdsourced VR 在行人与疏散动力学研究中的方法潜力和数据质量问题。",
    question: "研究问题是：在线或众包 VR 能否为 pedestrian dynamics 提供可扩展实验数据。",
    method: "方法上是 crowdsourced VR 实验路线，关注远程数据收集、质量控制和可重复性。",
    findings: ["大样本 VR 数据有扩展性，但设备差异和控制不足会影响质量。", "它提醒本研究需要明确 QC 和排除规则。"],
    use: ["作为数据质量、样本控制和 VR 实验规范的参考。"],
    boundaries: ["当前研究不是众包 VR，不要直接套用其外部效度。"],
  },
  S017: {
    summary: "该综述讨论建筑与 occupant digital twin 在应急疏散中的框架和技术，用于 future work。",
    question: "研究问题是：数字孪生如何整合建筑、人员行为、风险和导航策略用于应急疏散。",
    method: "方法上综述 digital twin 技术、应用和趋势。",
    findings: ["occupant behavior 数据是 digital twin 应急决策的重要输入。", "Metro Rescue 的行为和 EEG 特征可作为未来动态疏散系统的数据层。"],
    use: ["用于讨论未来将实验数据接入 digital twin 或动态标识系统。"],
    boundaries: ["不要把框架综述写成已完成的系统实现。"],
  },
  S018: {
    summary: "该条与 digital twin 综述主题相同，作为数字孪生和 occupant behavior coupling 的补充来源。",
    question: "研究问题是：如何在应急疏散中把建筑状态、人员状态和导航策略耦合到数字孪生框架。",
    method: "方法上是综述与框架梳理。",
    findings: ["动态环境和人员状态需要持续更新。", "静态路径优化不足以解释真实疏散。"],
    use: ["用于 future work，不进入当前主结果链条。"],
    boundaries: ["与 S017 可能重复，正式写作时应去重引用。"],
  },
  S019: {
    summary: "该文提出 rooted forest 方向设置方法，目标是自动化动态出口标识的方向配置。",
    question: "研究问题是：如何根据网络结构和疏散目标自动设置动态导向标识方向。",
    method: "方法上是图/网络优化算法，用于 dynamic exit sign direction setting。",
    findings: ["动态标识需要以全局路径结构为基础。", "这说明静态标识密度只是导向系统设计的一部分。"],
    use: ["用于 future work 或 dynamic signage discussion。"],
    boundaries: ["算法优化文献不能证明被试认知负荷。"],
  },
  S020: {
    summary: "该文在虚拟环境中操控 attention shift intervention，和地铁场景中的提示方式、音频/视觉切换高度相关。",
    question: "研究问题是：注意转移干预是否会改变疏散行为和信息搜索过程。",
    method: "方法上使用 VR metro 或类似虚拟疏散场景，比较不同提示/干预方式下的行为。",
    findings: ["注意引导会改变信息搜索、启动和路线决策。", "音频或提示可能与标识阅读时间窗重叠，成为重要协变量。"],
    use: ["用于定义 audio overlap、attention cue 和 marker event window。"],
    boundaries: ["如果当前实验没有同样干预，不应说复现其效果。"],
  },
  S021: {
    summary: "该文结合沉浸式 VR 与离散选择模型研究 exit choice，是行为建模的高相关方法文献。",
    question: "研究问题是：建成环境中的出口选择如何用 IVR 行为数据和 discrete choice model 解释。",
    method: "方法上收集 IVR exit choice 数据，并用离散选择模型估计环境和个体因素影响。",
    findings: ["出口选择可被空间属性、信息线索和个体因素共同解释。", "该思路适合本研究从 trial-level features 建立 route choice 或 compliance model。"],
    use: ["用于行为结果建模，尤其是 mixed/discrete choice 的方法依据。"],
    boundaries: ["不要把 exit choice 结果直接等同于 EEG 负荷。"],
  },
  S022: {
    summary: "该文比较高/低紧急度下有指导的疏散行为，说明 urgency 会调节导向信息使用。",
    question: "研究问题是：紧急度和引导信息如何共同影响疏散行为。",
    method: "方法上实验操控 urgency 与 guidance，观察选择、速度或路径行为。",
    findings: ["高紧急度可能改变信息加工深度和服从行为。", "urgency 需要在分析中作为情境变量或限制说明。"],
    use: ["如果 Metro Rescue 有音频/时间压力，可用于解释 urgency interaction。"],
    boundaries: ["低/高紧急度不等同于低/中/高标识密度。"],
  },
  S023: {
    summary: "该文是火灾蔓延驱动的动态智能疏散模型，属于环境风险和动态路径规划背景。",
    question: "研究问题是：火灾蔓延如何实时影响多层建筑中的疏散路径和智能决策。",
    method: "方法上结合火灾传播、动态疏散模型和多层建筑路径调整。",
    findings: ["真实疏散路径应随环境风险动态变化。", "它可为 future work 中动态场景和实时标识提供背景。"],
    use: ["用于讨论后续可把 EEG/行为状态与动态疏散模型连接。"],
    boundaries: ["当前实验若是固定 VR 场景，不应声称做了 fire-propagation dynamic model。"],
  },
  S024: {
    summary: "该指南/综述型资料提供 wayfinding 与 signage 设计原则，是操作化标识清晰度、连续性和决策点布置的基础。",
    question: "研究问题是：步行者需要什么样的导向信息才能有效完成空间导航。",
    method: "方法上是导向设计原则、实践准则和空间信息组织总结。",
    findings: ["导向系统应在关键决策点提供连续、可理解、与环境一致的信息。", "该文适合定义标识密度不只是数量，而是信息结构。"],
    use: ["用于设计 rationale 和 stimulus description。"],
    boundaries: ["指南不能替代实验统计结果。"],
  },
  S025: {
    summary: "该文用眼动研究应急室内寻路，证明视觉注意与路线选择有关，是注意中介机制的重要证据。",
    question: "研究问题是：人在应急寻路时如何感知环境线索，视觉注意如何关联路线选择。",
    method: "方法上结合室内应急寻路任务与眼动指标，考察 exit/sign cue、熟悉度和路线选择。",
    findings: ["视觉注意与 wayfinding choice 呈正相关。", "熟悉路线可能改变注视频率、扫视速度和对出口/标识的发现概率。"],
    use: ["支持用 head yaw、停留和回看行为作为视觉搜索代理指标，并区分 perception 与 choice。"],
    boundaries: ["眼动证据不能直接等同于 EEG 认知负荷。"],
  },
  S026: {
    summary: "该文关注 VR 建筑应急中的 pre-evacuation efficiency，适合解释开始行动前的信息搜索和迟疑。",
    question: "研究问题是：虚拟现实中的人机交互和信息呈现如何影响预疏散效率。",
    method: "方法上使用建筑应急 VR 任务，观察报警、信息呈现和启动行为。",
    findings: ["预疏散阶段不是空白时间，而包含信息判断、确认和行动准备。", "这适合把 map_start 到 first movement 或 first sign search 作为分析窗口。"],
    use: ["用于定义 initiation time、information seeking latency 等行为指标。"],
    boundaries: ["不要把 pre-evacuation 效应直接写成密度效应。"],
  },
  S027: {
    summary: "该文用 EEG 分类 wayfinding uncertainty，是本项目最直接的 EEG-导航不确定性核心文献。",
    question: "研究问题是：人在室内导航中的不确定状态是否能通过 EEG 频谱/空间特征识别。",
    method: "方法上采集 VR/室内寻路任务中的 EEG，使用特征提取和分类模型区分高/低不确定状态。",
    findings: ["wayfinding uncertainty 具有可检测的神经生理相关物。", "EEG 可作为建筑设计变量和导向线索研究中的客观指标。"],
    use: ["直接支撑本研究围绕 decision_point、sign_readable 和中等密度不确定性的 EEG 分析。"],
    boundaries: ["它支持 EEG 可识别 uncertainty，不证明本研究一定出现中密度最高。"],
  },
  S028: {
    summary: "该理论框架和 meta-analysis 讨论压力下的 indoor emergency wayfinding decision，是解释决策、压力和环境线索的理论核心。",
    question: "研究问题是：压力情境中个体如何整合环境线索、风险感知和路线策略做出寻路决策。",
    method: "方法上整合理论框架与元分析，梳理 emergency wayfinding 的认知和行为机制。",
    findings: ["压力、环境复杂性、信息可得性和个体差异共同影响 wayfinding decision。", "它为 mixed-effects model 中的组内/组间因素提供理论背景。"],
    use: ["用于 Introduction 和 hypothesis development。"],
    boundaries: ["元分析结论不能替代本研究具体密度条件的统计检验。"],
  },
  S029: {
    summary: "该文用 IVR、眼动和 EEG 研究 hazard recognition 中自下而上和自上而下注意的交互。",
    question: "研究问题是：危险识别中刺激显著性和任务目标如何共同驱动注意与脑电反应。",
    method: "方法上结合沉浸式 VR、eye-tracking 与 EEG，分析 hazard recognition 的注意机制。",
    findings: ["视觉显著性和目标驱动注意会共同塑造 EEG/眼动反应。", "这与标识显著性、搜索策略和认知负荷分析高度相关。"],
    use: ["用于把 sign salience、search behavior 和 EEG window 联系起来。"],
    boundaries: ["hazard recognition 不是 subway wayfinding，结论需作为机制类比。"],
  },
  S030: {
    summary: "该文用机器学习解释预疏散决策，适合作为行为特征解释和模型可解释性的参考。",
    question: "研究问题是：预疏散决策能否用可解释机器学习从个体和情境变量中预测。",
    method: "方法上构建机器学习模型并解释变量贡献。",
    findings: ["pre-evacuation decision 可由多变量共同预测。", "可解释模型有助于从 trial features 识别重要行为因素。"],
    use: ["用于后续对 reaction/decision variables 做 SHAP 或 permutation importance。"],
    boundaries: ["机器学习预测不等同于因果效应。"],
  },
  S031: {
    summary: "该文研究 optical see-through AR fire safety training，是培训和 AR 安全教育背景文献。",
    question: "研究问题是：AR 安全培训能否改善建筑使用者对火灾安全信息的理解和行动准备。",
    method: "方法上使用 AR 训练任务或系统评估。",
    findings: ["AR 可作为安全培训工具，但其交互和信息呈现不同于 VR 实验。", "它适合放在 future application，而非当前主分析。"],
    use: ["用于写作中讨论训练或应用延伸。"],
    boundaries: ["不要用于证明当前 VR 标识密度效应。"],
  },
  S032: {
    summary: "该文延续 crowdsourced VR pedestrian dynamics，重点更偏验证和方法质量。",
    question: "研究问题是：众包 VR 数据在 pedestrian/evacuation dynamics 中如何验证可靠性。",
    method: "方法上比较众包 VR 数据、实验控制和验证指标。",
    findings: ["VR 数据质量需要依赖清晰的 QC、设备记录和行为合理性检查。", "这提醒本项目需要在 XDF 报告中列出同步、缺失和异常行为。"],
    use: ["用于 QC 和 data exclusion 的写作依据。"],
    boundaries: ["不是本研究设计的直接范式。"],
  },
  S033: {
    summary: "该文提出 tunnel fire 中的智能动态出口标识框架，是动态导向系统的工程背景。",
    question: "研究问题是：隧道火灾中动态出口标识如何根据环境风险和疏散需求调整。",
    method: "方法上建立安全疏散框架并做 tunnel fire demonstration。",
    findings: ["动态标识系统可根据风险环境调整指示。", "它说明本研究静态密度条件可作为未来动态系统的感知/行为基础。"],
    use: ["用于 future work：基于认知负荷和行为反馈调整标识策略。"],
    boundaries: ["隧道火灾和地铁站 VR 场景不同，不能混用结果。"],
  },
  S034: {
    summary: "该文在 VR 地铁环境中结合眼动研究标识暴露下的乘客寻路，是本项目场景最相近的核心文献之一。",
    question: "研究问题是：地铁乘客在 VR 中遇到标识时如何分配注意、建立空间知识并完成寻路。",
    method: "方法上使用 VR subway scene、眼动记录和不同寻路/压力条件下的行为指标。",
    findings: ["压力会削弱空间知识掌握。", "首次接触场景的参与者更依赖标识，起点区域标识尤其重要。"],
    use: ["支撑 Metro 场景、start-area sign、压力/音频和 trial order 控制。"],
    boundaries: ["如果当前实验没有压力操控，只能把 pressure 作为类比或协变量讨论。"],
  },
  S035: {
    summary: "该文讨论机场导向体验的 halo effect，即寻路体验会影响对系统可靠性和应急准备的感知。",
    question: "研究问题是：日常导向体验是否会影响人对紧急情况下导向系统的信任和准备度。",
    method: "方法上围绕 airport terminal wayfinding experience 与 perceived reliability 进行调查或实验。",
    findings: ["导向系统可靠性感知会影响应急准备和信任。", "主观信任可解释为什么同样的标识暴露不必然带来相同行为。"],
    use: ["用于问卷、主观评分或 limitation 中的 trust/familiarity 讨论。"],
    boundaries: ["机场终端不等于地铁火灾逃生。"],
  },
  S036: {
    summary: "该文研究 color zones / landmarks 对空间导航和性别差异的影响，是颜色与区域地标的背景证据。",
    question: "研究问题是：区域颜色地标是否改善空间导航，是否受性别或方向感影响。",
    method: "方法上操控颜色区域或地标并观察导航表现。",
    findings: ["颜色区域和地标可影响空间记忆与导航策略。", "个体差异可能调节标识/地标的使用方式。"],
    use: ["用于解释标识图形、颜色和空间分区对 wayfinding 的潜在作用。"],
    boundaries: ["不能直接推断标识密度的 EEG 效应。"],
  },
  S037: {
    summary: "该文讨论 wayfinding strategy 与 landmark type 在 VR 中对导航表现的影响。",
    question: "研究问题是：不同寻路策略和地标类型如何影响 VR 导航表现和压力。",
    method: "方法上在 VR 环境中比较 landmark type、strategy 与 performance。",
    findings: ["地标类型与个人策略会共同影响导航表现。", "这支持在分析中考虑个体方向感或策略差异。"],
    use: ["用于组间差异、策略问卷和随机效应解释。"],
    boundaries: ["地标不是应急标识，需区分。"],
  },
  S038: {
    summary: "该文研究火灾疏散中的自组织行为和移动模式，是 crowd dynamics 背景。",
    question: "研究问题是：火灾疏散时行人如何形成自组织移动模式。",
    method: "方法上观察或模拟虚拟火灾疏散中的运动模式。",
    findings: ["个体移动会受到空间结构和群体互动影响。", "该背景可解释路径拥挤或回头行为，但不是标识密度主证据。"],
    use: ["用于讨论 movement pattern、backtracking 和 crowd behavior 背景。"],
    boundaries: ["如果实验没有群体互动，不要过度引用。"],
  },
  S039: {
    summary: "该文研究虚拟地铁中初始信息模态如何影响后续文本标识使用，是音频/视觉提示与标识交互的核心文献。",
    question: "研究问题是：初始疏散信息的模态是否改变人们随后搜索和使用文本标识的方式。",
    method: "方法上使用 virtual metro scene，比较不同信息模态下的信息搜索、注视或寻路行为。",
    findings: ["文本条件可能延迟信息搜索启动，但一旦开始搜索可更快找到标识。", "模态一致性可能降低重复确认和注视负担。"],
    use: ["用于定义 audio overlap、reconfirmation、fixation/search latency 等指标。"],
    boundaries: ["与 S040 可能是重复条目，正式引用时只保留一处。"],
  },
  S040: {
    summary: "该文同样围绕虚拟地铁文本标识和信息模态，可作为 S039 的重复/补充记录。",
    question: "研究问题是：信息模态与文本标识如何共同影响地铁环境中的寻路行为。",
    method: "方法上是 virtual metro wayfinding 与 text-based signage 的模态比较。",
    findings: ["信息模态会影响信息搜索节奏和标识确认成本。", "音频线索可能干扰或帮助视觉标识加工。"],
    use: ["用于检查本研究 Audio 条件和 sign_readable EEG 窗口是否重叠。"],
    boundaries: ["与 S039 去重后引用，不重复堆叠证据。"],
  },
  S041: {
    summary: "该文把建筑导向标识效果拆为 perception 与 compliance，并使用眼动和可解释模型，是本研究 sign_readable 解释边界的关键文献。",
    question: "研究问题是：考虑部分环境影响时，如何评估建筑导向标识是否被看见以及是否被遵从。",
    method: "方法上结合眼动、行为选择和 SHAP/机器学习解释，分析 guidance sign effectiveness。",
    findings: ["看见标识不等于遵从标识。", "标识效果需要区分 perception、attention、comprehension 和 route choice。"],
    use: ["用于建立 sign_compliance_events.csv 和 perception-compliance mediation 框架。"],
    boundaries: ["不能把 sign_readable 当作理解或正确选择。"],
  },
  S042: {
    summary: "该文研究火灾疏散中的风险决策，考虑烟雾、风险偏好和邻居行为。",
    question: "研究问题是：人在火灾中为什么会做出风险路线选择。",
    method: "方法上操控烟雾水平、个体风险偏好和邻居行为，观察 route choice。",
    findings: ["风险偏好和社会线索可能覆盖理性路径选择。", "环境风险与个体倾向会调节疏散决策。"],
    use: ["用于解释组间差异和风险偏好问卷的重要性。"],
    boundaries: ["烟雾和邻居行为若未在当前实验中操控，只能作为混杂或未来变量。"],
  },
  S043: {
    summary: "该文用 VR 和眼动解释为什么人们不用 emergency exit doors，核心是可见性、熟悉度和注意中介。",
    question: "研究问题是：人们不使用应急出口是因为没有注意到、因为不熟悉，还是因为看到后仍不选择。",
    method: "方法上结合 VR 火灾疏散与 eye-tracking，比较注意、熟悉度和 exit choice。",
    findings: ["对寻路线索的注意与出口选择有关。", "一旦产生注视，熟悉度对选择的影响可能减弱。"],
    use: ["用于支持 attention/perception 是 route choice 的中介，而不是简单 stimulus-response。"],
    boundaries: ["门颜色/类型的 null effect 是特定场景结果，不能泛化到所有标识设计。"],
  },
  S044: {
    summary: "该文主题是人类与算法数据请求者下的客户响应，和本项目关联很弱。",
    question: "研究问题是：数据请求主体是人还是算法会怎样影响客户数据提供行为。",
    method: "方法上偏管理/营销或信息系统实验。",
    findings: ["可作为数据治理或 AI 辅助伦理的远端背景。", "不适合进入本研究核心文献链。"],
    use: ["除非讨论系统数据管理，否则不建议引用。"],
    boundaries: ["与 EEG、VR 疏散、标识密度无直接关系。"],
  },
  S045: {
    summary: "该文从奔牛节人群运动观察 pedestrian dynamics 的极端拥挤区域，属于运动动力学背景。",
    question: "研究问题是：高密度逃离/奔跑人群中基本图是否出现不可达区域或异常运动模式。",
    method: "方法上分析真实高密度人群运动数据。",
    findings: ["极端人群密度下 movement dynamics 可能呈现非线性或不可达区域。", "可作为高密度 movement constraint 的背景。"],
    use: ["用于讨论高密度场景可能改变移动行为，但不是地铁标识认知负荷直接证据。"],
    boundaries: ["奔牛节不是 VR 地铁疏散。"],
  },
  S046: {
    summary: "该文用街景全景图建模路口决策复杂度，和 decision point complexity 及 passing branches 概念相关。",
    question: "研究问题是：道路交叉口的分支结构如何影响决策复杂度和路径选择难度。",
    method: "方法上从街景/道路结构中提取 passing branches 等复杂度指标。",
    findings: ["决策点复杂度可由可选分支和空间结构量化。", "这可支持 Metro Rescue 中把 decision_point_enter 附近分支数作为认知负荷协变量。"],
    use: ["用于构建 route complexity / branch count 控制变量。"],
    boundaries: ["室外路网和室内地铁空间不同，需作为方法类比。"],
  },
  S047: {
    summary: "该文研究方向指令质量与寻路效率，适合用作方向质量和 manipulation check 的依据。",
    question: "研究问题是：什么样的方向描述被认为质量更高，并如何影响寻路效率。",
    method: "方法上比较不同方向指令质量与 wayfinding performance。",
    findings: ["指令质量会影响导航效率和错误成本。", "标识文字/箭头是否清晰可作为密度条件之外的 manipulation check。"],
    use: ["用于定义 sign information quality、clarity rating 和 route instruction quality。"],
    boundaries: ["方向文字质量不等于标识数量密度。"],
  },
};

installPdfNodePolyfills();
globalThis.pdfjsWorker ??= pdfjsWorker;
fs.mkdirSync(evidenceRoot, { recursive: true });
fs.mkdirSync(textRoot, { recursive: true });

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pdfDirectory = options.pdfDir || findLargestPdfDirectory(defaultPdfBase);
  if (!pdfDirectory) throw new Error("Could not locate related-literature PDF directory.");

  const pdfFilenames = fs
    .readdirSync(pdfDirectory)
    .filter((filename) => filename.toLowerCase().endsWith(".pdf"))
    .sort((a, b) => a.localeCompare(b, "en"));
  const pdfByKey = new Map(pdfFilenames.map((filename) => [normalizeLiteratureKey(filename), filename]));
  const limit = Number(options.limit || seedKnowledgeBase.sources.length);

  console.log(`PDF directory: ${pdfDirectory}`);
  console.log(`PDF count: ${pdfFilenames.length}`);
  console.log("Mode: Codex local evidence extraction + curated article notes; no API calls.");

  const cards = [];
  for (const source of seedKnowledgeBase.sources.slice(0, limit)) {
    const matchedPdfFilename = pdfByKey.get(normalizeLiteratureKey(source.Filename)) ?? source.Filename;
    const pdfPath = path.join(pdfDirectory, matchedPdfFilename);
    console.log(`${source.Source_ID} extracting: ${matchedPdfFilename}`);
    const extractedText = fs.existsSync(pdfPath) ? await extractPdfText(pdfPath) : "";
    fs.writeFileSync(path.join(textRoot, `${source.Source_ID}.txt`), extractedText, "utf8");

    const card = buildExtractiveArticleCard(source, matchedPdfFilename, extractedText);
    fs.writeFileSync(path.join(evidenceRoot, `${source.Source_ID}.json`), `${JSON.stringify(card, null, 2)}\n`, "utf8");
    cards.push(card);
  }

  const output = {
    version: "literature-article-kb-v5-route-confirmation-task-lens",
    generatedBy: "Codex local PDF evidence extraction plus dailypaper-style single-article notes; no website API and no OpenAI key usage",
    generatedAt: new Date().toISOString(),
    source: "Uploaded related-literature PDFs matched to Metro Rescue source cards",
    schema: [
      "文献身份",
      "一句话贡献",
      "研究任务映射",
      "研究问题与定位",
      "研究动机",
      "方法与数据",
      "关键结果",
      "可迁移变量/指标",
      "对本研究的用途",
      "边界与不能声称",
      "关联证据单元",
      "引用线索",
    ],
    pdfDirectoryMatched: Boolean(pdfDirectory),
    pdfCount: pdfFilenames.length,
    articleCount: cards.length,
    articles: cards,
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${cards.length} curated article knowledge cards to ${outputPath}`);
}

function buildExtractiveArticleCard(source, matchedPdfFilename, extractedText) {
  const abstractText = extractSection(extractedText, "abstract", ["keywords", "introduction", "1 introduction"]);
  const methodText = extractSection(extractedText, "method", ["result", "findings", "discussion", "conclusion"]);
  const experimentText = extractSection(extractedText, "experiment", ["result", "findings", "discussion", "conclusion"]);
  const resultText = extractSection(extractedText, "result", ["discussion", "conclusion", "limitation", "references"]);
  const discussionText = extractSection(extractedText, "discussion", ["conclusion", "references"]);
  const conclusionText = extractSection(extractedText, "conclusion", ["references"]);
  const linkedEvidence = buildLinkedEvidence(source.Source_ID);
  const methodEvidence = compactStrings([methodText, experimentText]).join(" ");
  const findingEvidence = compactStrings([resultText, discussionText, conclusionText, abstractText]).join(" ");
  const extractedTitleCandidate = extractLikelyTitle(extractedText);
  const curated = buildCuratedArticleCard(source, linkedEvidence, {
    abstractText,
    methodEvidence,
    findingEvidence,
    extractedText,
  });

  const card = {
    id: source.Source_ID,
    title: source.Title,
    extractedTitleCandidate,
    filename: source.Filename,
    matchedPdfFilename,
    grade: source.Grade,
    depth: source.Depth,
    thesisSection: source.Thesis_Section,
    themeTags: splitTags(source.Theme_Tags),
    articleRole: curated.articleRole,
    evidenceType: curated.evidenceType,
    qualityTier: curated.qualityTier,
    oneSentenceSummary: curated.oneSentenceSummary,
    researchQuestion: curated.researchQuestion,
    researchPosition: curated.researchPosition,
    studyDesign: curated.studyDesign,
    participantsAndSample: curated.participantsAndSample,
    taskAndMaterials: curated.taskAndMaterials,
    variablesAndMeasures: curated.variablesAndMeasures,
    eegOrPhysioMeasures: curated.eegOrPhysioMeasures,
    behavioralMeasures: curated.behavioralMeasures,
    keyFindings: curated.keyFindings,
    metroRescueUse: curated.metroRescueUse,
    densityHypothesisRelevance: curated.densityHypothesisRelevance,
    methodTransfer: curated.methodTransfer,
    limitations: curated.limitations,
    doNotClaim: curated.doNotClaim,
    boundaries: curated.boundaries,
    quoteAnchorsToVerify: uniqueCompact([
      ...linkedEvidence.quoteAnchors.map((anchor) => anchor.anchor),
      ...findSentences(extractedText, ["signage", "wayfinding", "cognitive load", "uncertainty", "virtual reality"], 4),
    ]).slice(0, 8),
    keywords: uniqueCompact([...splitTags(source.Theme_Tags), ...extractKeywords(extractedText)]).slice(0, 12),
    writingUse: curated.writingUse,
    taskLens: buildRouteConfirmationTaskLens(source, curated, linkedEvidence),
    readingNote: buildPaperReadingNote(source, curated, linkedEvidence, extractedTitleCandidate),
    linkedEvidence,
    confidence: abstractText || methodText || resultText ? "medium" : "low",
    needsVerification: [
      "该卡片由 Codex 本地抽取 PDF 证据后整理，正式引用前需要核对原文页码、作者、年份和 DOI。",
      "关键结论需要人工确认是否来自 Results/Discussion 而非引言综述。",
      extractedTitleCandidate && normalizeLiteratureKey(extractedTitleCandidate) !== normalizeLiteratureKey(source.Title)
        ? `PDF 首页疑似标题抽取为：${extractedTitleCandidate}`
        : "",
    ].filter(Boolean),
    evidenceSnippets: {
      abstract: truncate(abstractText, 2200),
      methods: truncate(methodEvidence, 2200),
      resultsDiscussion: truncate(findingEvidence, 2600),
    },
  };

  return normalizeRouteConfirmationLanguage(card);
}

function normalizeRouteConfirmationLanguage(value) {
  if (typeof value === "string") {
    return normalizeRouteConfirmationText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeRouteConfirmationLanguage(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeRouteConfirmationLanguage(item)]));
  }
  return value;
}

function normalizeRouteConfirmationText(text) {
  return text
    .replace(/低\/中\/高密度/g, "低/中/高路径确认支持")
    .replace(/低密度/g, "低路径确认支持")
    .replace(/中等密度/g, "中等路径确认支持")
    .replace(/中密度/g, "中等路径确认支持")
    .replace(/高密度/g, "高路径确认支持")
    .replace(/标识密度/g, "路径确认支持/信息链完整性")
    .replace(/密度条件/g, "路径确认支持条件")
    .replace(/密度效应/g, "路径确认支持效应")
    .replace(/密度主效应/g, "路径确认支持主效应")
    .replace(/Density condition/g, "Route-confirmation support level")
    .replace(/density condition/g, "route-confirmation support level")
    .replace(/medium density/g, "medium route-confirmation support")
    .replace(/low density/g, "low route-confirmation support")
    .replace(/high density/g, "high route-confirmation support")
    .replace(/中等路径确认支持最高假设/g, "中等路径确认支持最高假设")
    .replace(/中等路径确认支持负荷最高假设/g, "中等路径确认支持负荷最高假设");
}

async function extractPdfText(pdfPath) {
  const bytes = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    useWorkerFetch: false,
  });
  const document = await loadingTask.promise;
  const chunks = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
      const pageText = content.items
        .map((item) => ("str" in item ? item.str ?? "" : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (pageText) chunks.push(`\n\n[Page ${pageNumber}]\n${pageText}`);
      page.cleanup();
      if (chunks.join("").length > maxExtractedChars) break;
    }
  } finally {
    await document.destroy();
  }
  return chunks.join("").slice(0, maxExtractedChars);
}

function extractSection(text, heading, nextHeadings) {
  const clean = text.replace(/\s+/g, " ");
  const lower = clean.toLowerCase();
  const start = lower.indexOf(heading.toLowerCase());
  if (start < 0) return "";
  let end = Math.min(clean.length, start + 18_000);
  for (const next of nextHeadings) {
    const index = lower.indexOf(next.toLowerCase(), start + heading.length + 100);
    if (index > start && index < end) end = index;
  }
  return clean.slice(start, end).trim();
}

function extractLikelyTitle(text) {
  const firstPage = text.split("[Page 2]")[0] ?? text.slice(0, 2500);
  const candidates = firstPage
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\[Page \d+\]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 20 && line.length < 220)
    .filter((line) => !/^(abstract|keywords|journal|elsevier|copyright|available online)/i.test(line));
  return candidates[0] ?? "";
}

function firstUsefulSentences(text, count) {
  return splitSentences(text)
    .filter((sentence) => sentence.length > 40)
    .slice(0, count)
    .join(" ");
}

function findSentences(text, keywords, limit) {
  const lowerKeywords = keywords.map((keyword) => keyword.toLowerCase());
  return splitSentences(text)
    .filter((sentence) => {
      const lower = sentence.toLowerCase();
      return sentence.length > 45 && lowerKeywords.some((keyword) => lower.includes(keyword));
    })
    .slice(0, limit);
}

function splitSentences(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function extractKeywords(text) {
  const section = extractSection(text, "keywords", ["introduction", "1 introduction", "abstract"]);
  return section
    .replace(/^keywords[:：]?/i, "")
    .split(/[;,|]/)
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 2 && keyword.length < 50)
    .slice(0, 8);
}

function buildCuratedArticleCard(source, linkedEvidence, extracted) {
  const note = curatedArticleNotes[source.Source_ID] ?? {};
  const articleRole = inferArticleRole(source);
  const evidenceType = inferEvidenceType(source);
  const sampleEvidence = conciseEvidenceSentences(extracted.extractedText, ["participants", "subjects", "students", "sample", "volunteers"], 2).join(" ");
  const sourceBoundary = translateBoundary(source.Do_not_claim);

  return {
    articleRole,
    evidenceType,
    qualityTier: formatQualityTier(source.Grade, source.Depth),
    oneSentenceSummary: note.summary || source.Key_Takeaway_PDF_Free,
    researchQuestion:
      note.question ||
      `该文围绕“${source.Title}”展开，重点关注 ${splitTags(source.Theme_Tags).join("、")} 与 ${articleRole}。`,
    researchPosition: uniqueCompact([
      `知识库定位：${articleRole}。`,
      note.summary || source.Key_Takeaway_PDF_Free,
      `对本项目的核心价值：${note.use?.[0] || source.How_to_use_in_Metro_Rescue}`,
    ]).join(" "),
    studyDesign: note.method || source.Method_or_Evidence,
    participantsAndSample: sampleEvidence || "本卡片未把样本量作为主字段；正式写作前请回到 PDF Methods 核对。",
    taskAndMaterials: uniqueCompact([
      note.method,
      extractUsefulTaskSentence(extracted.methodEvidence || extracted.abstractText),
      source.Method_or_Evidence,
    ])[0],
    variablesAndMeasures: uniqueCompact(inferProjectVariables(source)).slice(0, 6),
    eegOrPhysioMeasures: uniqueCompact(inferPhysioMeasures(source)).slice(0, 6),
    behavioralMeasures: uniqueCompact(inferBehaviorMeasures(source)).slice(0, 6),
    keyFindings: uniqueCompact([
      ...(note.findings ?? []),
      source.Key_Takeaway_PDF_Free,
      ...linkedEvidence.claims.map((claim) => claim.text),
    ]).slice(0, 8),
    metroRescueUse: uniqueCompact([
      ...(note.use ?? []),
      source.How_to_use_in_Metro_Rescue,
      ...linkedEvidence.mechanisms.map((mechanism) => mechanism.analysisImplication),
      ...linkedEvidence.hypotheses.map((hypothesis) => hypothesis.hypothesis),
    ]).slice(0, 10),
    densityHypothesisRelevance: uniqueCompact([
      ...inferDensityRelevance(source, extracted.abstractText, extracted.findingEvidence),
      ...inferCuratedDensityNotes(source),
    ]).slice(0, 5),
    methodTransfer: uniqueCompact([
      note.method,
      source.Method_or_Evidence,
      ...conciseEvidenceSentences(extracted.methodEvidence, ["vr", "virtual", "marker", "eeg", "eye-tracking", "sign", "wayfinding"], 3),
    ]).slice(0, 6),
    limitations: uniqueCompact([
      ...(note.boundaries ?? []),
      ...conciseEvidenceSentences(extracted.extractedText, ["limitation", "future work", "sample", "validity", "generaliz", "ecological"], 3),
    ]).slice(0, 6),
    doNotClaim: uniqueCompact([
      ...(note.boundaries ?? []),
      sourceBoundary,
      ...linkedEvidence.risks.map((risk) => `${risk.risk}: ${risk.fix}`),
    ]).slice(0, 8),
    boundaries: uniqueCompact([
      ...(note.boundaries ?? []),
      sourceBoundary,
      ...linkedEvidence.risks.map((risk) => `${risk.risk}: ${risk.fix}`),
    ]).slice(0, 8),
    writingUse: uniqueCompact([
      ...splitThesisSections(source.Thesis_Section),
      ...inferWritingUse(source),
    ]),
  };
}

function formatQualityTier(grade, depth) {
  const meaningByGrade = {
    A: "核心相关：可优先支撑本研究的背景、方法或变量定义",
    B: "中等相关：可用于方法类比、背景论证或边界讨论，但通常不是主结论的直接证据",
    C: "外围相关：只适合作为补充背景或未来工作",
    D: "低相关：一般不进入正文主证据链",
  };

  return `Grade ${grade}，${depth}；${meaningByGrade[grade] ?? "相关性待人工复核"}。该等级是 Metro Rescue 知识库的项目相关性标记，不是正式文献质量评价，引用前仍需核对原文。`;
}

function buildRouteConfirmationTaskLens(source, curated, linkedEvidence) {
  const text = [
    source.Title,
    source.Theme_Tags,
    source.Method_or_Evidence,
    source.Key_Takeaway_PDF_Free,
    source.How_to_use_in_Metro_Rescue,
    curated.oneSentenceSummary,
    curated.researchQuestion,
    curated.studyDesign,
    curated.keyFindings.join(" "),
    curated.metroRescueUse.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  return {
    frameworkRole: inferFrameworkRole(source, curated),
    constructSupport: buildConstructSupport(text, source, curated),
    measurementUse: buildMeasurementUse(text, curated),
    manuscriptUse: buildManuscriptUse(source, curated, linkedEvidence),
    caveats: uniqueCompact([
      ...curated.doNotClaim,
      text.includes("density") || text.includes("signage") || text.includes("wayfinding")
        ? ""
        : "该文不直接研究路径确认支持水平；写作时应作为类比或背景，而不是主效应证据。",
    ]).slice(0, 5),
  };
}

function inferFrameworkRole(source, curated) {
  const text = [source.Title, source.Theme_Tags, source.Method_or_Evidence, curated.studyDesign, curated.oneSentenceSummary]
    .join(" ")
    .toLowerCase();

  if (text.includes("warning") || text.includes("protective") || text.includes("broadcast") || text.includes("message") || text.includes("modality")) {
    return "提醒呈现方式与保护性行动指令清晰度文献：用于解释官方目标提醒如何改变后续路径确认。";
  }
  if (text.includes("eeg") || text.includes("fnirs") || text.includes("cognitive load") || text.includes("uncertainty")) {
    return "认知负荷与神经/生理表征文献：用于解释目标-线索-方向匹配的 effort side。";
  }
  if (text.includes("sign") || text.includes("wayfinding") || text.includes("landmark") || text.includes("route")) {
    return "路径确认信息链文献：用于定义现场线索、决策点覆盖、路线选择和准确率。";
  }
  if (text.includes("vr") || text.includes("virtual")) {
    return "VR 应急疏散方法文献：用于支撑实验范式和生态效度边界。";
  }
  return "背景或边界文献：用于补充理论背景、方法限制或未来工作。";
}

function buildConstructSupport(text, source, curated) {
  const support = [];

  if (/(sign|signage|wayfinding|route|landmark|direction|guidance|visibility|branch|decision point)/.test(text)) {
    support.push({
      construct: "X 路径确认支持水平",
      use: "用于操作化首次确认线索接近性、确认链连续性、关键决策点覆盖、线索间距或现场官方线索质量。",
      strength: source.Grade === "A" ? "high" : "medium",
    });
  }
  if (/(hesitation|delay|dwell|pause|stop|response|pre-evacuation|decision|route choice|exit choice|compliance)/.test(text)) {
    support.push({
      construct: "Y 行动迟滞",
      use: "用于定义行动启动延迟、决策点停留、重复核对、路线选择延迟或疏散行为迟滞。",
      strength: text.includes("hesitation") || text.includes("pre-evacuation") ? "high" : "medium",
    });
  }
  if (/(reliability|trust|dependable|confidence|validity|consistent|halo)/.test(text)) {
    support.push({
      construct: "M1 感知信息可靠性",
      use: "用于解释个体为什么会继续依赖官方线索、相信确认链或把现场线索纳入路径判断。",
      strength: "medium",
    });
  }
  if (/(eeg|fnirs|cognitive load|uncertainty|attention|mental workload|theta|alpha|pupil)/.test(text)) {
    support.push({
      construct: "M2 信息加工负荷",
      use: "用于解释目标-线索-方向匹配带来的认知努力，并连接 EEG theta/alpha、事件窗负荷或不确定状态分类。",
      strength: text.includes("eeg") ? "high" : "medium",
    });
  }
  if (/(warning|protective action|broadcast|message|audio|modality|handheld|mobile|text)/.test(text)) {
    support.push({
      construct: "W 保护性行动指令清晰度",
      use: "用于解释官方目标提醒的通道和清晰度如何影响后续路径确认、注意转移和匹配负担。",
      strength: "medium",
    });
  }
  if (/(accuracy|correct|choice|destination|exit|route|compliance|error)/.test(text)) {
    support.push({
      construct: "辅助因变量 路径判断准确率",
      use: "用于区分低迟滞是否伴随低准确率，以及高支持是否同时带来低迟滞和高准确率。",
      strength: "medium",
    });
  }

  if (!support.length) {
    support.push({
      construct: "背景/方法边界",
      use: curated.metroRescueUse[0] || source.How_to_use_in_Metro_Rescue,
      strength: "low",
    });
  }

  return support.slice(0, 6);
}

function buildMeasurementUse(text, curated) {
  const uses = [];

  if (/(sign|signage|visibility|readable|decision point|wayfinding|route)/.test(text)) {
    uses.push("可帮助定义 Unity marker：sign_visible_enter、sign_readable、decision_point_enter、direction choice 和 route confirmation event。");
  }
  if (/(pause|dwell|delay|hesitation|response|pre-evacuation|decision)/.test(text)) {
    uses.push("可帮助定义行动迟滞指标：首次行动启动时间、决策点停顿时间、重复核对次数、停留、扫描、掉头和回退。");
  }
  if (/(eeg|theta|alpha|fnirs|cognitive load|attention|uncertainty)/.test(text)) {
    uses.push("可帮助定义 EEG/生理指标：事件窗 theta、alpha、theta/alpha、frontal theta、posterior alpha 或不确定状态分类。");
  }
  if (/(accuracy|correct|exit|route choice|destination|compliance)/.test(text)) {
    uses.push("可帮助定义准确率指标：首次方向选择是否正确、决策点正确率和最终是否到达正确目标。");
  }

  return uniqueCompact([...uses, ...curated.behavioralMeasures.slice(0, 2)]).slice(0, 6);
}

function buildManuscriptUse(source, curated, linkedEvidence) {
  return uniqueCompact([
    source.Grade === "A" ? "可优先用于正文主证据链。" : "",
    ...curated.writingUse.map((item) => `适合章节：${item}`),
    linkedEvidence.claims[0]?.use ? `可支撑论点：${linkedEvidence.claims[0].use}` : "",
    curated.densityHypothesisRelevance[0] ? `可转写为路径确认支持假设：${curated.densityHypothesisRelevance[0]}` : "",
  ]).slice(0, 6);
}

function buildPaperReadingNote(source, curated, linkedEvidence, extractedTitleCandidate) {
  const transferableConcepts = uniqueCompact([
    ...curated.variablesAndMeasures,
    ...curated.eegOrPhysioMeasures,
    ...curated.behavioralMeasures,
    ...curated.densityHypothesisRelevance,
  ]).slice(0, 10);

  return {
    tldr: curated.oneSentenceSummary,
    problem: curated.researchQuestion,
    motivation: buildPaperMotivation(source, curated),
    methodSummary: curated.studyDesign,
    resultSummary: curated.keyFindings.slice(0, 4).join(" "),
    transferableConcepts,
    strengths: inferPaperStrengths(source, curated, linkedEvidence),
    weaknesses: uniqueCompact([
      ...curated.boundaries,
      ...curated.limitations,
      ...curated.doNotClaim,
    ]).slice(0, 6),
    writingAngles: uniqueCompact([
      ...curated.metroRescueUse,
      ...curated.methodTransfer,
      ...curated.writingUse.map((item) => `适合写入：${item}`),
    ]).slice(0, 8),
    followUpQuestions: uniqueCompact([
      extractedTitleCandidate && normalizeLiteratureKey(extractedTitleCandidate) !== normalizeLiteratureKey(source.Title)
        ? `核对 PDF 首页标题是否应改为：${extractedTitleCandidate}`
        : "",
      "正式引用前核对作者、年份、期刊、DOI 和页码。",
      "确认当前卡片中的结果句是否来自 Results/Discussion，而不是 Introduction 的文献转述。",
      "确认该文是否能支持 Metro Rescue 的 density condition，还是只能作为 VR/wayfinding/EEG 方法类比。",
    ]),
  };
}

function buildPaperMotivation(source, curated) {
  const role = curated.articleRole;
  const tags = splitTags(source.Theme_Tags).join("、");
  return uniqueCompact([
    `该文被纳入知识库，是因为它能补足 ${role} 这一证据层。`,
    tags ? `它关联的主题包括 ${tags}。` : "",
    curated.densityHypothesisRelevance[0] ? `对当前研究的核心启发是：${curated.densityHypothesisRelevance[0]}` : "",
  ]).join(" ");
}

function inferPaperStrengths(source, curated, linkedEvidence) {
  const strengths = [];
  const text = [source.Title, source.Theme_Tags, source.Method_or_Evidence, curated.studyDesign].join(" ").toLowerCase();

  if (source.Grade === "A") strengths.push("与 Metro Rescue 的研究对象或方法高度接近，可优先用于 Introduction、Methods 或 Discussion。");
  if (text.includes("vr") || text.includes("virtual")) strengths.push("包含 VR 或虚拟环境范式，可帮助论证实验场景的可控性与生态效度边界。");
  if (text.includes("eeg") || text.includes("fnirs") || text.includes("physiological")) strengths.push("包含神经/生理测量，可用于说明认知负荷指标的理论或方法来源。");
  if (text.includes("sign") || text.includes("wayfinding") || text.includes("navigation")) strengths.push("直接关联导向标识、寻路或室内导航，可用于定义行为指标和任务机制。");
  if (linkedEvidence.claims.length || linkedEvidence.mechanisms.length) strengths.push("已经与知识库中的论点或机制相连，写作时更容易追溯证据链。");

  return strengths.length ? strengths.slice(0, 6) : ["主要作为背景文献使用，写作时应避免把类比证据写成直接实验结果。"];
}

function translateBoundary(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/do not/i.test(text)) return text.replace(/^Do not/i, "不要").replace(/^do not/i, "不要");
  return text;
}

function extractUsefulTaskSentence(text) {
  return (
    conciseEvidenceSentences(text, ["task", "scenario", "virtual", "vr", "evacuation", "wayfinding", "signage"], 1)[0] ||
    firstUsefulSentences(text, 1)
  );
}

function conciseEvidenceSentences(text, keywords, limit) {
  return findSentences(text, keywords, limit * 5)
    .filter((sentence) => sentence.length <= 320)
    .filter((sentence) => !sentence.includes("[Page"))
    .filter((sentence) => !/copyright|journal|article info|correspondence|received|accepted|published/i.test(sentence))
    .slice(0, limit);
}

function inferProjectVariables(source) {
  const text = [source.Title, source.Theme_Tags, source.Method_or_Evidence, source.How_to_use_in_Metro_Rescue].join(" ").toLowerCase();
  const variables = [];
  if (text.includes("sign")) variables.push("标识可见性、标识方向、标识位置、标识连续性或信息密度");
  if (text.includes("density") || text.includes("complexity") || text.includes("branch")) variables.push("空间复杂度、分支数、决策点复杂度");
  if (text.includes("audio") || text.includes("modality") || text.includes("attention")) variables.push("信息模态、注意转移、提示时窗");
  if (text.includes("vr") || text.includes("virtual")) variables.push("VR 场景、任务顺序、熟悉度和沉浸程度");
  if (text.includes("risk") || text.includes("smoke") || text.includes("panic") || text.includes("urgency")) variables.push("紧急度、风险感知、压力或情绪负荷");
  return variables;
}

function inferPhysioMeasures(source) {
  const text = [source.Title, source.Theme_Tags, source.Method_or_Evidence, source.Key_Takeaway_PDF_Free].join(" ").toLowerCase();
  const measures = [];
  if (text.includes("eeg")) measures.push("EEG 频谱特征、事件窗特征或分类特征");
  if (text.includes("theta")) measures.push("theta power");
  if (text.includes("alpha")) measures.push("alpha power / alpha suppression");
  if (text.includes("fnirs")) measures.push("fNIRS / prefrontal activation");
  if (text.includes("eye") || text.includes("gaze") || text.includes("fixation")) measures.push("眼动注视、扫视、视觉搜索指标");
  if (text.includes("pupil")) measures.push("pupil / cognitive load proxy");
  return measures.length ? measures : ["如该文不含神经生理指标，则仅作为行为或方法背景。"];
}

function inferBehaviorMeasures(source) {
  const text = [source.Title, source.Theme_Tags, source.Method_or_Evidence, source.Key_Takeaway_PDF_Free].join(" ").toLowerCase();
  const measures = [];
  if (text.includes("choice")) measures.push("路线选择、出口选择或 compliance");
  if (text.includes("wayfinding") || text.includes("navigation")) measures.push("寻路完成时间、错误、路径效率");
  if (text.includes("sign")) measures.push("标识发现、标识确认、按标识行动");
  if (text.includes("route") || text.includes("distance")) measures.push("路径长度、回退、绕行或距离");
  if (text.includes("attention") || text.includes("eye")) measures.push("视觉搜索、注视次数、确认成本");
  return measures.length ? measures : ["行为指标需回到原文 Methods/Results 核对。"];
}

function inferCuratedDensityNotes(source) {
  const text = [source.Title, source.Theme_Tags, source.Key_Takeaway_PDF_Free, source.How_to_use_in_Metro_Rescue].join(" ").toLowerCase();
  const notes = [];
  if (text.includes("nonlinear") || text.includes("clarity") || text.includes("complexity")) {
    notes.push("可用于支持“认知负荷可能呈非线性”这一理论前提。");
  }
  if (text.includes("uncertainty") || text.includes("cognitive load")) {
    notes.push("可用于解释中等密度可能因信息不充分但又需要判断而提高 uncertainty/cognitive load。");
  }
  if (text.includes("sign") || text.includes("modality") || text.includes("wayfinding")) {
    notes.push("可用于把低/中/高密度转化为标识可见性、确认成本和路线决策事件的组内因素。");
  }
  if (!notes.length) notes.push("与中等密度最高假设关系较弱，主要作为背景、方法或边界文献。");
  return notes;
}

function inferWritingUse(source) {
  const text = [source.Title, source.Theme_Tags, source.Thesis_Section].join(" ").toLowerCase();
  const use = [];
  if (text.includes("eeg") || text.includes("fnirs") || text.includes("cognitive")) use.push("EEG/认知负荷指标依据");
  if (text.includes("sign") || text.includes("wayfinding") || text.includes("landmark")) use.push("导向标识与寻路理论");
  if (text.includes("vr") || text.includes("virtual")) use.push("VR 实验范式与生态效度");
  if (text.includes("model") || text.includes("simulation") || text.includes("digital twin")) use.push("建模与未来应用");
  if (text.includes("review") || text.includes("framework")) use.push("文献综述与理论框架");
  return use;
}

function buildOneSentenceSummary(source, abstractText) {
  const abstractLead = firstUsefulSentences(abstractText, 1);
  if (abstractLead) return abstractLead;
  return source.Key_Takeaway_PDF_Free;
}

function buildResearchPosition(source, abstractText) {
  const abstractLead = firstUsefulSentences(abstractText, 1);
  return uniqueCompact([
    `该文在本知识库中主要定位为“${inferArticleRole(source)}”。`,
    abstractLead ? `摘要线索：${abstractLead}` : "",
    `在 Metro Rescue 中的使用边界：${source.How_to_use_in_Metro_Rescue}`,
  ]).join(" ");
}

function inferDensityRelevance(source, abstractText, findingEvidence) {
  const text = [source.Title, source.Theme_Tags, source.How_to_use_in_Metro_Rescue, abstractText, findingEvidence].join(" ").toLowerCase();
  const relevance = [];
  if (text.includes("nonlinear") || text.includes("quadratic") || text.includes("inverted") || text.includes("complexity")) {
    relevance.push("可作为中等密度认知负荷可能呈非线性变化的类比证据，但不能替代本研究的 XDF 结果。");
  }
  if (text.includes("sign") || text.includes("wayfinding") || text.includes("landmark") || text.includes("information")) {
    relevance.push("可支持把标识密度/信息可读性作为影响导向决策与认知负荷的理论变量。");
  }
  if (!relevance.length) {
    relevance.push("不能直接支持中密度负荷最高假设，只能作为背景或方法参考。");
  }
  return relevance;
}

function buildLinkedEvidence(sourceId) {
  return {
    claims: bySource(seedKnowledgeBase.claims, sourceId, "Sources").map((claim) => ({
      id: claim.Claim_ID,
      type: claim.Type,
      text: claim.Claim,
      use: claim.How_to_use,
      section: claim.Thesis_Section,
    })),
    mechanisms: bySource(seedKnowledgeBase.mechanisms, sourceId, "Sources").map((mechanism) => ({
      id: mechanism.Mechanism_ID,
      mechanism: mechanism.Mechanism,
      explanation: mechanism.Plain_Explanation,
      metroVariables: mechanism.Metro_Variables,
      analysisImplication: mechanism.Analysis_Implication,
    })),
    hypotheses: bySource(seedKnowledgeBase.hypotheses, sourceId, "Sources").map((hypothesis) => ({
      id: hypothesis.Hypothesis_ID,
      hypothesis: hypothesis.Hypothesis,
      prediction: hypothesis.Prediction,
      model: hypothesis.Model_Formula,
      note: hypothesis.Note,
    })),
    risks: bySource(seedKnowledgeBase.risks_and_fixes, sourceId, "Sources").map((risk) => ({
      id: risk.Risk_ID,
      risk: risk.Risk,
      whyItMatters: risk.Why_it_matters,
      fix: risk.Fix,
    })),
    qa: bySource(seedKnowledgeBase.qa, sourceId, "Sources").map((qa) => ({
      id: qa.Question_ID,
      question: qa.Question,
      answer: qa.Answer,
    })),
    quoteAnchors: seedKnowledgeBase.quote_anchors
      .filter((anchor) => anchor.Source_ID === sourceId)
      .map((anchor, index) => ({
        id: `${anchor.Source_ID}-${index + 1}`,
        anchor: anchor.Short_Original_Anchor,
        pageTarget: anchor.Page_Target,
        use: anchor.Use,
        verificationTask: anchor.Task,
      })),
  };
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--limit") options.limit = args[++index];
    else if (arg === "--pdf-dir") options.pdfDir = args[++index];
  }
  return options;
}

function findLargestPdfDirectory(baseDirectory) {
  if (!fs.existsSync(baseDirectory)) return "";
  const candidates = [];
  walkDirectories(baseDirectory, (directory) => {
    const pdfCount = fs.readdirSync(directory).filter((filename) => filename.toLowerCase().endsWith(".pdf")).length;
    if (pdfCount >= 20) candidates.push({ directory, pdfCount });
  });
  candidates.sort((a, b) => b.pdfCount - a.pdfCount);
  return candidates[0]?.directory ?? "";
}

function walkDirectories(directory, visit) {
  visit(directory);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) walkDirectories(path.join(directory, entry.name), visit);
  }
}

function bySource(items, sourceId, key) {
  return items.filter((item) => splitSourceIds(item[key]).includes(sourceId));
}

function splitSourceIds(value) {
  return Array.from(new Set(String(value ?? "").match(/S\d{3}/g) ?? []));
}

function splitTags(value) {
  return String(value ?? "")
    .split(/[;/,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function splitThesisSections(value) {
  return String(value ?? "")
    .split(/[;/]/)
    .map((section) => section.trim())
    .filter(Boolean);
}

function compactStrings(values) {
  return values.map((value) => String(value ?? "").trim()).filter(Boolean);
}

function uniqueCompact(values) {
  return Array.from(new Set(compactStrings(values)));
}

function truncate(value, maxLength) {
  const text = String(value ?? "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function normalizeLiteratureKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\.(pdf|docx?|txt|md)$/i, "")
    .replace(/\(\d+\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferArticleRole(source) {
  const text = [source.Title, source.Theme_Tags, source.Method_or_Evidence, source.Thesis_Section].join(" ").toLowerCase();
  if (text.includes("eeg") || text.includes("fnirs") || text.includes("brain") || text.includes("cognitive load")) {
    return "神经生理与认知负荷证据";
  }
  if (text.includes("sign") || text.includes("wayfinding") || text.includes("navigation") || text.includes("landmark")) {
    return "导向标识与空间导航证据";
  }
  if (text.includes("vr") || text.includes("virtual reality") || text.includes("immersive")) {
    return "VR 实验范式与生态效度证据";
  }
  if (text.includes("simulation") || text.includes("digital twin") || text.includes("agent")) {
    return "疏散建模与数字孪生背景";
  }
  return "背景与方法参考";
}

function inferEvidenceType(source) {
  const text = [source.Title, source.Theme_Tags, source.Method_or_Evidence].join(" ").toLowerCase();
  if (text.includes("review")) return "综述";
  if (text.includes("model") || text.includes("simulation") || text.includes("digital twin")) return "建模研究";
  if (text.includes("guideline")) return "指南";
  if (text.includes("experiment") || text.includes("vr") || text.includes("empirical")) return "实验研究";
  return "方法或背景研究";
}

class PdfDomMatrixPolyfill {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  is2D = true;

  constructor(init) {
    if (Array.isArray(init)) {
      this.a = Number(init[0] ?? 1);
      this.b = Number(init[1] ?? 0);
      this.c = Number(init[2] ?? 0);
      this.d = Number(init[3] ?? 1);
      this.e = Number(init[4] ?? 0);
      this.f = Number(init[5] ?? 0);
    }
  }

  static fromFloat32Array(array32) {
    return new PdfDomMatrixPolyfill(Array.from(array32));
  }

  static fromFloat64Array(array64) {
    return new PdfDomMatrixPolyfill(Array.from(array64));
  }

  static fromMatrix(other) {
    return new PdfDomMatrixPolyfill([other?.a ?? 1, other?.b ?? 0, other?.c ?? 0, other?.d ?? 1, other?.e ?? 0, other?.f ?? 0]);
  }
}

class PdfImageDataPolyfill {
  colorSpace = "srgb";

  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

class PdfPath2DPolyfill {}

function installPdfNodePolyfills() {
  globalThis.DOMMatrix ??= PdfDomMatrixPolyfill;
  globalThis.ImageData ??= PdfImageDataPolyfill;
  globalThis.Path2D ??= PdfPath2DPolyfill;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
