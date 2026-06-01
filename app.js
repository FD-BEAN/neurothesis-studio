const state = {
  papers: [],
  activePaperId: null,
  routeVariant: 0,
  analysisRows: [],
  drafts: {},
  activeCode: "python",
};

const demoPapers = [
  {
    id: "p1",
    title: "VR 逃生与紧急指示牌条件下的寻路行为",
    type: "VR 寻路",
    scenario: "沉浸式地铁站逃生任务，比较不同方向指示牌设计。",
    measures: "路线完成时间、错误转向、注视代理指标、主观负荷。",
    finding:
      "在关键决策点附近设置更醒目的指示牌，可以提升时间压力下的路线选择一致性。",
    chinese:
      "在关键岔路口增强指示牌显著减少错误转向，适合支撑地铁逃生路线设计。",
    summary:
      "这条示例记录代表 VR 逃生实验相关文献，重点关注指示牌位置如何影响紧急寻路表现。",
    extracts: {
      "研究问题": "视觉引导如何改变陌生紧急空间中的路线选择。",
      "方法": "被试内 VR 导航任务，并控制可选逃生路线。",
      "对论文的价值": "支持实验场景设计和行为因变量选择。",
      "局限": "多数研究更强调行为表现，对神经生理负荷关注不足。"
    },
  },
  {
    id: "p2",
    title: "导航任务中认知负荷的 EEG theta 与 alpha 指标",
    type: "EEG 认知负荷",
    scenario: "不同任务负荷下的空间决策和路线记忆。",
    measures: "额叶 theta 功率、顶枕 alpha 抑制、theta / alpha 负荷指数。",
    finding:
      "更高认知负荷通常伴随额叶 theta 增强和后部 alpha 功率降低。",
    chinese:
      "额叶 theta 增强和后部 alpha 降低可作为认知负荷变化的候选 EEG 指标。",
    summary:
      "这条示例记录用于说明导航与认知任务中 EEG 负荷指标的测量逻辑。",
    extracts: {
      "研究问题": "哪些 EEG 节律对任务需求增加更敏感。",
      "方法": "伪迹剔除和条件分段后进行时频分析。",
      "对论文的价值": "帮助选择用于比较认知负荷的 EEG 特征。",
      "局限": "VR 运动场景中的 EEG 指标需要严格控制伪迹。"
    },
  },
  {
    id: "p3",
    title: "认知负荷对紧急信息加工的影响",
    type: "认知负荷",
    scenario: "被试在完成二级任务的同时理解安全指令。",
    measures: "任务准确率、反应时间、主观负荷、理解得分。",
    finding:
      "额外工作记忆负荷会降低对密集紧急指令的理解。",
    chinese:
      "高认知负荷会削弱复杂安全信息的理解，说明指示牌需要低负担、可快速识别。",
    summary:
      "这条示例记录把认知负荷操控、紧急指令理解和指示牌清晰度联系起来。",
    extracts: {
      "研究问题": "心理负荷如何改变紧急信息加工。",
      "方法": "通过不同条件操控任务负荷，并测量理解结果。",
      "对论文的价值": "说明为什么要在改变指示牌设计的同时操控认知负荷。",
      "局限": "可能没有包含沉浸式导航或 EEG 测量。"
    },
  },
  {
    id: "p4",
    title: "交通枢纽多模态逃生引导的设计原则",
    type: "指示牌设计",
    scenario: "包含出口、通道、站台和障碍的大型公共交通空间。",
    measures: "可见性、决策点识别、路径效率、安全行为符合度。",
    finding:
      "图标与颜色组合可以降低用户在复杂空间中快速移动时的阅读负担。",
    chinese:
      "图标与颜色编码能降低阅读负担，适合与 VR 地铁站逃生任务结合。",
    summary:
      "这条示例记录代表复杂交通环境中多模态指示牌设计的相关指导。",
    extracts: {
      "研究问题": "哪些指示牌特征有助于用户快速做出逃生决策。",
      "方法": "在不同交通枢纽布局和引导方式下进行设计评价。",
      "对论文的价值": "帮助确定指示牌设计自变量的水平。",
      "局限": "设计原则仍需用 VR 与 EEG 数据进行实证验证。"
    },
  },
];

