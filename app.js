(function () {
  "use strict";

  const DATA = window.ARCTIC_DATA;
  if (!DATA || !DATA.years) {
    document.body.innerHTML = "<p style='padding:24px'>데이터(data/sea_ice_data.js)를 불러오지 못했습니다.</p>";
    return;
  }

  const STORAGE_KEY = "arctic_captain_state_v1";
  const MIN_YEAR = 1979;
  const MAX_YEAR = 2035;
  const GAUGE_MAX = 16.0;

  const SHIP_PRESETS = {
    merchant: {
      id: "merchant",
      name: "일반 상선",
      desc: "일반 상선 (보수적 기준)",
      openMax: 5.0,
      cautionMax: 6.5
    },
    iceclass: {
      id: "iceclass",
      name: "내빙선 (Ice-Class)",
      desc: "내빙선 (표준 기준)",
      openMax: 6.5,
      cautionMax: 8.5
    },
    icebreaker: {
      id: "icebreaker",
      name: "쇄빙선 (Icebreaker)",
      desc: "쇄빙선 (완화 기준)",
      openMax: 9.0,
      cautionMax: 11.5
    }
  };

  const defaultState = {
    year: 2024,
    month: 9,
    preset: "iceclass",
    openMax: 6.5,
    cautionMax: 8.5,
    model: "sarima",
    activeTab: "calendar"
  };

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved) return { ...defaultState };
      return {
        year: clampInt(saved.year, MIN_YEAR, MAX_YEAR, defaultState.year),
        month: clampInt(saved.month, 1, 12, defaultState.month),
        preset: saved.preset === "custom" || SHIP_PRESETS[saved.preset] ? saved.preset : defaultState.preset,
        openMax: clampNum(saved.openMax, 3.0, 12.0, defaultState.openMax),
        cautionMax: clampNum(saved.cautionMax, 4.0, 14.5, defaultState.cautionMax),
        model: saved.model === "baseline" ? "baseline" : "sarima",
        activeTab: "calendar"
      };
    } catch (_) {
      return { ...defaultState };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        year: state.year,
        month: state.month,
        preset: state.preset,
        openMax: state.openMax,
        cautionMax: state.cautionMax,
        model: state.model
      }));
    } catch (_) {
      // Ignore storage quota errors
    }
  }

  function clampInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function clampNum(v, min, max, fallback) {
    const n = parseFloat(v);
    if (Number.isNaN(n)) return fallback;
    return Math.round(Math.min(max, Math.max(min, n)) * 10) / 10;
  }

  const state = loadState();
  if (state.cautionMax < state.openMax + 0.5) {
    state.cautionMax = Math.min(14.5, Math.round((state.openMax + 0.5) * 10) / 10);
  }

  // DOM Elements
  const yearSelect = document.getElementById("yearSelect");
  const prevYearBtn = document.getElementById("prevYearBtn");
  const nextYearBtn = document.getElementById("nextYearBtn");
  const yearDataTag = document.getElementById("yearDataTag");
  const quickYearBtns = document.querySelectorAll(".chip-btn[data-year]");
  const modelToggleBox = document.getElementById("modelToggleBox");
  const modelMetricBadge = document.getElementById("modelMetricBadge");
  const modelSegBtns = document.querySelectorAll(".seg-btn[data-model]");

  const verdictCard = document.getElementById("verdictCard");
  const verdictDate = document.getElementById("verdictDate");
  const verdictSourcePill = document.getElementById("verdictSourcePill");
  const verdictShipLabel = document.getElementById("verdictShipLabel");
  const verdictStatusBadge = document.getElementById("verdictStatusBadge");
  const verdictExtent = document.getElementById("verdictExtent");
  const verdictCompareBox = document.getElementById("verdictCompareBox");
  const gaugeOpenZone = document.getElementById("gaugeOpenZone");
  const gaugeCautionZone = document.getElementById("gaugeCautionZone");
  const gaugeBlockedZone = document.getElementById("gaugeBlockedZone");
  const gaugeMarker = document.getElementById("gaugeMarker");
  const gaugeOpenLabel = document.getElementById("gaugeOpenLabel");
  const gaugeCautionLabel = document.getElementById("gaugeCautionLabel");
  const verdictBrief = document.getElementById("verdictBrief");

  const calYearTitle = document.getElementById("calYearTitle");
  const calSummaryPills = document.getElementById("calSummaryPills");
  const calendarGrid = document.getElementById("calendarGrid");

  const presetBtns = document.querySelectorAll(".preset-btn[data-preset]");
  const openSlider = document.getElementById("openSlider");
  const cautionSlider = document.getElementById("cautionSlider");
  const openSliderVal = document.getElementById("openSliderVal");
  const cautionSliderVal = document.getElementById("cautionSliderVal");
  const resetThresholdBtn = document.getElementById("resetThresholdBtn");
  const customModeNote = document.getElementById("customModeNote");

  const goQuizBtn = document.getElementById("goQuizBtn");
  const navTabs = document.querySelectorAll(".nav-tab[data-nav]");
  const backNavBtns = document.querySelectorAll("[data-nav]:not(.nav-tab)");
  const screens = {
    calendar: document.getElementById("screen-calendar"),
    quiz: document.getElementById("screen-quiz"),
    trend: document.getElementById("screen-trend")
  };

  const eduBadgeBtn = document.getElementById("eduBadgeBtn");
  const infoModal = document.getElementById("infoModal");
  const closeModalBtn = document.getElementById("closeModalBtn");
  const infoModalBody = document.getElementById("infoModalBody");

  // Populate Year Select (1979 ~ 2035)
  for (let yr = MIN_YEAR; yr <= MAX_YEAR; yr++) {
    const opt = document.createElement("option");
    opt.value = String(yr);
    const months = DATA.years[String(yr)];
    const hasFc = months.some((m) => m.type === "fc");
    const hasObs = months.some((m) => m.type === "obs");
    const suffix = hasObs && hasFc ? " (실측+예측)" : hasFc ? " (예측)" : "";
    opt.textContent = `${yr}년${suffix}`;
    yearSelect.appendChild(opt);
  }

  function getMonthExtent(rec, model) {
    if (rec.type === "obs") return rec.extent;
    return model === "baseline" ? rec.baseline : rec.sarima;
  }

  function judgeStatus(extent) {
    if (extent <= state.openMax) {
      return { key: "open", label: "항해 가능", badge: "✓ 항해 가능", short: "가능" };
    }
    if (extent <= state.cautionMax) {
      return { key: "caution", label: "주의", badge: "▲ 주의 필요", short: "주의" };
    }
    return { key: "blocked", label: "불가", badge: "✕ 항해 불가", short: "불가" };
  }

  function getCurrentShipLabel() {
    if (state.preset === "custom") {
      return `사용자 지정 기준 (가능 ≤${state.openMax.toFixed(1)} · 주의 ≤${state.cautionMax.toFixed(1)})`;
    }
    return `${SHIP_PRESETS[state.preset].desc} (가능 ≤${state.openMax.toFixed(1)})`;
  }

  function buildCaptainBrief(rec, extent, status) {
    const monthStr = `${state.year}년 ${state.month}월`;
    const isFc = rec.type === "fc";
    const diffOpen = (extent - state.openMax).toFixed(2);
    if (status.key === "open") {
      return `${monthStr}의 북극 해빙 면적은 ${extent.toFixed(2)} M km²로, 현재 항해 가능 기준(${state.openMax.toFixed(1)} M km²)보다 낮습니다. ${
        isFc ? "예측 모델상 출항 창구가 열릴 가능성이 높으나 신뢰구간을 함께 확인하세요." : "교육용 기준상 북극항로 통항을 검토할 수 있는 시기입니다."
      }`;
    }
    if (status.key === "caution") {
      return `${monthStr}의 해빙 면적(${extent.toFixed(2)} M km²)은 가능 기준보다 ${diffOpen} M km² 높아 '주의' 구간입니다. 내빙 등급 상향이나 출항 월 조정(8~9월)을 검토해 보세요.`;
    }
    return `${monthStr}은 해빙 면적이 ${extent.toFixed(2)} M km²로 매우 넓어 결빙 위험이 큰 '항해 불가' 구간입니다. 하절기(8~10월)로 출항 일정을 옮겨 비교해 보세요.`;
  }

  function render() {
    const yearRecs = DATA.years[String(state.year)];
    const selectedRec = yearRecs[state.month - 1];
    const hasAnyForecast = yearRecs.some((r) => r.type === "fc");
    const hasAnyObs = yearRecs.some((r) => r.type === "obs");

    // 1. Year controls
    yearSelect.value = String(state.year);
    prevYearBtn.disabled = state.year <= MIN_YEAR;
    nextYearBtn.disabled = state.year >= MAX_YEAR;

    if (hasAnyObs && hasAnyForecast) {
      yearDataTag.textContent = "실측 + 예측";
      yearDataTag.className = "year-data-tag is-fc";
    } else if (hasAnyForecast) {
      yearDataTag.textContent = state.model === "sarima" ? "SARIMA 예측" : "기준선 예측";
      yearDataTag.className = "year-data-tag is-fc";
    } else {
      yearDataTag.textContent = "NSIDC 실측";
      yearDataTag.className = "year-data-tag";
    }

    quickYearBtns.forEach((btn) => {
      const y = parseInt(btn.dataset.year, 10);
      btn.classList.toggle("active", y === state.year);
    });

    // 2. Forecast model toggle
    modelToggleBox.classList.toggle("hidden", !hasAnyForecast);
    if (hasAnyForecast) {
      const mMeta = DATA.meta.models[state.model];
      modelMetricBadge.textContent = `검증 MAE ${mMeta.mae.toFixed(3)} · RMSE ${mMeta.rmse.toFixed(3)}`;
      modelSegBtns.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.model === state.model);
      });
    }

    // 3. Verdict card
    const extent = getMonthExtent(selectedRec, state.model);
    const status = judgeStatus(extent);

    verdictCard.className = `card verdict-card status-${status.key}`;
    verdictDate.textContent = `${state.year}년 ${state.month}월`;
    if (selectedRec.type === "obs") {
      verdictSourcePill.textContent = selectedRec.interp ? "NSIDC 보간값" : "NSIDC 실측";
      verdictSourcePill.className = "source-pill";
    } else {
      verdictSourcePill.textContent = state.model === "sarima" ? "SARIMA 예측" : "기준선 예측";
      verdictSourcePill.className = "source-pill is-fc";
    }

    verdictShipLabel.textContent = getCurrentShipLabel();
    verdictStatusBadge.textContent = status.badge;
    verdictExtent.textContent = extent.toFixed(2);

    if (selectedRec.type === "fc") {
      verdictCompareBox.classList.remove("hidden");
      const diff = selectedRec.sarima - selectedRec.baseline;
      const sign = diff >= 0 ? "+" : "";
      if (state.model === "sarima") {
        verdictCompareBox.innerHTML =
          `<div>95% 신뢰구간 <strong>${selectedRec.lo95.toFixed(2)}~${selectedRec.hi95.toFixed(2)}</strong></div>` +
          `<div>기준선(${selectedRec.baseline.toFixed(2)}) 대비 ${sign}${diff.toFixed(2)}</div>`;
      } else {
        verdictCompareBox.innerHTML =
          `<div>SARIMA 예측 <strong>${selectedRec.sarima.toFixed(2)}</strong></div>` +
          `<div>SARIMA 95% 구간 ${selectedRec.lo95.toFixed(2)}~${selectedRec.hi95.toFixed(2)}</div>`;
      }
    } else {
      verdictCompareBox.classList.add("hidden");
    }

    // Gauge proportions
    const openPct = Math.min(100, (state.openMax / GAUGE_MAX) * 100);
    const cautionPct = Math.max(0, Math.min(100 - openPct, ((state.cautionMax - state.openMax) / GAUGE_MAX) * 100));
    const blockedPct = Math.max(0, 100 - openPct - cautionPct);
    const markerPct = Math.max(1.5, Math.min(98.5, (extent / GAUGE_MAX) * 100));

    gaugeOpenZone.style.width = `${openPct}%`;
    gaugeCautionZone.style.width = `${cautionPct}%`;
    gaugeBlockedZone.style.width = `${blockedPct}%`;
    gaugeMarker.style.left = `${markerPct}%`;
    gaugeOpenLabel.textContent = `가능 ≤${state.openMax.toFixed(1)}`;
    gaugeCautionLabel.textContent = `주의 ≤${state.cautionMax.toFixed(1)}`;

    verdictBrief.textContent = buildCaptainBrief(selectedRec, extent, status);

    // 4. 12-Month Calendar Grid
    calYearTitle.textContent = String(state.year);
    let openCount = 0;
    let cautionCount = 0;
    calendarGrid.innerHTML = "";

    yearRecs.forEach((rec) => {
      const val = getMonthExtent(rec, state.model);
      const st = judgeStatus(val);
      if (st.key === "open") openCount++;
      else if (st.key === "caution") cautionCount++;

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `month-cell status-${st.key}${rec.m === state.month ? " selected" : ""}`;
      cell.setAttribute("aria-pressed", rec.m === state.month ? "true" : "false");
      cell.innerHTML = `
        <span class="cell-top">
          <span>${rec.m}월</span>
          ${rec.type === "fc" ? `<span class="cell-fc-dot">예측</span>` : ""}
        </span>
        <span class="cell-extent">${val.toFixed(2)}</span>
        <span class="cell-status">${st.short}</span>
      `;
      cell.addEventListener("click", () => {
        state.month = rec.m;
        saveState();
        render();
      });
      calendarGrid.appendChild(cell);
    });

    calSummaryPills.innerHTML =
      `<span class="mini-pill open">가능 ${openCount}개월</span>` +
      `<span class="mini-pill caution">주의 ${cautionCount}개월</span>`;

    // 5. Presets & Sliders
    presetBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.preset === state.preset);
    });
    openSlider.value = String(state.openMax);
    cautionSlider.value = String(state.cautionMax);
    openSliderVal.textContent = `${state.openMax.toFixed(1)} M km²`;
    cautionSliderVal.textContent = `${state.cautionMax.toFixed(1)} M km²`;
    customModeNote.classList.toggle("hidden", state.preset !== "custom");
  }

  function switchTab(tabName) {
    state.activeTab = tabName;
    Object.keys(screens).forEach((key) => {
      screens[key].classList.toggle("active", key === tabName);
    });
    navTabs.forEach((tab) => {
      const isActive = tab.dataset.nav === tabName;
      tab.classList.toggle("active", isActive);
      if (isActive) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function populateMetaViews() {
    const m = DATA.meta;
    const b = m.models.baseline;
    const s = m.models.sarima;
    const tableHtml = `
      <table class="modal-table">
        <thead>
          <tr><th>모델</th><th>검증 MAE</th><th>검증 RMSE</th></tr>
        </thead>
        <tbody>
          <tr><td>${b.name}</td><td>${b.mae.toFixed(3)}</td><td>${b.rmse.toFixed(3)}</td></tr>
          <tr><td><strong>${s.name}</strong></td><td><strong>${s.mae.toFixed(3)}</strong></td><td><strong>${s.rmse.toFixed(3)}</strong></td></tr>
        </tbody>
      </table>
    `;

    infoModalBody.innerHTML = `
      <h3>1. 데이터 출처</h3>
      <p>${m.source}<br/>실측 기간: <strong>${m.observedStart} ~ ${m.observedEnd}</strong> (총 ${m.observedMonths}개월), 예측 기간: <strong>~ ${m.forecastEnd}</strong></p>
      <p>위성 센서 교체 결측(${m.interpolatedMonths.join(", ")})은 인접 연도 동월 평균으로 보간하여 시계열 모델에 반영했습니다.</p>
      <h3>2. 예측 모델 검증 비교 (${b.valPeriod})</h3>
      ${tableHtml}
      <h3>3. 교육용 한계 고지</h3>
      <p>본 앱은 북극 전체 월별 해빙 면적(Extent)만을 단순화한 교육용 시뮬레이터입니다. 실제 북극항로 운항 판단에는 해빙 두께·밀집도, 구간별 빙황, 기상 및 국제 극지코드(Polar Code) 규정이 필수이므로 실제 항해에 사용할 수 없습니다.</p>
    `;
  }

  // Event Listeners
  yearSelect.addEventListener("change", () => {
    state.year = clampInt(yearSelect.value, MIN_YEAR, MAX_YEAR, 2024);
    saveState();
    render();
  });

  prevYearBtn.addEventListener("click", () => {
    if (state.year > MIN_YEAR) {
      state.year -= 1;
      saveState();
      render();
    }
  });

  nextYearBtn.addEventListener("click", () => {
    if (state.year < MAX_YEAR) {
      state.year += 1;
      saveState();
      render();
    }
  });

  quickYearBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.year = parseInt(btn.dataset.year, 10);
      if (btn.dataset.month) state.month = parseInt(btn.dataset.month, 10);
      saveState();
      render();
    });
  });

  modelSegBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.model = btn.dataset.model;
      saveState();
      render();
    });
  });

  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = SHIP_PRESETS[btn.dataset.preset];
      if (!p) return;
      state.preset = p.id;
      state.openMax = p.openMax;
      state.cautionMax = p.cautionMax;
      saveState();
      render();
    });
  });

  openSlider.addEventListener("input", () => {
    state.openMax = parseFloat(openSlider.value);
    if (state.cautionMax < state.openMax + 0.5) {
      state.cautionMax = Math.min(14.5, Math.round((state.openMax + 0.5) * 10) / 10);
    }
    state.preset = "custom";
    saveState();
    render();
  });

  cautionSlider.addEventListener("input", () => {
    state.cautionMax = parseFloat(cautionSlider.value);
    if (state.cautionMax < state.openMax + 0.5) {
      state.openMax = Math.max(3.0, Math.round((state.cautionMax - 0.5) * 10) / 10);
    }
    state.preset = "custom";
    saveState();
    render();
  });

  resetThresholdBtn.addEventListener("click", () => {
    const p = SHIP_PRESETS.iceclass;
    state.preset = p.id;
    state.openMax = p.openMax;
    state.cautionMax = p.cautionMax;
    saveState();
    render();
  });

  goQuizBtn.addEventListener("click", () => switchTab("quiz"));
  navTabs.forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.nav)));
  backNavBtns.forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.nav)));

  eduBadgeBtn.addEventListener("click", () => infoModal.classList.remove("hidden"));
  closeModalBtn.addEventListener("click", () => infoModal.classList.add("hidden"));
  infoModal.addEventListener("click", (e) => {
    if (e.target === infoModal) infoModal.classList.add("hidden");
  });

  // =========================================================
  // SCREEN 2: 5단계 선장 출항 미션 퀴즈 & 최종 리포트
  // =========================================================
  const QUIZ_BANK = window.ARCTIC_QUIZ || [];
  const QUIZ_STORAGE_KEY = "arctic_captain_quiz_v1";
  const CHOICE_LETTERS = ["A", "B", "C", "D"];

  const quizModePill = document.getElementById("quizModePill");
  const quizStepText = document.getElementById("quizStepText");
  const quizScoreBadge = document.getElementById("quizScoreBadge");
  const quizProgressFill = document.getElementById("quizProgressFill");
  const quizBestBanner = document.getElementById("quizBestBanner");

  const quizPlayArea = document.getElementById("quizPlayArea");
  const quizTag = document.getElementById("quizTag");
  const quizBadges = document.getElementById("quizBadges");
  const quizQuestion = document.getElementById("quizQuestion");
  const toggleHintBtn = document.getElementById("toggleHintBtn");
  const hintArrow = document.getElementById("hintArrow");
  const inspectCalendarBtn = document.getElementById("inspectCalendarBtn");
  const quizHintBox = document.getElementById("quizHintBox");
  const quizChoices = document.getElementById("quizChoices");
  const quizFeedbackBox = document.getElementById("quizFeedbackBox");
  const feedbackHeader = document.getElementById("feedbackHeader");
  const feedbackText = document.getElementById("feedbackText");
  const nextMissionBtn = document.getElementById("nextMissionBtn");
  const nextMissionLabel = document.getElementById("nextMissionLabel");

  const quizReportArea = document.getElementById("quizReportArea");
  const reportMedal = document.getElementById("reportMedal");
  const reportRank = document.getElementById("reportRank");
  const reportScoreNum = document.getElementById("reportScoreNum");
  const reportAccuracy = document.getElementById("reportAccuracy");
  const reportSummaryText = document.getElementById("reportSummaryText");
  const reportReviewList = document.getElementById("reportReviewList");
  const retryWrongBtn = document.getElementById("retryWrongBtn");
  const restartQuizBtn = document.getElementById("restartQuizBtn");
  const goTrendBtn = document.getElementById("goTrendBtn");

  function loadQuizRecord() {
    try {
      const saved = JSON.parse(localStorage.getItem(QUIZ_STORAGE_KEY) || "null");
      if (!saved) return { bestScore: 0, bestRank: "", wrongIds: [], wrongChoices: {} };
      return {
        bestScore: Number(saved.bestScore) || 0,
        bestRank: typeof saved.bestRank === "string" ? saved.bestRank : "",
        wrongIds: Array.isArray(saved.wrongIds) ? saved.wrongIds : [],
        wrongChoices: saved.wrongChoices && typeof saved.wrongChoices === "object" ? saved.wrongChoices : {}
      };
    } catch (_) {
      return { bestScore: 0, bestRank: "", wrongIds: [], wrongChoices: {} };
    }
  }

  function saveQuizRecord(rec) {
    try {
      localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(rec));
    } catch (_) {
      // Ignore storage errors
    }
  }

  const quizRecord = loadQuizRecord();
  const quizSession = {
    mode: "full", // "full" | "wrong"
    queue: QUIZ_BANK.slice(),
    index: 0,
    score: 0,
    answered: false,
    hintOpen: false,
    results: [] // { id, tag, correct, takeaway }
  };

  function getCaptainRank(score, total) {
    const ratio = total > 0 ? score / total : 0;
    if (ratio >= 1.0) {
      return {
        medal: "🏆",
        title: "북극항로 마스터 선장",
        summary: "완벽합니다! 과거 실측 변화, 선박 등급, 이상기후, SARIMA 신뢰구간까지 데이터 기반으로 정확하게 판단했습니다."
      };
    }
    if (ratio >= 0.8) {
      return {
        medal: "🧭",
        title: "베테랑 극지 항해사",
        summary: "우수한 판단력입니다! 놓친 1개 미션의 데이터 근거만 확인하면 완벽한 북극항로 마스터가 될 수 있습니다."
      };
    }
    if (ratio >= 0.4) {
      return {
        medal: "⚓",
        title: "1등 항해사 (데이터 훈련 중)",
        summary: "기본 흐름은 잘 잡았습니다. 항해 달력에서 1985·2012·2024·2030년을 직접 비교한 뒤 오답을 다시 풀어 보세요."
      };
    }
    return {
      medal: "📘",
      title: "수습 항해사 (달력 탐색 추천)",
      summary: "첫 화면의 항해 달력에서 선박 프리셋과 연도를 눌러보며 감을 잡은 뒤 다시 도전하면 점수가 확 오릅니다!"
    };
  }

  function startQuizSession(mode) {
    if (mode === "wrong") {
      const targetIds = quizSession.results.length
        ? quizSession.results.filter((r) => !r.correct).map((r) => r.id)
        : quizRecord.wrongIds;
      const filtered = QUIZ_BANK.filter((q) => targetIds.includes(q.id));
      quizSession.mode = filtered.length ? "wrong" : "full";
      quizSession.queue = filtered.length ? filtered : QUIZ_BANK.slice();
    } else {
      quizSession.mode = "full";
      quizSession.queue = QUIZ_BANK.slice();
    }
    quizSession.index = 0;
    quizSession.score = 0;
    quizSession.answered = false;
    quizSession.hintOpen = false;
    quizSession.results = [];
    renderQuiz();
  }

  function renderQuizBanner() {
    if (quizRecord.bestScore > 0 || quizRecord.wrongIds.length > 0) {
      quizBestBanner.classList.remove("hidden");
      const bestText = quizRecord.bestScore > 0
        ? `최고 기록: ${quizRecord.bestScore}/${QUIZ_BANK.length} (${quizRecord.bestRank})`
        : "아직 완주 기록 없음";
      const rightHtml = quizRecord.wrongIds.length > 0
        ? `<button type="button" id="bannerOpenNoteBtn" class="banner-note-btn">📝 오답 노트 (${quizRecord.wrongIds.length})</button>`
        : `<strong>오답 없음</strong>`;
      quizBestBanner.innerHTML = `<span>${bestText}</span>${rightHtml}`;
      const bannerBtn = document.getElementById("bannerOpenNoteBtn");
      if (bannerBtn) {
        bannerBtn.addEventListener("click", () => openStudyNoteModal());
      }
    } else {
      quizBestBanner.classList.add("hidden");
    }
  }

  function renderQuiz() {
    if (!QUIZ_BANK.length) return;
    renderQuizBanner();

    const total = quizSession.queue.length;
    const isFinished = quizSession.index >= total;

    quizModePill.textContent = quizSession.mode === "wrong" ? "오답 복습 모드" : "5단계 선장 미션";
    quizModePill.classList.toggle("review-mode", quizSession.mode === "wrong");

    if (isFinished) {
      quizStepText.textContent = `완료 (${total} / ${total})`;
      quizScoreBadge.textContent = `최종 ${quizSession.score} / ${total}`;
      quizProgressFill.style.width = "100%";
      quizPlayArea.classList.add("hidden");
      quizReportArea.classList.remove("hidden");
      renderQuizReport();
      return;
    }

    quizPlayArea.classList.remove("hidden");
    quizReportArea.classList.add("hidden");

    const q = quizSession.queue[quizSession.index];
    quizStepText.textContent = `${quizSession.index + 1} / ${total}`;
    quizScoreBadge.textContent = `현재 점수 ${quizSession.score}점`;
    quizProgressFill.style.width = `${((quizSession.index + (quizSession.answered ? 1 : 0)) / total) * 100}%`;

    quizTag.textContent = q.tag;
    quizBadges.innerHTML = q.badges.map((b) => `<span class="mission-badge">${b}</span>`).join("");
    quizQuestion.textContent = q.question;

    // Hint box
    toggleHintBtn.setAttribute("aria-expanded", quizSession.hintOpen ? "true" : "false");
    hintArrow.textContent = quizSession.hintOpen ? "▴" : "▾";
    quizHintBox.classList.toggle("hidden", !quizSession.hintOpen);
    quizHintBox.innerHTML =
      `<div class="hint-box-title">${q.hintTitle}</div>` +
      q.hintRows
        .map(
          (r) =>
            `<div class="hint-row"><span class="hint-row-label">${r.label}</span><span class="hint-row-val">${r.value}</span></div>`
        )
        .join("");

    // Choices
    quizChoices.innerHTML = "";
    q.choices.forEach((choiceText, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn";
      btn.innerHTML = `<span class="choice-letter">${CHOICE_LETTERS[idx]}</span><span>${choiceText}</span>`;
      btn.addEventListener("click", () => handleChoiceSelect(idx));
      quizChoices.appendChild(btn);
    });

    quizFeedbackBox.classList.add("hidden");
  }

  function handleChoiceSelect(selectedIdx) {
    if (quizSession.answered) return;
    const q = quizSession.queue[quizSession.index];
    const isCorrect = selectedIdx === q.answerIndex;
    quizSession.answered = true;
    if (isCorrect) quizSession.score += 1;

    quizSession.results.push({
      id: q.id,
      tag: q.tag,
      correct: isCorrect,
      selectedIdx,
      takeaway: q.takeaway
    });
    if (!isCorrect) {
      quizRecord.wrongChoices[q.id] = selectedIdx;
      if (!quizRecord.wrongIds.includes(q.id)) {
        quizRecord.wrongIds.push(q.id);
      }
      saveQuizRecord(quizRecord);
    }

    // Highlight buttons
    const btns = quizChoices.querySelectorAll(".choice-btn");
    btns.forEach((btn, idx) => {
      btn.disabled = true;
      if (idx === q.answerIndex) {
        btn.classList.add("is-correct");
      } else if (idx === selectedIdx && !isCorrect) {
        btn.classList.add("is-wrong");
      } else {
        btn.classList.add("is-dimmed");
      }
    });

    // Update header progress & score
    const total = quizSession.queue.length;
    quizScoreBadge.textContent = `현재 점수 ${quizSession.score}점`;
    quizProgressFill.style.width = `${((quizSession.index + 1) / total) * 100}%`;

    // Show explanation
    quizFeedbackBox.className = `card feedback-card ${isCorrect ? "correct" : "wrong"}`;
    feedbackHeader.textContent = isCorrect ? "✓ 정답입니다! 정확한 선장 판단입니다." : "✕ 아쉽습니다! 실제 데이터를 확인해 보세요.";
    feedbackText.textContent = q.explanation;
    nextMissionLabel.textContent = quizSession.index + 1 < total ? "다음 미션으로" : "최종 선장 리포트 보기";
  }

  function renderQuizReport() {
    const total = quizSession.queue.length;
    const score = quizSession.score;
    const accuracy = Math.round((score / Math.max(1, total)) * 100);
    const rank = getCaptainRank(score, total);

    // Update persistent record
    const wrongInSession = quizSession.results.filter((r) => !r.correct).map((r) => r.id);
    if (quizSession.mode === "full") {
      if (score >= quizRecord.bestScore) {
        quizRecord.bestScore = score;
        quizRecord.bestRank = rank.title;
      }
      quizRecord.wrongIds = wrongInSession;
    } else {
      // Remove newly solved items from saved wrongIds
      const solvedIds = quizSession.results.filter((r) => r.correct).map((r) => r.id);
      quizRecord.wrongIds = quizRecord.wrongIds.filter((id) => !solvedIds.includes(id));
    }
    saveQuizRecord(quizRecord);
    renderQuizBanner();

    reportMedal.textContent = rank.medal;
    reportRank.textContent = rank.title;
    reportScoreNum.textContent = `${score} / ${total}`;
    reportAccuracy.textContent = `정답률 ${accuracy}%`;
    reportSummaryText.textContent = rank.summary;

    reportReviewList.innerHTML = quizSession.results
      .map(
        (r) => `
        <div class="review-item ${r.correct ? "ok" : "no"}">
          <div class="review-item-head">
            <span>${r.tag}</span>
            <span class="review-status">${r.correct ? "✓ 정답" : "✕ 오답"}</span>
          </div>
          <p class="review-takeaway">${r.takeaway}</p>
        </div>`
      )
      .join("");

    if (wrongInSession.length > 0) {
      retryWrongBtn.classList.remove("hidden");
      retryWrongBtn.textContent = `틀린 문제만 다시 풀기 (${wrongInSession.length}문제)`;
    } else {
      retryWrongBtn.classList.add("hidden");
    }
    updateStudyNoteEntryButton();
  }

  toggleHintBtn.addEventListener("click", () => {
    quizSession.hintOpen = !quizSession.hintOpen;
    toggleHintBtn.setAttribute("aria-expanded", quizSession.hintOpen ? "true" : "false");
    hintArrow.textContent = quizSession.hintOpen ? "▴" : "▾";
    quizHintBox.classList.toggle("hidden", !quizSession.hintOpen);
  });

  inspectCalendarBtn.addEventListener("click", () => {
    const q = quizSession.queue[quizSession.index];
    if (q && q.calendarLink) {
      const link = q.calendarLink;
      state.year = link.year;
      state.month = link.month;
      if (link.preset && SHIP_PRESETS[link.preset]) {
        state.preset = link.preset;
        state.openMax = SHIP_PRESETS[link.preset].openMax;
        state.cautionMax = SHIP_PRESETS[link.preset].cautionMax;
      }
      if (link.model) state.model = link.model;
      saveState();
      render();
    }
    switchTab("calendar");
  });

  nextMissionBtn.addEventListener("click", () => {
    quizSession.index += 1;
    quizSession.answered = false;
    quizSession.hintOpen = false;
    renderQuiz();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  retryWrongBtn.addEventListener("click", () => {
    startQuizSession("wrong");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  restartQuizBtn.addEventListener("click", () => {
    startQuizSession("full");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  goTrendBtn.addEventListener("click", () => switchTab("trend"));

  // =========================================================
  // SCREEN 3: 1979~2035 장기 추세 그래프 & 모델/한계 안내
  // =========================================================
  const trendState = {
    chartType: "months", // "months" | "september"
    ship: "iceclass"
  };

  const trendStatRow = document.getElementById("trendStatRow");
  const chartTabBtns = document.querySelectorAll(".chart-tab-btn[data-chart]");
  const trendShipBtns = document.querySelectorAll(".filter-pill[data-trend-ship]");
  const trendChartContainer = document.getElementById("trendChartContainer");
  const trendChartLegend = document.getElementById("trendChartLegend");
  const trendChartCaption = document.getElementById("trendChartCaption");
  const toggleModelAccBtn = document.getElementById("toggleModelAccBtn");
  const modelAccArrow = document.getElementById("modelAccArrow");
  const modelAccBody = document.getElementById("modelAccBody");
  const trendModelTableWrap = document.getElementById("trendModelTableWrap");
  const toggleLimitAccBtn = document.getElementById("toggleLimitAccBtn");
  const limitAccArrow = document.getElementById("limitAccArrow");
  const limitAccBody = document.getElementById("limitAccBody");
  const trendLimitBody = document.getElementById("trendLimitBody");

  function computeYearlySeries(shipKey) {
    const preset = SHIP_PRESETS[shipKey] || SHIP_PRESETS.iceclass;
    const rows = [];
    for (let yr = MIN_YEAR; yr <= MAX_YEAR; yr++) {
      const recs = DATA.years[String(yr)];
      let openMonthsSarima = 0;
      let openMonthsBase = 0;
      const isFuture = yr >= 2027;
      recs.forEach((r) => {
        const vS = r.type === "obs" ? r.extent : r.sarima;
        const vB = r.type === "obs" ? r.extent : r.baseline;
        if (vS <= preset.openMax) openMonthsSarima++;
        if (vB <= preset.openMax) openMonthsBase++;
      });
      const sep = recs[8];
      rows.push({
        year: yr,
        isFuture,
        openSarima: openMonthsSarima,
        openBase: openMonthsBase,
        sepObs: sep.type === "obs" ? sep.extent : null,
        sepSarima: sep.type === "fc" ? sep.sarima : sep.extent,
        sepBase: sep.type === "fc" ? sep.baseline : sep.extent,
        sepLo: sep.type === "fc" ? sep.lo95 : null,
        sepHi: sep.type === "fc" ? sep.hi95 : null
      });
    }
    return rows;
  }

  function avg(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function renderMonthsChart(rows, preset) {
    const W = 440, H = 220;
    const pad = { top: 20, right: 16, bottom: 32, left: 32 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;
    const maxY = Math.max(6, Math.max(...rows.map((r) => r.openSarima)) + 1);
    const barW = plotW / rows.length;

    const xOf = (i) => pad.left + i * barW;
    const yOf = (v) => pad.top + plotH - (v / maxY) * plotH;

    let gridSvg = "";
    for (let v = 0; v <= maxY; v += 2) {
      const y = yOf(v);
      gridSvg += `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W - pad.right}" y2="${y.toFixed(1)}" stroke="#E1EBF5" stroke-width="1" />`;
      gridSvg += `<text x="${pad.left - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="#6E829B">${v}</text>`;
    }

    // Divider between observed (~2026) and forecast (2027~)
    const divIdx = rows.findIndex((r) => r.year === 2027);
    const divX = xOf(divIdx);
    const fcBg = `<rect x="${divX.toFixed(1)}" y="${pad.top}" width="${(W - pad.right - divX).toFixed(1)}" height="${plotH}" fill="#F3ECFF" opacity="0.65" />`;
    const divLine = `<line x1="${divX.toFixed(1)}" y1="${pad.top}" x2="${divX.toFixed(1)}" y2="${H - pad.bottom}" stroke="#7C3AED" stroke-dasharray="3 3" stroke-width="1" />`;
    const fcLabel = `<text x="${(divX + 4).toFixed(1)}" y="${pad.top + 11}" font-size="9.5" font-weight="700" fill="#6D28D9">예측(SARIMA)</text>`;

    let barsSvg = "";
    rows.forEach((r, i) => {
      const h = (r.openSarima / maxY) * plotH;
      const y = pad.top + plotH - h;
      const fill = r.isFuture ? "#7C3AED" : r.openSarima > 0 ? "#0C8F6E" : "#CBD5E1";
      const opacity = r.isFuture ? "0.78" : "0.88";
      barsSvg += `<rect x="${(xOf(i) + 1).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(2, barW - 2).toFixed(1)}" height="${Math.max(1.5, h).toFixed(1)}" rx="1.5" fill="${fill}" opacity="${opacity}"><title>${r.year}년: ${r.openSarima}개월 (${r.isFuture ? "예측" : "실측"})</title></rect>`;
    });

    // 5-year moving average smooth trend line
    const maPoints = rows.map((_, i) => {
      const start = Math.max(0, i - 2);
      const end = Math.min(rows.length - 1, i + 2);
      const slice = rows.slice(start, end + 1).map((r) => r.openSarima);
      return `${(xOf(i) + barW / 2).toFixed(1)},${yOf(avg(slice)).toFixed(1)}`;
    }).join(" ");

    let xTicks = "";
    [1980, 1990, 2000, 2010, 2020, 2026, 2035].forEach((yr) => {
      const idx = rows.findIndex((r) => r.year === yr);
      if (idx < 0) return;
      const x = xOf(idx) + barW / 2;
      xTicks += `<text x="${x.toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="#4B607A">${yr}</text>`;
    });

    trendChartContainer.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="1979년부터 2035년까지 연도별 항해 가능 개월 수 그래프">
        ${fcBg}
        ${gridSvg}
        ${barsSvg}
        <polyline fill="none" stroke="#0B1F3A" stroke-width="2" stroke-linejoin="round" points="${maPoints}" />
        ${divLine}
        ${fcLabel}
        ${xTicks}
        <text x="${pad.left}" y="12" font-size="10" font-weight="700" fill="#4B607A">단위: 개월/년</text>
      </svg>
    `;

    trendChartLegend.innerHTML = `
      <span class="chart-legend-item"><i class="swatch-box" style="background:#0C8F6E"></i>NSIDC 실측 가능 개월</span>
      <span class="chart-legend-item"><i class="swatch-box" style="background:#7C3AED"></i>SARIMA 예측</span>
      <span class="chart-legend-item"><i class="swatch" style="background:#0B1F3A"></i>5년 이동평균 추세</span>
    `;

    const avg80s = avg(rows.filter((r) => r.year >= 1980 && r.year <= 1989).map((r) => r.openSarima));
    const avg20s = avg(rows.filter((r) => r.year >= 2020 && r.year <= 2026).map((r) => r.openSarima));
    const avg30s = avg(rows.filter((r) => r.year >= 2030 && r.year <= 2035).map((r) => r.openSarima));
    trendChartCaption.innerHTML =
      `<strong>${preset.name}(가능 ≤${preset.openMax.toFixed(1)} M km²)</strong> 기준으로 연평균 항해 가능 기간이 ` +
      `1980년대 <strong>${avg80s.toFixed(1)}개월</strong> → 최근(2020~2026) <strong>${avg20s.toFixed(1)}개월</strong> → 2030년대 예측 <strong>${avg30s.toFixed(1)}개월</strong>로 뚜렷하게 늘어납니다.`;
  }

  function renderSeptemberChart(rows, preset) {
    const W = 440, H = 225;
    const pad = { top: 20, right: 16, bottom: 32, left: 34 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;
    const minY = 2.0, maxY = 10.0;

    const xOf = (i) => pad.left + (i / (rows.length - 1)) * plotW;
    const yOf = (v) => pad.top + plotH - ((v - minY) / (maxY - minY)) * plotH;

    let gridSvg = "";
    for (let v = 2; v <= 10; v += 2) {
      const y = yOf(v);
      gridSvg += `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W - pad.right}" y2="${y.toFixed(1)}" stroke="#E1EBF5" stroke-width="1" />`;
      gridSvg += `<text x="${pad.left - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="#6E829B">${v}</text>`;
    }

    // Ship open threshold line
    const threshClamped = Math.min(maxY, Math.max(minY, preset.openMax));
    const ty = yOf(threshClamped);
    const threshLine = `
      <line x1="${pad.left}" y1="${ty.toFixed(1)}" x2="${W - pad.right}" y2="${ty.toFixed(1)}" stroke="#0C8F6E" stroke-dasharray="4 3" stroke-width="1.5" />
      <text x="${pad.left + 4}" y="${(ty - 4).toFixed(1)}" font-size="9.5" font-weight="800" fill="#0C8F6E">${preset.name} 가능 기준 (${preset.openMax.toFixed(1)})</text>
    `;

    const obsRows = rows.filter((r) => !r.isFuture);
    const lastObsIdx = obsRows.length - 1;
    const fcRows = rows.slice(lastObsIdx); // include 2026 anchor

    const obsPts = obsRows.map((r, i) => `${xOf(i).toFixed(1)},${yOf(r.sepObs).toFixed(1)}`).join(" ");
    const sarPts = fcRows.map((r, k) => `${xOf(lastObsIdx + k).toFixed(1)},${yOf(r.sepSarima).toFixed(1)}`).join(" ");
    const basePts = fcRows.map((r, k) => `${xOf(lastObsIdx + k).toFixed(1)},${yOf(r.sepBase).toFixed(1)}`).join(" ");

    // 95% CI polygon for forecast years (2027..2035)
    const ciStartIdx = lastObsIdx + 1;
    const ciUpper = rows.slice(ciStartIdx).map((r, k) => `${xOf(ciStartIdx + k).toFixed(1)},${yOf(r.sepHi).toFixed(1)}`);
    const ciLower = rows.slice(ciStartIdx).map((r, k) => `${xOf(ciStartIdx + k).toFixed(1)},${yOf(r.sepLo).toFixed(1)}`).reverse();
    const anchorPt = `${xOf(lastObsIdx).toFixed(1)},${yOf(rows[lastObsIdx].sepObs).toFixed(1)}`;
    const ciPoly = [anchorPt, ...ciUpper, ...ciLower].join(" ");

    // 2012 minimum highlight
    const idx2012 = rows.findIndex((r) => r.year === 2012);
    const x12 = xOf(idx2012), y12 = yOf(rows[idx2012].sepObs);
    const minCallout = `
      <circle cx="${x12.toFixed(1)}" cy="${y12.toFixed(1)}" r="4" fill="#C82838" stroke="#FFFFFF" stroke-width="1.5" />
      <text x="${(x12 - 4).toFixed(1)}" y="${(y12 + 14).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#C82838">2012 최소(3.57)</text>
    `;

    let xTicks = "";
    [1980, 1990, 2000, 2010, 2020, 2026, 2035].forEach((yr) => {
      const idx = rows.findIndex((r) => r.year === yr);
      if (idx < 0) return;
      xTicks += `<text x="${xOf(idx).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="#4B607A">${yr}</text>`;
    });

    trendChartContainer.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="1979년부터 2035년까지 9월 최소 해빙 면적 추세 및 예측 그래프">
        ${gridSvg}
        ${threshLine}
        <polygon points="${ciPoly}" fill="#7C3AED" opacity="0.18" />
        <polyline fill="none" stroke="#1D4678" stroke-width="2.2" stroke-linejoin="round" points="${obsPts}" />
        <polyline fill="none" stroke="#D97706" stroke-width="1.8" stroke-dasharray="4 3" points="${basePts}" />
        <polyline fill="none" stroke="#7C3AED" stroke-width="2.4" points="${sarPts}" />
        ${minCallout}
        ${xTicks}
        <text x="${pad.left}" y="12" font-size="10" font-weight="700" fill="#4B607A">단위: million km² (9월)</text>
      </svg>
    `;

    trendChartLegend.innerHTML = `
      <span class="chart-legend-item"><i class="swatch" style="background:#1D4678"></i>NSIDC 실측</span>
      <span class="chart-legend-item"><i class="swatch" style="background:#7C3AED"></i>SARIMA (95% 구간)</span>
      <span class="chart-legend-item"><i class="swatch" style="background:#D97706"></i>기준선</span>
    `;

    trendChartCaption.innerHTML =
      `9월 북극 해빙 면적은 <strong>1979년 7.05 M km² → 2012년 역대 최소 3.57 M km² → 2024년 4.35 M km²</strong>로 장기 감소 추세를 보입니다. ` +
      `보라색 영역(95% 신뢰구간)이 미래로 갈수록 넓어지는 점은 장기 예측의 불확실성 증가를 보여줍니다.`;
  }

  function renderTrendScreen() {
    const preset = SHIP_PRESETS[trendState.ship] || SHIP_PRESETS.iceclass;
    const rows = computeYearlySeries(trendState.ship);

    const avg80s = avg(rows.filter((r) => r.year >= 1980 && r.year <= 1989).map((r) => r.openSarima));
    const avg20s = avg(rows.filter((r) => r.year >= 2020 && r.year <= 2026).map((r) => r.openSarima));
    const avg30s = avg(rows.filter((r) => r.year >= 2030 && r.year <= 2035).map((r) => r.openSarima));
    const diffNow = avg20s - avg80s;

    trendStatRow.innerHTML = `
      <div class="trend-stat-box">
        <span class="trend-stat-label">1980년대 평균</span>
        <strong class="trend-stat-val">${avg80s.toFixed(1)}개월</strong>
        <span class="trend-stat-sub">과거 실측</span>
      </div>
      <div class="trend-stat-box">
        <span class="trend-stat-label">2020~26년 평균</span>
        <strong class="trend-stat-val">${avg20s.toFixed(1)}개월</strong>
        <span class="trend-stat-sub">+${diffNow.toFixed(1)}개월 증가</span>
      </div>
      <div class="trend-stat-box">
        <span class="trend-stat-label">2030~35년 예측</span>
        <strong class="trend-stat-val">${avg30s.toFixed(1)}개월</strong>
        <span class="trend-stat-sub">SARIMA 기준</span>
      </div>
    `;

    chartTabBtns.forEach((btn) => {
      const isActive = btn.dataset.chart === trendState.chartType;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    trendShipBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.trendShip === trendState.ship);
    });

    if (trendState.chartType === "months") {
      renderMonthsChart(rows, preset);
    } else {
      renderSeptemberChart(rows, preset);
    }
  }

  function populateTrendStaticSections() {
    const m = DATA.meta;
    const b = m.models.baseline;
    const s = m.models.sarima;

    trendModelTableWrap.innerHTML = `
      <table class="modal-table">
        <thead>
          <tr><th>예측 모델</th><th>MAE</th><th>RMSE</th><th>특징</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>기준선<br/><small>월별평균+추세</small></td>
            <td>${b.mae.toFixed(3)}</td>
            <td>${b.rmse.toFixed(3)}</td>
            <td>연 ${b.annualSlope.toFixed(3)} 선형감소</td>
          </tr>
          <tr>
            <td><strong>SARIMA</strong><br/><small>(1,0,0)(0,1,1)12</small></td>
            <td><strong>${s.mae.toFixed(3)}</strong></td>
            <td><strong>${s.rmse.toFixed(3)}</strong></td>
            <td>계절차분 + 95% 신뢰구간</td>
          </tr>
        </tbody>
      </table>
      <p class="model-note">
        * 홀드아웃 검증 구간: <strong>${b.valPeriod}</strong> (1979~2020년 학습 → 최근 5년 60개월 예측 평가).
        SARIMA가 두 오차 지표(MAE, RMSE) 모두 기준선보다 낮은 오차를 기록했습니다.
      </p>
    `;

    trendLimitBody.innerHTML = `
      <ul class="limit-list">
        <li><strong>데이터 출처</strong>: ${m.source} (실측 ${m.observedStart} ~ ${m.observedEnd}, 총 ${m.observedMonths}개월).</li>
        <li><strong>결측 보간</strong>: 위성 센서 교체 결측(${m.interpolatedMonths.join(", ")}) 2개월은 인접 연도 동월 평균으로 보간해 시계열 연속성을 확보했습니다.</li>
        <li><strong>교육용 한계</strong>: 본 시뮬레이터는 북극 전체 월별 해빙 면적(Extent)만을 단순화한 학습 도구입니다. 실제 북극항로 운항은 해빙 두께·밀집도, 구간별 빙황(NSR/NWP), 기상, 국제 극지코드(Polar Code) 규정이 필수이므로 <strong>실제 운항 판단에 사용할 수 없습니다.</strong></li>
      </ul>
    `;
  }

  chartTabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      trendState.chartType = btn.dataset.chart;
      renderTrendScreen();
    });
  });

  trendShipBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      trendState.ship = btn.dataset.trendShip;
      renderTrendScreen();
    });
  });

  toggleModelAccBtn.addEventListener("click", () => {
    const isOpen = !modelAccBody.classList.toggle("hidden");
    toggleModelAccBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    modelAccArrow.textContent = isOpen ? "▴" : "▾";
  });

  toggleLimitAccBtn.addEventListener("click", () => {
    const isOpen = !limitAccBody.classList.toggle("hidden");
    toggleLimitAccBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    limitAccArrow.textContent = isOpen ? "▴" : "▾";
  });

  // =========================================================
  // AUTO STUDY NOTE AGENT (오답 항해 노트 자동 작성기: 목표->계획->실행->확인)
  // =========================================================
  const openStudyNoteBtn = document.getElementById("openStudyNoteBtn");
  const studyNoteCountBadge = document.getElementById("studyNoteCountBadge");
  const studyNoteModal = document.getElementById("studyNoteModal");
  const closeStudyNoteBtn = document.getElementById("closeStudyNoteBtn");
  const agentSteps = document.querySelectorAll(".agent-step[data-agent-step]");
  const notePlanTitle = document.getElementById("notePlanTitle");
  const noteSelectedCount = document.getElementById("noteSelectedCount");
  const noteChecklist = document.getElementById("noteChecklist");
  const notePreviewText = document.getElementById("notePreviewText");
  const noteConfirmStatus = document.getElementById("noteConfirmStatus");
  const copyNoteBtn = document.getElementById("copyNoteBtn");
  const downloadNoteBtn = document.getElementById("downloadNoteBtn");
  const printNoteBtn = document.getElementById("printNoteBtn");
  const openDeleteConfirmBtn = document.getElementById("openDeleteConfirmBtn");

  const deleteConfirmModal = document.getElementById("deleteConfirmModal");
  const deleteConfirmDesc = document.getElementById("deleteConfirmDesc");
  const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
  const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");

  const noteState = {
    selectedIds: new Set()
  };

  function setAgentStage(stageNum) {
    agentSteps.forEach((el) => {
      const s = parseInt(el.dataset.agentStep, 10);
      el.classList.toggle("done", s < stageNum || stageNum === 4);
      el.classList.toggle("active", s === stageNum && stageNum !== 4);
    });
  }

  function updateStudyNoteEntryButton() {
    const wrongCount = quizRecord.wrongIds.length;
    if (wrongCount > 0) {
      openStudyNoteBtn.firstElementChild.textContent = "📝 오답 항해 노트 자동 만들기";
      studyNoteCountBadge.textContent = `오답 ${wrongCount}문제`;
    } else {
      openStudyNoteBtn.firstElementChild.textContent = "📝 핵심 복습 노트 자동 만들기";
      studyNoteCountBadge.textContent = `전체 ${QUIZ_BANK.length}문제`;
    }
  }

  function getNoteCandidateQuestions() {
    if (quizRecord.wrongIds.length > 0) {
      return {
        isWrongOnly: true,
        items: QUIZ_BANK.filter((q) => quizRecord.wrongIds.includes(q.id))
      };
    }
    return {
      isWrongOnly: false,
      items: QUIZ_BANK.slice()
    };
  }

  function buildStudyNoteString() {
    const { isWrongOnly, items } = getNoteCandidateQuestions();
    const chosen = items.filter((q) => noteState.selectedIds.has(q.id));
    if (!chosen.length) {
      return "포함할 문항을 1개 이상 선택해 주세요.";
    }
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const header = [
      `[Arctic Captain : 북극항로 선장 시뮬레이터]`,
      `${isWrongOnly ? "오답 항해 복습 노트" : "전체 핵심 항해 복습 노트"} (생성일: ${dateStr}, 총 ${chosen.length}문제)`,
      `서비스 주소: https://tripleseoi3-ai.github.io/arctic-captain/`,
      `==================================================`
    ];

    const blocks = chosen.map((q, idx) => {
      const wrongIdx = quizRecord.wrongChoices[q.id];
      const hasWrong = typeof wrongIdx === "number" && wrongIdx !== q.answerIndex && q.choices[wrongIdx];
      const lines = [
        `${idx + 1}. [${q.tag}]`,
        `- 조건: ${q.badges.join(" / ")}`,
        `- 문제: ${q.question}`
      ];
      if (hasWrong) {
        lines.push(`- 내가 고른 오답: (${CHOICE_LETTERS[wrongIdx]}) ${q.choices[wrongIdx]}`);
      }
      lines.push(`- 정답: (${CHOICE_LETTERS[q.answerIndex]}) ${q.choices[q.answerIndex]}`);
      lines.push(`- 근거 데이터(NSIDC/예측): ${q.hintRows.map((r) => `${r.label} ${r.value}`).join(" | ")}`);
      lines.push(`- 해설: ${q.explanation}`);
      lines.push(`- 핵심 정리: ${q.takeaway}`);
      return lines.join("\n");
    });

    return `${header.join("\n")}\n\n${blocks.join("\n\n")}\n\n※ 본 노트는 NSIDC v4.0 기반 교육용 시뮬레이터 학습 기록이며 실제 운항 판단용이 아닙니다.`;
  }

  function renderStudyNoteModal() {
    const { isWrongOnly, items } = getNoteCandidateQuestions();
    notePlanTitle.textContent = isWrongOnly
      ? "저장된 오답 문항 선택 (계획)"
      : "오답이 없어 전체 핵심 문항으로 정리합니다 (계획)";

    noteChecklist.innerHTML = "";
    items.forEach((q) => {
      const label = document.createElement("label");
      label.className = "note-check-item";
      const checked = noteState.selectedIds.has(q.id);
      label.innerHTML = `
        <input type="checkbox" value="${q.id}" ${checked ? "checked" : ""} />
        <span>${q.tag}</span>
        <span class="note-check-tag ${isWrongOnly ? "wrong" : "review"}">${isWrongOnly ? "오답" : "핵심"}</span>
      `;
      const cb = label.querySelector("input");
      cb.addEventListener("change", () => {
        if (cb.checked) noteState.selectedIds.add(q.id);
        else noteState.selectedIds.delete(q.id);
        updateNotePreviewOnly();
      });
      noteChecklist.appendChild(label);
    });

    openDeleteConfirmBtn.disabled = quizRecord.wrongIds.length === 0;
    openDeleteConfirmBtn.textContent = quizRecord.wrongIds.length > 0
      ? `🗑️ 저장된 오답 기록 비우기 (${quizRecord.wrongIds.length}문제)`
      : "🗑️ 저장된 오답 기록 없음";

    updateNotePreviewOnly();
  }

  function updateNotePreviewOnly() {
    const count = noteState.selectedIds.size;
    noteSelectedCount.textContent = `${count}문제 선택`;
    notePreviewText.textContent = buildStudyNoteString();
    const disabled = count === 0;
    copyNoteBtn.disabled = disabled;
    downloadNoteBtn.disabled = disabled;
    printNoteBtn.disabled = disabled;
  }

  function showNoteConfirmation(msg) {
    const now = new Date();
    const t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    setAgentStage(4);
    noteConfirmStatus.textContent = `✓ ${msg} (${t})`;
    noteConfirmStatus.classList.remove("hidden");
  }

  function openStudyNoteModal() {
    const { items } = getNoteCandidateQuestions();
    noteState.selectedIds = new Set(items.map((q) => q.id));
    noteConfirmStatus.classList.add("hidden");
    setAgentStage(2);
    renderStudyNoteModal();
    studyNoteModal.classList.remove("hidden");
  }

  openStudyNoteBtn.addEventListener("click", openStudyNoteModal);
  closeStudyNoteBtn.addEventListener("click", () => studyNoteModal.classList.add("hidden"));
  studyNoteModal.addEventListener("click", (e) => {
    if (e.target === studyNoteModal) studyNoteModal.classList.add("hidden");
  });

  copyNoteBtn.addEventListener("click", async () => {
    setAgentStage(3);
    const text = buildStudyNoteString();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      showNoteConfirmation(`${noteState.selectedIds.size}문제 오답 노트가 클립보드에 복사되었습니다.`);
    } catch (_) {
      showNoteConfirmation("복사 권한이 제한되어 미리보기 영역에서 직접 복사해 주세요.");
    }
  });

  downloadNoteBtn.addEventListener("click", () => {
    setAgentStage(3);
    const text = buildStudyNoteString();
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const filename = `Arctic_Captain_오답항해노트_${ymd}.txt`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showNoteConfirmation(`${filename} 파일 저장이 완료되었습니다.`);
  });

  printNoteBtn.addEventListener("click", () => {
    setAgentStage(3);
    const text = buildStudyNoteString();
    const w = window.open("", "_blank", "width=760,height=860");
    if (w) {
      const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>Arctic Captain 오답 항해 노트</title><style>body{font-family:"Malgun Gothic",sans-serif;padding:24px;line-height:1.65;font-size:13px;color:#111}pre{white-space:pre-wrap;font-family:inherit}</style></head><body><pre>${escaped}</pre></body></html>`);
      w.document.close();
      w.focus();
      w.print();
      showNoteConfirmation("인쇄/PDF 저장 창을 열었습니다.");
    } else {
      showNoteConfirmation("팝업이 차단되었습니다. 파일(.txt) 저장 또는 전체 복사를 이용해 주세요.");
    }
  });

  // Irreversible Action: Require Explicit Confirmation Dialog Before Deletion
  openDeleteConfirmBtn.addEventListener("click", () => {
    if (quizRecord.wrongIds.length === 0) return;
    setAgentStage(3);
    deleteConfirmDesc.textContent = `현재 브라우저에 저장된 오답 ${quizRecord.wrongIds.length}문제의 기록이 모두 삭제됩니다.`;
    deleteConfirmModal.classList.remove("hidden");
  });

  cancelDeleteBtn.addEventListener("click", () => {
    deleteConfirmModal.classList.add("hidden");
    setAgentStage(2);
  });

  deleteConfirmModal.addEventListener("click", (e) => {
    if (e.target === deleteConfirmModal) {
      deleteConfirmModal.classList.add("hidden");
      setAgentStage(2);
    }
  });

  confirmDeleteBtn.addEventListener("click", () => {
    const deletedCount = quizRecord.wrongIds.length;
    quizRecord.wrongIds = [];
    quizRecord.wrongChoices = {};
    saveQuizRecord(quizRecord);
    deleteConfirmModal.classList.add("hidden");
    renderQuizBanner();
    updateStudyNoteEntryButton();
    const { items } = getNoteCandidateQuestions();
    noteState.selectedIds = new Set(items.map((q) => q.id));
    renderStudyNoteModal();
    showNoteConfirmation(`저장된 오답 ${deletedCount}문제 기록을 안전하게 삭제했습니다.`);
  });

  populateMetaViews();
  populateTrendStaticSections();
  updateStudyNoteEntryButton();
  render();
  renderQuiz();
  renderTrendScreen();
})();