const codeTemplates = {
  python: `# Python / MNE skeleton for the future real-data version
import mne
import pandas as pd
import numpy as np

raw = mne.io.read_raw_edf("sub-01_task-evacuation_eeg.edf", preload=True)
raw.filter(l_freq=1, h_freq=40)
raw.notch_filter(freqs=[50, 60])

events = mne.find_events(raw)
epochs = mne.Epochs(
    raw,
    events,
    event_id={"low_load": 1, "high_load": 2},
    tmin=-0.2,
    tmax=2.0,
    baseline=(-0.2, 0),
    preload=True,
)

theta = epochs.compute_psd(fmin=4, fmax=7).get_data().mean(axis=(-1, -2))
alpha = epochs.compute_psd(fmin=8, fmax=12).get_data().mean(axis=(-1, -2))
workload_index = theta / alpha

features = pd.DataFrame({
    "condition": epochs.events[:, 2],
    "theta_alpha_index": workload_index,
})
features.to_csv("eeg_workload_features.csv", index=False)`,
  matlab: `% MATLAB / EEGLAB skeleton for the future real-data version
[ALLEEG, EEG, CURRENTSET, ALLCOM] = eeglab;
EEG = pop_biosig('sub-01_task-evacuation_eeg.edf');
EEG = pop_eegfiltnew(EEG, 1, 40);
EEG = pop_cleanline(EEG, 'LineFrequencies', [50 60]);
EEG = pop_epoch(EEG, {'low_load', 'high_load'}, [-0.2 2.0]);
EEG = pop_rmbase(EEG, [-200 0]);

% Continue with ICA, artifact rejection, time-frequency extraction,
% and condition-level statistics after quality control.
thetaBand = [4 7];
alphaBand = [8 12];
disp('Extract theta/alpha workload index by condition');`,
};

const sectionDrafts = {
  abstract: {
    en: `<h4>Abstract</h4><p>This study investigates how emergency signage design influences evacuation wayfinding performance and EEG-derived cognitive load in an immersive VR subway station. Participants complete evacuation route tasks under different cognitive-load conditions while behavioral outcomes and EEG workload markers are recorded. The planned analysis compares route efficiency, decision errors, frontal theta activity, and posterior alpha activity across signage conditions. The study aims to identify signage features that reduce cognitive demand and support faster, more reliable evacuation decisions in complex transit environments.</p>`,
    zh: `<h4>摘要解释</h4><p>这段摘要把论文的四个核心元素连起来：VR 地铁站场景、指示牌设计、认知负荷操控、EEG 与行为指标。它没有夸大结果，而是用 planned analysis 和 aims to identify 这类表述，适合还在实验或写作阶段的硕士论文。</p>`,
  },
  introduction: {
    en: `<h4>Introduction</h4><p>Emergency evacuation in subway stations requires rapid interpretation of spatial information under stress, uncertainty, and limited time. In such environments, signage is not merely a visual aid but a cognitive interface between the built environment and the evacuee. Prior work on VR evacuation, cognitive load, and EEG-based workload assessment suggests that guidance systems should be evaluated not only by route performance but also by the mental effort required to interpret them.</p><ul><li>Position the public-safety problem.</li><li>Explain why VR is suitable for controlled evacuation scenarios.</li><li>Introduce EEG as a complementary workload measure.</li></ul>`,
    zh: `<h4>引言解释</h4><p>引言要先讲现实问题，再讲研究缺口。这里的逻辑是：地铁逃生很依赖快速空间判断，指示牌会影响认知加工负担，而 VR + EEG 可以同时观察行为表现和脑电负荷。</p>`,
  },
  methods: {
    en: `<h4>Methods</h4><p>The experiment uses a VR subway-station evacuation task with manipulated signage design and cognitive-load level. Participants are instructed to reach a designated exit as quickly and accurately as possible. Behavioral measures include evacuation time, wrong turns, hesitation at decision points, and route efficiency. EEG data are preprocessed using filtering, artifact inspection, epoching around decision points, and time-frequency feature extraction. The primary EEG workload index combines frontal theta power and posterior alpha power to compare cognitive demand across conditions.</p>`,
    zh: `<h4>方法解释</h4><p>方法部分需要非常具体：自变量是指示牌设计和认知负荷，因变量包括逃生时间、错误转向、决策点停顿、路线效率，以及 EEG 的 theta/alpha 指标。真实写作时要补充设备型号、采样率、通道数、VR 软件、实验流程和伦理审批。</p>`,
  },
  results: {
    en: `<h4>Results</h4><p>In the demo analysis, enhanced signage produced shorter evacuation times and lower EEG workload indices than conventional signage, with the largest difference appearing under high cognitive load. The pattern suggests that visually explicit guidance may reduce the mental effort required at route-choice points. These results should be treated as placeholder text until real participant data are processed and model assumptions are checked.</p>`,
    zh: `<h4>结果解释</h4><p>结果段必须基于真实统计结果。现在这只是 demo 文案，用来展示最终产品会如何把图表和统计输出转成英文结果描述。正式版本要自动插入均值、标准差、p 值、置信区间和效应量。</p>`,
  },
  discussion: {
    en: `<h4>Discussion</h4><p>The expected contribution of this thesis is to connect emergency wayfinding design with neurophysiological evidence of cognitive workload. If enhanced signage reduces both behavioral errors and EEG workload, the findings would support the design of evacuation guidance that is cognitively efficient as well as visually salient. Important limitations include the ecological validity of VR, motion-related EEG artifacts, sample size constraints, and the need to validate workload indices against subjective and behavioral measures.</p>`,
    zh: `<h4>讨论解释</h4><p>讨论部分要把发现上升到设计意义，但也要诚实写局限。VR 的生态效度、EEG 运动伪迹、样本量、主观量表与脑电指标的一致性，都会是导师可能追问的点。</p>`,
  },
};

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function setView(id) {
  $all(".view").forEach((view) => view.classList.toggle("is-visible", view.id === id));
  $all(".nav-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === id);
  });
}

function loadDemo() {
  state.papers = structuredClone(demoPapers);
  state.activePaperId = state.papers[0].id;
  state.analysisRows = createDemoRows();
  state.drafts = structuredClone(sectionDrafts);
  updateMetrics();
  renderPapers();
  renderMatrix();
  generateDesign();
  runAnalysis();
  renderDraft();
  $("#projectStatus").textContent = "示例项目已加载";
  showToast("示例项目已加载");
}

function resetDemo() {
  state.papers = [];
  state.activePaperId = null;
  state.analysisRows = [];
  state.drafts = {};
  updateMetrics();
  renderPapers();
  renderMatrix();
  $("#designOutput").innerHTML = "";
  $("#statsSummary").innerHTML = "";
  $("#analysisStatus").textContent = "Not run";
  $("#englishDraft").innerHTML = "<p>Load demo project, then generate a manuscript section.</p>";
  $("#chineseDraft").innerHTML = "<p>加载 demo 后，这里会显示中文解释。</p>";
  drawWorkloadChart([]);
  $("#projectStatus").textContent = "示例数据已就绪";
  showToast("工作台已重置");
}

function updateMetrics() {
  $("#paperCount").textContent = state.papers.length;
  $("#conditionCount").textContent = state.analysisRows.length ? 6 : 0;
  $("#participantCount").textContent = state.analysisRows.length
    ? new Set(state.analysisRows.map((row) => row.participant)).size
    : 0;
  $("#draftCount").textContent = Object.keys(state.drafts).length;
}

function renderPapers() {
  const list = $("#paperList");
  if (!state.papers.length) {
    list.innerHTML = `<p class="paper-summary">还没有论文。可以添加论文，或加载示例项目。</p>`;
    $("#activePaperTitle").textContent = "尚未选择论文";
    $("#activePaperTag").textContent = "等待中";
    $("#paperSummary").innerHTML = `<p>加载示例项目后，这里会显示与论文主题相关的结构化摘要。</p>`;
    $("#paperExtracts").innerHTML = "";
    return;
  }

  list.innerHTML = state.papers
    .map(
      (paper) => `<button class="paper-card ${paper.id === state.activePaperId ? "is-active" : ""}" data-paper="${paper.id}">
        <strong>${paper.title}</strong>
        <p>${paper.type}</p>
      </button>`,
    )
    .join("");

  $all("[data-paper]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activePaperId = button.dataset.paper;
      renderPapers();
    });
  });

  const active = state.papers.find((paper) => paper.id === state.activePaperId) || state.papers[0];
  $("#activePaperTitle").textContent = active.title;
  $("#activePaperTag").textContent = active.type;
  $("#paperSummary").innerHTML = `<p>${active.summary}</p>`;
  $("#paperExtracts").innerHTML = Object.entries(active.extracts)
    .map(
      ([label, value]) => `<div class="extract-item">
        <strong>${label}</strong>
        <p>${value}</p>
      </div>`,
    )
    .join("");
}

function renderMatrix() {
  const body = $("#matrixBody");
  const query = $("#matrixSearch").value.trim().toLowerCase();
  const lens = $("#matrixLens").value;
  const rows = state.papers.filter((paper) => {
    const haystack = Object.values(paper).join(" ").toLowerCase();
    return !query || haystack.includes(query);
  });

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5">没有符合当前筛选条件的记录。</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map((paper) => {
      let focus = paper.finding;
      if (lens === "method") focus = paper.extracts.Method;
      if (lens === "measure") focus = paper.measures;
      if (lens === "limitation") focus = paper.extracts.Limitation;
      return `<tr>
        <td><strong>${paper.title}</strong><br><span>${paper.type}</span></td>
        <td>${paper.scenario}</td>
        <td>${paper.measures}</td>
        <td>${focus}</td>
        <td>${paper.chinese}</td>
      </tr>`;
    })
    .join("");
}

function generateDesign() {
  const load = $("#loadDesign").value;
  const signage = $("#signageDesign").value;
  const question = $("#researchQuestion").value.trim();
  $("#designOutput").innerHTML = `
    <div class="design-block">
      <strong>研究问题</strong>
      <p>${question}</p>
    </div>
    <div class="design-block">
      <strong>自变量</strong>
      <p>1. 认知负荷：${load}。<br>2. 指示牌设计：${signage}。</p>
    </div>
    <div class="design-block">
      <strong>因变量</strong>
      <p>逃生时间、路线效率、错误转向、决策点犹豫、额叶 theta、后部 alpha、theta/alpha 负荷指数。</p>
    </div>
    <div class="design-block">
      <strong>研究假设</strong>
      <p>H1：增强指示牌会减少导航错误并缩短逃生时间。H2：高认知负荷会提高 EEG 负荷指标。H3：在高负荷条件下，增强指示牌会削弱认知负荷上升。</p>
    </div>
    <div class="design-block">
      <strong>中文说明</strong>
      <p>这个设计把“指示牌是否更清晰”和“认知负荷是否更高”作为两个核心自变量，同时用行为数据和 EEG 指标交叉验证。</p>
    </div>`;
  showToast("实验设计已更新");
}

function createDemoRows() {
  const rows = [];
  const signs = [
    { name: "常规", effect: 0.16 },
    { name: "增强", effect: -0.1 },
  ];
  const loads = [
    { name: "低负荷", effect: -0.12 },
    { name: "中负荷", effect: 0.02 },
    { name: "高负荷", effect: 0.18 },
  ];

  for (let participant = 1; participant <= 36; participant += 1) {
    signs.forEach((sign, signIndex) => {
      loads.forEach((load, loadIndex) => {
        const participantNoise = ((participant % 7) - 3) * 0.012;
        const interaction = sign.name === "增强" && load.name === "高负荷" ? -0.07 : 0;
        const workload = 1.02 + sign.effect + load.effect + interaction + participantNoise;
        const time = 185 + loadIndex * 21 + signIndex * -18 + participantNoise * 160;
        rows.push({
          participant,
          signage: sign.name,
          load: load.name,
          workload: Number(workload.toFixed(3)),
          time: Number(time.toFixed(1)),
          errors: Math.max(0, Math.round(1 + loadIndex * 0.7 - signIndex * 0.6 + participantNoise * 8)),
        });
      });
    });
  }
  return rows;
}

function groupByCondition(rows) {
  const groups = {};
  rows.forEach((row) => {
    const key = `${row.signage} / ${row.load}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  });
  return Object.entries(groups).map(([condition, values]) => ({
    condition,
    meanWorkload: mean(values.map((row) => row.workload)),
    meanTime: mean(values.map((row) => row.time)),
    meanErrors: mean(values.map((row) => row.errors)),
  }));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function runAnalysis() {
  if (!state.analysisRows.length) state.analysisRows = createDemoRows();
  const summary = groupByCondition(state.analysisRows);
  drawWorkloadChart(summary);
  const conventionalHigh = summary.find((row) => row.condition === "常规 / 高负荷");
  const enhancedHigh = summary.find((row) => row.condition === "增强 / 高负荷");
  const delta = conventionalHigh.meanWorkload - enhancedHigh.meanWorkload;
  $("#analysisStatus").textContent = "示例完成";
  $("#statsSummary").innerHTML = `
    <div class="stats-card"><p><strong>高负荷对比：</strong>相较于常规指示牌，增强指示牌使示例负荷指数降低 ${delta.toFixed(2)}。</p></div>
    <div class="stats-card"><p><strong>行为模式：</strong>增强指示牌在不同负荷水平下都表现出更短逃生时间和更少错误转向。</p></div>
    <div class="stats-card"><p><strong>下一步：</strong>用真实被试级 CSV 替换示例数据，并估计混合效应模型。</p></div>`;
  $("#pipelineCode").textContent = codeTemplates[state.activeCode];
  updateMetrics();
  showToast("示例分析已完成");
}

function drawWorkloadChart(summary) {
  const canvas = $("#workloadChart");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fbfcfc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#d7e0e3";
  ctx.lineWidth = 1;

  for (let i = 0; i <= 4; i += 1) {
    const y = 52 + i * 72;
    ctx.beginPath();
    ctx.moveTo(72, y);
    ctx.lineTo(682, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#17202a";
  ctx.font = "700 18px Microsoft YaHei, Segoe UI";
  ctx.fillText("按实验条件对比 EEG 认知负荷指数", 72, 32);
  ctx.font = "12px Microsoft YaHei, Segoe UI";
  ctx.fillStyle = "#5c6c73";
  ctx.fillText("示例特征：theta / alpha。此模拟数据中数值越低，认知负荷越小。", 72, 380);

  if (!summary.length) {
    ctx.fillStyle = "#5c6c73";
    ctx.fillText("运行分析后显示图表。", 72, 108);
    return;
  }

  const maxValue = Math.max(...summary.map((row) => row.meanWorkload), 1.35);
  const barWidth = 70;
  const gap = 30;
  const startX = 86;
  const baseline = 338;
  const scale = 230 / maxValue;

  summary.forEach((row, index) => {
    const x = startX + index * (barWidth + gap);
    const h = row.meanWorkload * scale;
    ctx.fillStyle = row.condition.startsWith("增强") ? "#0f766e" : "#315a8c";
    ctx.fillRect(x, baseline - h, barWidth, h);
    ctx.fillStyle = "#17202a";
    ctx.font = "700 12px Microsoft YaHei, Segoe UI";
    ctx.fillText(row.meanWorkload.toFixed(2), x + 16, baseline - h - 8);
    ctx.save();
    ctx.translate(x + 10, baseline + 16);
    ctx.rotate(-0.54);
    ctx.font = "11px Microsoft YaHei, Segoe UI";
    ctx.fillStyle = "#5c6c73";
    ctx.fillText(row.condition.replace(" / ", " "), 0, 0);
    ctx.restore();
  });
}

function drawRoute() {
  const canvas = $("#routeCanvas");
  const ctx = canvas.getContext("2d");
  const routes = [
    {
      path: [
        [80, 360],
        [200, 360],
        [200, 250],
        [370, 250],
        [370, 150],
        [600, 150],
      ],
      signs: [
        [205, 328],
        [338, 252],
        [405, 150],
      ],
    },
    {
      path: [
        [80, 360],
        [155, 360],
        [155, 200],
        [305, 200],
        [305, 86],
        [620, 86],
      ],
      signs: [
        [156, 320],
        [278, 202],
        [336, 88],
      ],
    },
  ];
  const active = routes[state.routeVariant];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fbfcfc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#d7e0e3";
  ctx.lineWidth = 16;
  ctx.lineCap = "round";
  const corridors = [
    [[68, 360], [692, 360]],
    [[155, 72], [155, 388]],
    [[200, 92], [200, 388]],
    [[300, 86], [300, 250]],
    [[370, 86], [370, 280]],
    [[146, 200], [660, 200]],
    [[190, 250], [650, 250]],
    [[300, 86], [682, 86]],
    [[368, 150], [682, 150]],
  ];
  corridors.forEach((line) => {
    ctx.beginPath();
    ctx.moveTo(line[0][0], line[0][1]);
    ctx.lineTo(line[1][0], line[1][1]);
    ctx.stroke();
  });

  ctx.fillStyle = "#f4d7d0";
  ctx.fillRect(512, 238, 88, 24);
  ctx.fillRect(186, 186, 88, 24);
  ctx.fillStyle = "#b85645";
  ctx.font = "700 13px Segoe UI";
  ctx.fillText("封闭", 530, 255);
  ctx.fillText("烟雾", 210, 203);

  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 8;
  ctx.beginPath();
  active.path.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point[0], point[1]);
    else ctx.lineTo(point[0], point[1]);
  });
  ctx.stroke();

  active.signs.forEach(([x, y]) => drawSign(ctx, x, y));
  drawNode(ctx, active.path[0][0], active.path[0][1], "#315a8c", "起");
  drawNode(ctx, active.path.at(-1)[0], active.path.at(-1)[1], "#2f7a49", "出");

  ctx.fillStyle = "#17202a";
  ctx.font = "800 18px Microsoft YaHei, Segoe UI";
  ctx.fillText("VR 地铁站逃生路线", 34, 38);
  ctx.font = "12px Microsoft YaHei, Segoe UI";
  ctx.fillStyle = "#5c6c73";
  ctx.fillText("可把决策点与 EEG 分段对齐，用于分析认知负荷变化。", 34, 60);
}

function drawNode(ctx, x, y, color, label) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 14px Microsoft YaHei, Segoe UI";
  ctx.fillText(label, x - 7, y + 5);
}

function drawSign(ctx, x, y) {
  ctx.fillStyle = "#fff7df";
  ctx.strokeStyle = "#a86f00";
  ctx.lineWidth = 2;
  ctx.fillRect(x - 18, y - 14, 44, 28);
  ctx.strokeRect(x - 18, y - 14, 44, 28);
  ctx.fillStyle = "#a86f00";
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 6);
  ctx.lineTo(x + 14, y);
  ctx.lineTo(x - 6, y + 6);
  ctx.closePath();
  ctx.fill();
}

function renderDraft() {
  const section = $("#draftSection").value;
  const draft = state.drafts[section] || sectionDrafts[section];
  $("#englishDraft").innerHTML = draft.en;
  $("#chineseDraft").innerHTML = draft.zh;
  showToast("Draft section generated");
}

function exportText(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportMatrix() {
  const header = ["Paper", "Scenario", "Measures", "Finding", "Chinese note"];
  const lines = state.papers.map((paper) =>
    [paper.title, paper.scenario, paper.measures, paper.finding, paper.chinese]
      .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
      .join(","),
  );
  exportText("neurothesis-literature-matrix.csv", [header.join(","), ...lines].join("\n"), "text/csv");
  showToast("CSV exported");
}

function exportDraft() {
  const section = $("#draftSection").value;
  const en = $("#englishDraft").innerText.trim();
  const zh = $("#chineseDraft").innerText.trim();
  exportText(`neurothesis-${section}-draft.md`, `# ${section}\n\n## English\n\n${en}\n\n## 中文解释\n\n${zh}\n`);
  showToast("Markdown exported");
}

async function copyText(text, success) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(success);
  } catch {
    showToast("Clipboard permission unavailable");
  }
}

function handlePaperUpload(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  const uploaded = files.map((file, index) => ({
    id: `u${Date.now()}-${index}`,
    title: file.name.replace(/\.[^.]+$/, ""),
    type: "已上传论文",
    scenario: "后续 AI 版本会解析 PDF 场景与实验设置。",
    measures: "待提取：EEG 指标、行为变量、样本、方法。",
    finding: "文件已记录。核心流程验证后会接入完整解析能力。",
    chinese: "已记录文件名。正式版会自动抽取摘要、方法、指标和局限。",
    summary:
      "当前本地原型暂不解析真实 PDF，先展示未来 AI 结构化提取结果出现的位置。",
    extracts: {
      "研究问题": "待提取",
      "方法": "待提取",
      "对论文的价值": "待提取",
      "局限": "待提取"
    },
  }));
  state.papers = [...uploaded, ...state.papers];
  state.activePaperId = uploaded[0].id;
  updateMetrics();
  renderPapers();
  renderMatrix();
  showToast(`${files.length} paper file(s) added`);
}

function wireEvents() {
  $all(".nav-item").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  $all("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.jump));
  });
  $("#loadDemo").addEventListener("click", loadDemo);
  $("#resetDemo").addEventListener("click", resetDemo);
  $("#toggleRoute").addEventListener("click", () => {
    state.routeVariant = state.routeVariant ? 0 : 1;
    drawRoute();
  });
  $("#matrixSearch").addEventListener("input", renderMatrix);
  $("#matrixLens").addEventListener("change", renderMatrix);
  $("#generatePlan").addEventListener("click", generateDesign);
  $("#copyPlan").addEventListener("click", () => copyText($("#designOutput").innerText, "Plan copied"));
  $("#runAnalysis").addEventListener("click", runAnalysis);
  $("#paperUpload").addEventListener("change", handlePaperUpload);
  $("#dataUpload").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) showToast(`${file.name} captured for future import`);
  });
  $all(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeCode = button.dataset.code;
      $all(".tab-button").forEach((tab) => tab.classList.toggle("is-active", tab === button));
      $("#pipelineCode").textContent = codeTemplates[state.activeCode];
    });
  });
  $("#generateDraft").addEventListener("click", renderDraft);
  $("#copyDraft").addEventListener("click", () =>
    copyText(`${$("#englishDraft").innerText}\n\n${$("#chineseDraft").innerText}`, "Draft copied"),
  );
  $("#exportMatrix").addEventListener("click", exportMatrix);
  $("#exportDraft").addEventListener("click", exportDraft);
}

wireEvents();
drawRoute();
loadDemo();
