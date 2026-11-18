/**
 * Pilot experiment logic (within-subjects).
 * Flow: welcome -> consent -> practice -> bridge -> 16 trials -> debrief -> CSV.
 *
 * Recommendatory: single step (AI prediction + optional Grad-CAM, then ABCD + diagnosis + confidence).
 * Evaluative: two phases (own ABCD/diagnosis first, then AI advice, then final judgment).
 *
 * Block order comes from the HTML entry page. Optional demo mode via STUDY_CONFIG.demoCondition.
 */
(function () {
  "use strict";

  // ---- Fixed design numbers and page config --------------------------------
  const TOTAL_TRIALS = 16; // logged trials only (practice excluded)
  const params = new URLSearchParams(window.location.search);
  const config = window.STUDY_CONFIG || {}; // set by each HTML entry page
  const submitCfg = window.SUBMIT_CONFIG || {}; // optional auto-email settings

  // Prefer ?order=… override; else STUDY_CONFIG.firstCondition from the HTML file
  const firstCondition =
    params.get("order") === "evaluative" || params.get("order") === "recommendatory"
      ? params.get("order")
      : config.firstCondition || "recommendatory";

  // ---- Session state (mutated as the participant moves through screens) ----
  const state = {
    screen: "welcome", // which screen is currently shown
    participantId: "", // unique session id for CSV rows
    blockOrder: [], // e.g. ["recommendatory","evaluative"]
    trials: [], // practice (optional) + 16 scheduled trials
    trialIndex: 0, // index into state.trials
    phase: 1, // 1 = unaided judgment, 2 = AI-assisted
    explanationOpened: false, // Morrison-style gate: must open before final answers
    showCamView: true, // recommendatory: Grad-CAM vs original image
    abcdDetailOpen: false, // evaluative: optional ABCD checklist open/closed
    phase1StartedAt: null, // performance.now() markers for timing columns
    phase2StartedAt: null,
    draft: {
      // answers for the current trial (not yet committed to logs)
      abcd: { A: null, B: null, C: null, D: null },
      initial_judgment: null,
      confidence_initial: null,
      final_judgment: null,
      confidence_final: null
    },
    logs: [], // committed trial rows for CSV
    submitStatus: null, // result of optional auto-email attempt
    feedback: {
      clarity: null,
      length: null,
      confusing: "",
      missing: "",
      other: ""
    }
  };

  // DOM anchors from the HTML shell
  const app = document.getElementById("app");
  const progressFill = document.getElementById("progressFill");
  const progressLabel = document.getElementById("progressLabel");

  // ---- Small helpers -------------------------------------------------------

  /** Fisher-Yates shuffle (copy; does not mutate the input array). */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * Build a unique session id. Researcher can renumber later (p01, p02, …).
   * Override with ?pid=any_label if needed for a specific machine/lab desk.
   */
  function assignParticipantId() {
    const override = (params.get("pid") || "").trim();
    if (override) return override;
    const rand = Math.random().toString(36).slice(2, 6);
    return "p_" + Date.now().toString(36) + rand;
  }

  /**
   * Build the 16-trial schedule: block 1 = first UI (shuffled cases),
   * block 2 = other UI (cases reshuffled). Stores blockOrder on state.
   */
  function buildSchedule(first) {
    const second = first === "recommendatory" ? "evaluative" : "recommendatory";
    state.blockOrder = [first, second];
    const casesA = shuffle(window.STUDY_CASES);
    const casesB = shuffle(window.STUDY_CASES);
    const block1 = casesA.map((c, i) => ({
      ...c,
      condition: first,
      trial_index: i + 1,
      block: 1
    }));
    const block2 = casesB.map((c, i) => ({
      ...c,
      condition: second,
      trial_index: i + 9,
      block: 2
    }));
    return block1.concat(block2);
  }

  /** Update the top progress bar / label for the current screen or trial. */
  function setProgress() {
    if (state.screen !== "trial") {
      progressFill.style.width = "0%";
      progressLabel.textContent =
        state.screen === "done" || state.screen === "debrief" || state.screen === "feedback"
          ? "Complete"
          : "Setup";
      return;
    }
    const trial = currentTrial();
    if (trial && (trial._practice || trial._demo)) {
      progressFill.style.width = "0%";
      progressLabel.textContent = trial._demo ? "Demo" : "Practice";
      return;
    }
    const n = trial && trial.trial_index ? trial.trial_index : state.logs.length + 1;
    progressFill.style.width = `${(n / TOTAL_TRIALS) * 100}%`;
    progressLabel.textContent = `Trial ${n} of ${TOTAL_TRIALS}`;
  }

  /** Current trial object from the schedule (may be practice). */
  function currentTrial() {
    return state.trials[state.trialIndex];
  }

  /** Clear draft answers and timers when starting a new trial. */
  function resetDraft() {
    state.draft = {
      abcd: { A: null, B: null, C: null, D: null }, // participant Phase-1 ABCD ratings
      initial_judgment: null,
      confidence_initial: null,
      final_judgment: null,
      confidence_final: null
    };
    state.explanationOpened = false;
    state.showCamView = true;
    state.abcdDetailOpen = false;
    state.phase = 1;
    state.phase1StartedAt = performance.now();
    state.phase2StartedAt = null;
  }

  /** True when all four Phase-1 ABCD features have been answered. */
  function abcdComplete() {
    const a = state.draft.abcd || {};
    return !!(a.A && a.B && a.C && a.D);
  }

  /** Display label for diagnosis codes used in the UI. */
  function labelPretty(x) {
    return x === "malignant" ? "Malignant" : "Benign";
  }

  /** Short patient context block (HAM10000-style age/sex/site + brief note). */
  function vignetteHtml(trial) {
    const v = trial.vignette;
    if (!v) return "";
    const sexLabel = v.sex === "female" ? "Female" : v.sex === "male" ? "Male" : v.sex;
    return `
      <div class="vignette-box">
        <div class="vignette-title">Patient context</div>
        <p class="muted" style="margin:0">
          ${v.age}-year-old ${sexLabel.toLowerCase()}. Location: ${v.localization}.
          ${v.note || ""}
        </p>
      </div>
    `;
  }

  /** Format a 0–1 probability as a percent string. */
  function pct(p) {
    return Math.round(p * 100) + "%";
  }

  /**
   * ABCD feature metadata:
   * - options: used in Phase 1 for the participant's own ratings
   * - mal/ben: which answer values lean malignant vs benign (for AI labels)
   */
  const ABCD_META = {
    A: {
      letter: "A",
      name: "Asymmetry",
      question: "How would you describe the shape?",
      options: [
        { value: "symmetric", label: "Symmetric" },
        { value: "asymmetric", label: "Asymmetric" }
      ],
      mal: new Set(["asymmetric"]),
      ben: new Set(["symmetric"])
    },
    B: {
      letter: "B",
      name: "Border",
      question: "How would you describe the border?",
      options: [
        { value: "regular", label: "Regular border" },
        { value: "irregular", label: "Irregular border" }
      ],
      mal: new Set(["irregular"]),
      ben: new Set(["regular"])
    },
    C: {
      letter: "C",
      name: "Colour",
      question: "How would you describe the colour?",
      options: [
        { value: "uniform colour", label: "Uniform colour" },
        { value: "multiple colours", label: "Multiple colours" }
      ],
      mal: new Set(["multiple colours"]),
      ben: new Set(["uniform colour"])
    },
    D: {
      letter: "D",
      name: "Diameter",
      question: "How would you describe the size?",
      options: [
        { value: "small", label: "Small" },
        { value: "enlarged", label: "Enlarged" }
      ],
      mal: new Set(["enlarged"]),
      ben: new Set(["small"])
    }
  };

  /** Map one ABCD answer string to malignant / benign / ambiguous. */
  function featureLean(key, value) {
    const meta = ABCD_META[key];
    if (meta.mal.has(value)) return "malignant";
    if (meta.ben.has(value)) return "benign";
    return "ambiguous";
  }

  /** Human-readable AI assessment line for one ABCD item. */
  function answerLabel(key, value) {
    const lean = featureLean(key, value);
    if (lean === "malignant") return value + " (leans malignant)";
    if (lean === "benign") return value + " (leans benign)";
    return value + " (unclear)";
  }

  /**
   * Build evaluative advice by comparing the AI's ABCD (abcd_shown) to the
   * participant's Phase-1 ABCD. Agreement = supports you; disagreement = challenges you.
   * Does NOT use abcd_true (that would leak cell type).
   */
  function evaluativeAdvice(trial, participantAbcd) {
    const supportsYou = [];
    const challengesYou = [];
    const unclear = [];
    ["A", "B", "C", "D"].forEach((key) => {
      const shown = trial.abcd_shown[key];
      const yours = participantAbcd && participantAbcd[key];
      const lean = featureLean(key, shown);
      if (lean === "ambiguous" || shown === "unclear" || shown === "mixed signals") {
        unclear.push(
          `${ABCD_META[key].name}: AI said “${shown}”` +
            (yours ? ` (you said “${yours}”)` : "")
        );
        return;
      }
      if (yours && shown === yours) {
        supportsYou.push(
          `${ABCD_META[key].name}: you and the AI both said “${shown}”.`
        );
      } else if (yours) {
        challengesYou.push(
          `${ABCD_META[key].name}: you said “${yours}”; the AI said “${shown}”.`
        );
      } else {
        challengesYou.push(`${ABCD_META[key].name}: AI said “${shown}”.`);
      }
    });
    return { supportsYou, challengesYou, unclear };
  }

  /**
   * Render the lesion image column.
   * showCam: show Grad-CAM composite (or CSS fallback) instead of the base photo.
   * opts.allowSwap: show Original / Grad-CAM toggle (recommendatory, after gate opens).
   */
  function imageHtml(trial, showCam, opts) {
    opts = opts || {};
    const useCamFile = showCam && trial.cam_image;
    const src = useCamFile ? trial.cam_image : trial.image;
    // Temporary CSS blob if a -cam.png file is missing
    const cssFallback =
      showCam && !trial.cam_image ? `cam-overlay ${trial.cam_quality}` : "";
    const onCamError = useCamFile
      ? `this.onerror=null; this.src='${trial.image}'; const blob=this.parentElement.querySelector('[data-cam-fallback]'); if(blob) blob.classList.remove('hidden');`
      : `this.classList.add('hidden'); this.nextElementSibling.classList.remove('hidden');`;
    const swap =
      opts.allowSwap
        ? `
      <div class="image-swap" role="group" aria-label="Image view">
        <button type="button" class="swap-btn ${!showCam ? "selected" : ""}" data-view="original">Original</button>
        <button type="button" class="swap-btn ${showCam ? "selected" : ""}" data-view="cam">Grad-CAM</button>
      </div>
      <p class="image-swap-hint muted">Switch as often as you like to compare where the model focuses.</p>
    `
        : "";
    return `
      <div class="media-image-col">
        <div class="image-frame">
          <img
            src="${src}"
            alt="Dermoscopic image ${trial.case_id}${useCamFile ? " with Grad-CAM" : ""}"
            onerror="${onCamError}"
          />
          <div class="image-fallback hidden">
            <strong>${trial.image_label}</strong>
            Placeholder: put your image at<br /><code>${trial.image}</code>
          </div>
          <div class="cam-overlay ${trial.cam_quality} hidden" data-cam-fallback aria-hidden="true"></div>
          ${cssFallback ? `<div class="${cssFallback}" aria-hidden="true"></div>` : ""}
        </div>
        ${swap}
        ${vignetteHtml(trial)}
      </div>
    `;
  }

  /** Malignant / benign choice buttons for Phase 1 or Phase 2. */
  function judgmentButtons(selected, which) {
    return `
      <div class="choice-grid" data-group="${which}">
        <button type="button" class="choice ${selected === "malignant" ? "selected" : ""}" data-value="malignant">
          <strong>Malignant</strong>
          <span>Suspicious / melanoma-like</span>
        </button>
        <button type="button" class="choice ${selected === "benign" ? "selected" : ""}" data-value="benign">
          <strong>Benign</strong>
          <span>Likely non-malignant</span>
        </button>
      </div>
    `;
  }

  /** 1–7 confidence scale buttons. */
  function confidenceButtons(selected) {
    const btns = [1, 2, 3, 4, 5, 6, 7]
      .map(
        (n) =>
          `<button type="button" data-conf="${n}" class="${selected === n ? "selected" : ""}">${n}</button>`
      )
      .join("");
    return `
      <div class="confidence" data-conf-group="yes">${btns}</div>
      <div class="confidence-scale"><span>Not at all</span><span>Extremely</span></div>
    `;
  }

  /**
   * Phase-1 ABCD self-rating UI: four rows, two options each
   * (symmetric/asymmetric, regular/irregular, …).
   */
  function abcdSelfRatingHtml() {
    const draft = state.draft.abcd || {};
    return ["A", "B", "C", "D"]
      .map((key) => {
        const meta = ABCD_META[key];
        const selected = draft[key];
        const opts = meta.options
          .map(
            (o) => `
            <button type="button" class="abcd-opt ${selected === o.value ? "selected" : ""}"
              data-abcd-key="${key}" data-abcd-value="${o.value}">${o.label}</button>`
          )
          .join("");
        return `
          <div class="abcd-pick">
            <div class="abcd-pick-label">
              <span class="abcd-letter">${key}</span>
              <span><strong>${meta.name}</strong> · ${meta.question}</span>
            </div>
            <div class="abcd-pick-options">${opts}</div>
          </div>
        `;
      })
      .join("");
  }

  // ---- Screens: setup ------------------------------------------------------

  /** First screen: study overview in continuous prose (no spoilers, no bold). */
  function renderWelcome() {
    state.screen = "welcome";
    setProgress();
    const second =
      firstCondition === "recommendatory" ? "evaluative" : "recommendatory";
    app.innerHTML = `
      <div class="prose-narrow">
        <h1>Welcome</h1>
        <h2>About this pilot</h2>
        <p>
          This session is a pilot. It is meant to test how the interfaces look and feel, whether
          the instructions are clear, and how long the session takes. The images serve as placeholders
          and are subject to change. This is not the final
          experiment, and your answers will mainly help improve the design before the main study.
        </p>
        <h2>What the study is about</h2>
        <p>
          Thanks for taking part in this pilot study. I am interested in how people use
          different kinds of AI support when judging dermoscopic images of skin lesions.
          You will try two interfaces on the same set of images so I can check whether the
          instructions are clear and how long the session takes.
        </p>
        <p>
          The recommendatory interface shows an AI prediction (with a probability) right away,
          together with a visual heatmap you can compare with the original image. You then rate
          ABCD features (asymmetry, border, colour, size), choose malignant or benign, and give
          a confidence rating from 1 to 7.
        </p>
        <p>
          The evaluative interface works in two steps. First you rate ABCD features and give your
          own diagnosis and confidence from the image alone. Then you open an AI explanation that
          summarises which features support or challenge your earlier assessment, with a heatmap
          available as well, and you give a final diagnosis and confidence. You must open that
          explanation before you can submit.
        </p>
        <p>
          For this link the order is fixed: you start with the ${firstCondition} interface and
          then switch to the ${second} interface (eight images in each half, sixteen trials in
          total, plus one short practice trial that is not saved). The images are a simulation for
          research only. Nothing here is clinical advice. At the end your responses can be mailed
          to the researcher or downloaded as a CSV file on this device. Your session id will be
          shown on the next screen.
        </p>
        <div class="btn-row">
          <button class="btn btn-primary" id="btnStart">Continue</button>
        </div>
      </div>
    `;
    document.getElementById("btnStart").onclick = renderConsent;
  }

  /** Consent as readable narrative + assigned session id (no bold). */
  function renderConsent() {
    state.screen = "consent";
    setProgress();
    state.participantId = assignParticipantId();
    app.innerHTML = `
      <div class="prose-narrow">
        <h1>Informed consent</h1>
        <p>
          You are invited to take part in a short research pilot about how people use AI support
          when judging images of skin lesions. Taking part is completely voluntary and you may stop
          at any time without giving a reason and without any negative consequences. If you stop
          early, only the answers you already completed may be kept, and only if you choose to
          save or send them at the end.
        </p>
        <p>
          During the session you will look at dermoscopic images, rate visual features, give
          diagnoses and confidence ratings, and review AI information. There are no right or wrong
          answers for you personally. I care about how the interfaces work for people.
          The images and AI outputs are part of a simulated study setting. They are not used to
          diagnose real patients, and you should not treat anything you see here as medical advice
          for yourself or others.
        </p>
        <p>
          Your answers stay on this device until you download a CSV file at the end of the session,
          and until an automatic copy is sent to the researcher if that option is set up. We do not
          ask for your name. A unique session id is created automatically so your file can be matched
          in the dataset. That id for this session is ${state.participantId}.
          By clicking the “I agree” button you confirm that you have read this information, that you are
          willing to take part, and that you understand you can stop whenever you want.
        </p>
        <div class="btn-row">
          <button class="btn btn-secondary" id="btnBack">Back</button>
          <button class="btn btn-primary" id="btnConsent">I agree</button>
        </div>
      </div>
    `;
    document.getElementById("btnBack").onclick = renderWelcome;
    document.getElementById("btnConsent").onclick = () => {
      state.trials = buildSchedule(firstCondition);
      state.trialIndex = 0;
      state.logs = [];
      renderPractice();
    };
  }

  /**
   * Practice intro in clear steps (no bold). Practice uses evaluative UI so
   * participants see the two-step feature comparison once before scored trials.
   */
  function renderPractice() {
    state.screen = "practice";
    setProgress();
    app.innerHTML = `
      <div class="prose-narrow">
        <h1>Practice trial</h1>
        <p>
          Before the real trials, you will complete one practice trial to familiarise yourself
          with the steps. This practice will not be saved in your results file. It uses the
          evaluative style of AI advice so you can see how the feature comparison works.
        </p>
        <p>
          Step 1. You will see a dermoscopic image with no AI information yet. First rate four
          visual features using the ABCD checklist: asymmetry (symmetric or asymmetric), border
          (regular or irregular), colour (uniform or multiple colours), and size (small or
          enlarged). Then give a diagnosis: malignant or benign, and rate your confidence from 1
          (not at all) to 7 (extremely). When those answers are complete, continue to AI support.
        </p>
        <p>
          Step 2. You will see a short AI summary. You must click “Show AI explanation” before you
          can give a final answer. The explanation compares the AI’s ABCD readings with the ones
          you just gave, and shows what supports or challenges your first assessment. Read the
          panel, then choose your final diagnosis and confidence, and submit the trial.
        </p>
        <p>
          In the real session you will also use the recommendatory interface. There the AI
          prediction is shown straight away with a heatmap you can swap with the original image,
          and you then fill in ABCD, diagnosis, and confidence in one step.
        </p>
        <div class="btn-row">
          <button class="btn btn-primary" id="btnPracticeGo">Start practice</button>
        </div>
      </div>
    `;
    document.getElementById("btnPracticeGo").onclick = () => {
      state.trials = [
        {
          ...window.STUDY_CASES[0],
          condition: "evaluative",
          trial_index: 0,
          block: 0,
          _practice: true
        }
      ].concat(state.trials);
      state.trialIndex = 0;
      resetDraft();
      renderTrial();
    };
  }

  /** Short bridge after practice, before the scored trials begin. */
  function renderRealStart() {
    state.screen = "real-start";
    setProgress();
    app.innerHTML = `
      <div class="prose-narrow">
        <h1>The main part starts now</h1>
        <p>
          You have finished the practice trial. The next screens are the real trials. Your
          answers will be saved. Take the same care as in practice: look at each image, use the
          AI support for that interface, and submit when you are ready.
        </p>
        <div class="btn-row">
          <button class="btn btn-primary" id="btnRealStart">Start main trials</button>
        </div>
      </div>
    `;
    document.getElementById("btnRealStart").onclick = () => {
      resetDraft();
      renderTrial();
    };
  }

  // ---- Trial loop ----------------------------------------------------------

  /** Route to the right trial UI, or finish if the schedule is done. */
  function renderTrial() {
    state.screen = "trial";
    const trial = currentTrial();
    if (!trial) {
      renderDebrief();
      return;
    }
    setProgress();
    if (trial.condition === "recommendatory") {
      renderRecommendatoryTrial(trial);
      return;
    }
    // Evaluative: two phases
    if (state.phase === 1) renderEvalPhase1(trial);
    else renderEvalPhase2(trial);
  }

  /**
   * Recommendatory: single screen. AI prediction (+ Grad-CAM swap) first,
   * then participant ABCD + diagnosis + confidence.
   */
  function renderRecommendatoryTrial(trial) {
    if (!state.phase2StartedAt) state.phase2StartedAt = performance.now();
    const showCam = state.showCamView;
    const trialLabel = trial._demo
      ? "Interview demo"
      : trial._practice
        ? "Practice"
        : `Trial ${trial.trial_index} of ${TOTAL_TRIALS}`;

    app.innerHTML = `
      <p class="muted">${trialLabel}</p>
      <h2>AI prediction, then your judgment</h2>
      <p class="muted">
        Review the AI prediction and heatmap, then rate ABCD features, diagnosis, and confidence.
      </p>
      <div class="media-panel">
        ${imageHtml(trial, showCam, { allowSwap: true })}
        <div class="stack">
          <div class="ai-callout">
            <div>
              <div class="label">AI prediction</div>
              <div class="value">${labelPretty(trial.ai_prediction)}</div>
            </div>
            <div>
              <div class="label">Probability</div>
              <div class="value">${pct(trial.ai_probability)}</div>
            </div>
          </div>
          <div class="panel-box">
            <h3>Heatmap</h3>
            <p class="muted" style="margin:0">
              Warmer colours mark regions that contributed more to the model prediction.
              Use Original / Grad-CAM under the image to compare.
            </p>
          </div>
          <div class="field">
            <label>Your ABCD assessment</label>
            <div class="abcd-self">${abcdSelfRatingHtml()}</div>
          </div>
          <div class="field">
            <label>Diagnosis</label>
            ${judgmentButtons(state.draft.final_judgment, "final")}
          </div>
          <div class="field">
            <label>Confidence</label>
            ${confidenceButtons(state.draft.confidence_final)}
          </div>
          <div class="btn-row">
            <button class="btn btn-primary" id="btnSubmitTrial" disabled>Submit trial</button>
          </div>
        </div>
      </div>
    `;

    document.querySelectorAll(".image-swap .swap-btn").forEach((btn) => {
      btn.onclick = () => {
        state.showCamView = btn.dataset.view === "cam";
        renderTrial();
      };
    });
    wireAbcd();
    wireJudgment("final");
    wireConfidence("final");
    const submit = document.getElementById("btnSubmitTrial");
    const sync = () => {
      submit.disabled = !(
        abcdComplete() &&
        state.draft.final_judgment &&
        state.draft.confidence_final
      );
    };
    sync();
    submit.onclick = commitTrial;
  }

  /** Evaluative Phase 1: image only; ABCD + diagnosis + confidence. */
  function renderEvalPhase1(trial) {
    const trialLabel = trial._demo
      ? "Interview demo"
      : trial._practice
        ? "Practice"
        : `Trial ${trial.trial_index} of ${TOTAL_TRIALS}`;

    app.innerHTML = `
      <p class="muted">${trialLabel}</p>
      <h2>What is your judgment?</h2>
      <p class="muted">No AI information yet. Rate the ABCD features from the image, then give your diagnosis and confidence.</p>
      <div class="media-panel">
        ${imageHtml(trial, false)}
        <div class="stack">
          <div class="field">
            <label>Your ABCD assessment</label>
            <div class="abcd-self">${abcdSelfRatingHtml()}</div>
          </div>
          <div class="field">
            <label>Diagnosis</label>
            ${judgmentButtons(state.draft.initial_judgment, "initial")}
          </div>
          <div class="field">
            <label>Confidence</label>
            ${confidenceButtons(state.draft.confidence_initial)}
          </div>
          <div class="btn-row">
            <button class="btn btn-primary" id="btnToPhase2" disabled>Continue to AI support</button>
          </div>
        </div>
      </div>
    `;
    wireAbcd();
    wireJudgment("initial");
    wireConfidence("initial");
    const btn = document.getElementById("btnToPhase2");
    const sync = () => {
      btn.disabled = !(
        abcdComplete() &&
        state.draft.initial_judgment &&
        state.draft.confidence_initial
      );
    };
    sync();
    btn.onclick = () => {
      const t1 = (performance.now() - state.phase1StartedAt) / 1000;
      state._t_phase1_sec = Math.round(t1 * 10) / 10;
      state.phase = 2;
      state.explanationOpened = false;
      state.showCamView = true;
      state.phase2StartedAt = performance.now();
      renderTrial();
    };
  }

  /**
   * Evaluative Phase 2: gated AI advice (ABCD for/against) + heatmap swap,
   * then final diagnosis + confidence.
   */
  function renderEvalPhase2(trial) {
    const opened = state.explanationOpened;
    const showCam = opened && state.showCamView;
    const trialLabel = trial._demo
      ? "Interview demo"
      : trial._practice
        ? "Practice"
        : `Trial ${trial.trial_index} of ${TOTAL_TRIALS}`;

    app.innerHTML = `
      <p class="muted">${trialLabel}</p>
      <h2>Review the AI support, then decide</h2>
      <p class="muted">You must open the explanation before submitting. A heatmap is available after you open it.</p>
      <div class="media-panel">
        ${imageHtml(trial, showCam, { allowSwap: opened })}
        <div class="stack">
          <div class="ai-callout">
            <div>
              <div class="label">Model lean</div>
              <div class="value">${labelPretty(trial.ai_prediction)} · ${pct(trial.ai_probability)}</div>
            </div>
          </div>

          <div class="explain-gate ${opened ? "open" : "locked"}" id="explainGate">
            <button type="button" class="explain-toggle" id="btnExpandExplain" ${opened ? "disabled" : ""}>
              <span>${opened ? "Explanation opened" : "Show AI explanation"}</span>
              <span class="chevron">▾</span>
            </button>
            <div class="explain-body">
              ${evaluativeExplain(trial)}
              <div class="panel-box" style="margin-top:0.75rem">
                <h3>Heatmap</h3>
                <p class="muted" style="margin:0">
                  Warmer colours mark regions that contributed more to the model prediction.
                  Use Original / Grad-CAM under the image to compare.
                </p>
              </div>
            </div>
          </div>

          <div class="field ${opened ? "" : "hidden"}" id="finalBlock">
            <label>Final diagnosis</label>
            ${judgmentButtons(state.draft.final_judgment, "final")}
            <label style="margin-top:0.75rem">Final confidence</label>
            ${confidenceButtons(state.draft.confidence_final)}
            <div class="btn-row">
              <button class="btn btn-primary" id="btnSubmitTrial" disabled>Submit trial</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const gateBtn = document.getElementById("btnExpandExplain");
    if (!opened) {
      gateBtn.onclick = () => {
        state.explanationOpened = true;
        state.showCamView = true;
        renderTrial();
      };
    }

    if (opened) {
      document.querySelectorAll(".image-swap .swap-btn").forEach((btn) => {
        btn.onclick = () => {
          state.showCamView = btn.dataset.view === "cam";
          renderTrial();
        };
      });
      wireJudgment("final");
      wireConfidence("final");
      const submit = document.getElementById("btnSubmitTrial");
      const sync = () => {
        submit.disabled = !(state.draft.final_judgment && state.draft.confidence_final);
      };
      sync();
      submit.onclick = commitTrial;
    }
  }

  /**
   * Evaluative advice panel: AI ABCD vs participant Phase-1 ABCD.
   * No separate ABCD checklist block.
   */
  function evaluativeExplain(trial) {
    const advice = evaluativeAdvice(trial, state.draft.abcd);

    const supportList =
      advice.supportsYou.length === 0
        ? "<li>None of the clear AI feature readings match your earlier ABCD ratings.</li>"
        : advice.supportsYou.map((x) => `<li>${x}</li>`).join("");
    const againstList =
      advice.challengesYou.length === 0
        ? "<li>None of the clear AI feature readings disagree with your earlier ABCD ratings.</li>"
        : advice.challengesYou.map((x) => `<li>${x}</li>`).join("");
    const unclearList =
      advice.unclear.length === 0
        ? ""
        : `<p class="lean-note">Unclear AI features: ${advice.unclear.join("; ")}.</p>`;

    return `
      <div class="panel-box">
        <h3>Advice for your judgment</h3>
        <p class="muted">
          Features where the AI agrees or differs from your earlier ABCD ratings.
          This is decision support, not a final diagnosis.
        </p>
        <div class="abcd-grid">
          <div class="abcd-col support">
            <h4>Supports you (AI agrees with your ABCD)</h4>
            <ul>${supportList}</ul>
          </div>
          <div class="abcd-col against">
            <h4>Challenges you (AI differs from your ABCD)</h4>
            <ul>${againstList}</ul>
          </div>
        </div>
        ${unclearList}
        <p class="lean-note">
          Overall model lean (de-emphasised): ${labelPretty(trial.ai_prediction)} (${pct(trial.ai_probability)}).
        </p>
      </div>
    `;
  }

  /** Attach clicks for Phase-1 ABCD option buttons. */
  function wireAbcd() {
    document.querySelectorAll("[data-abcd-key]").forEach((btn) => {
      btn.onclick = () => {
        const key = btn.dataset.abcdKey;
        const value = btn.dataset.abcdValue;
        if (!state.draft.abcd) state.draft.abcd = { A: null, B: null, C: null, D: null };
        state.draft.abcd[key] = value;
        renderTrial();
      };
    });
  }

  /** Attach clicks for malignant/benign; re-render to show selection. */
  function wireJudgment(which) {
    document.querySelectorAll(`.choice-grid[data-group="${which}"] .choice`).forEach((btn) => {
      btn.onclick = () => {
        const v = btn.dataset.value;
        if (which === "initial") state.draft.initial_judgment = v;
        else state.draft.final_judgment = v;
        renderTrial();
      };
    });
  }

  /** Attach clicks for the 1–7 confidence scale. */
  function wireConfidence(which) {
    document.querySelectorAll("[data-conf-group] button").forEach((btn) => {
      btn.onclick = () => {
        const n = Number(btn.dataset.conf);
        if (which === "initial") state.draft.confidence_initial = n;
        else state.draft.confidence_final = n;
        renderTrial();
      };
    });
  }

  /**
   * Save one logged trial (skip practice), then advance.
   * After practice -> bridge page. Between blocks -> interface switch page.
   */
  function commitTrial() {
    const trial = currentTrial();
    const t2 = state.phase2StartedAt
      ? (performance.now() - state.phase2StartedAt) / 1000
      : 0;

    // Recommendatory is single-step: copy the one judgment into initial + final for CSV
    let initialJ = state.draft.initial_judgment;
    let initialC = state.draft.confidence_initial;
    let finalJ = state.draft.final_judgment;
    let finalC = state.draft.confidence_final;
    let t1 = state._t_phase1_sec;
    if (trial.condition === "recommendatory") {
      initialJ = finalJ;
      initialC = finalC;
      t1 = 0;
    }

    if (!trial._practice && !trial._demo) {
      state.logs.push({
        participant_id: state.participantId,
        condition: trial.condition,
        case_id: trial.case_id,
        cell: trial.cell,
        pred_correct: trial.pred_correct,
        expl_correct: trial.expl_correct,
        ground_truth: trial.ground_truth,
        ai_prediction: trial.ai_prediction,
        ai_probability: trial.ai_probability,
        abcd_a: state.draft.abcd.A,
        abcd_b: state.draft.abcd.B,
        abcd_c: state.draft.abcd.C,
        abcd_d: state.draft.abcd.D,
        initial_judgment: initialJ,
        final_judgment: finalJ,
        confidence_initial: initialC,
        confidence_final: finalC,
        t_phase1_sec: t1 == null ? "" : t1,
        t_phase2_sec: Math.round(t2 * 10) / 10,
        explanation_opened: trial.condition === "evaluative" ? (state.explanationOpened ? 1 : 0) : 1,
        trial_index: trial.trial_index,
        block: trial.block,
        block_order: state.blockOrder.join(">")
      });
    }

    const wasPractice = !!trial._practice;
    state.trialIndex += 1;

    if (config.demoCondition) {
      renderDemoDone();
      return;
    }

    if (state.trialIndex >= state.trials.length) {
      renderFeedback();
      return;
    }

    const next = state.trials[state.trialIndex];
    if (wasPractice) {
      renderRealStart();
      return;
    }
    const prev = state.trials[state.trialIndex - 1];
    if (prev && next && prev.block !== next.block) {
      renderBlockBreak(next.condition);
      return;
    }
    resetDraft();
    renderTrial();
  }

  /** Short pause between the two interface blocks. */
  function renderBlockBreak(nextCondition) {
    state.screen = "break";
    setProgress();
    app.innerHTML = `
      <div class="prose-narrow">
        <h1>Interface switch</h1>
        <p>
          You finished the first interface block.
          Next you will use the ${nextCondition} interface for 8 more images.
        </p>
        <div class="btn-row">
          <button class="btn btn-primary" id="btnContinueBlock">Continue</button>
        </div>
      </div>
    `;
    document.getElementById("btnContinueBlock").onclick = () => {
      resetDraft();
      renderTrial();
    };
  }

  /** End screen for interview demo pages (single trial, not saved). */
  function renderDemoDone() {
    state.screen = "done";
    setProgress();
    app.innerHTML = `
      <div class="prose-narrow">
        <h1>Demo complete</h1>
        <p>
          This was a single example trial for the interview (not saved as study data).
          You can close this tab or open the other interface demo.
        </p>
        <div class="btn-row">
          <a class="btn btn-secondary" href="demo-recommendatory.html">Recommendatory demo</a>
          <a class="btn btn-secondary" href="demo-evaluative.html">Evaluative demo</a>
        </div>
      </div>
    `;
  }

  // ---- CSV export / optional email -----------------------------------------

  /** Convert an array of row objects to a CSV string. */
  function toCsv(rows) {
    if (!rows.length) return "";
    const cols = Object.keys(rows[0]);
    const esc = (v) => {
      const s = String(v ?? "");
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    return [cols.join(",")]
      .concat(rows.map((r) => cols.map((c) => esc(r[c])).join(",")))
      .join("\n");
  }

  /** Trigger a local file download of the logged CSV. */
  function downloadCsv() {
    const csv = toCsv(state.logs);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pilot_${state.participantId}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function web3formsKey() {
    return String(submitCfg.web3formsAccessKey || "").trim();
  }

  /**
   * FormSubmit id (random string) or legacy email.
   * Prefer Web3Forms when configured — FormSubmit is flaky without Referer
   * and often silent after the first activation.
   */
  function formsubmitEndpoint() {
    const id = String(submitCfg.formsubmitId || "").trim();
    if (id) return id;
    const email = String(submitCfg.formsubmitEmail || "").trim();
    if (email.includes("@")) return email;
    return "";
  }

  function canAutoSubmit() {
    return !!(web3formsKey() || formsubmitEndpoint());
  }

  function feedbackPayload(stamp, csv) {
    return {
      participant_id: state.participantId,
      block_order: state.blockOrder.join(">"),
      n_trials: state.logs.length,
      sent_at: stamp,
      page_url: String(location.href || ""),
      feedback_clarity: state.feedback.clarity || "",
      feedback_length: state.feedback.length || "",
      feedback_confusing: state.feedback.confusing || "",
      feedback_missing: state.feedback.missing || "",
      feedback_other: state.feedback.other || "",
      message: "Pilot CSV + feedback below. Copy the csv field into a .csv file if needed.",
      csv: csv
    };
  }

  /** Preferred: Web3Forms (stable). Fallback: FormSubmit. */
  async function autoSubmitCsv() {
    if (!canAutoSubmit()) {
      state.submitStatus = {
        ok: false,
        message: "Auto-send is off. Use Download CSV and email the file to the researcher."
      };
      return;
    }
    const csv = toCsv(state.logs);
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    const subject = `${submitCfg.studyName || "Judgment pilot"} · ${state.participantId} · ${stamp}`;
    const fields = feedbackPayload(stamp, csv);

    try {
      if (web3formsKey()) {
        const res = await fetch("https://api.web3forms.com/submit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            access_key: web3formsKey(),
            subject: subject,
            from_name: "OZP pilot",
            botcheck: "",
            ...fields
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error((data && data.message) || "HTTP " + res.status);
        }
      } else {
        const endpoint = formsubmitEndpoint();
        const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(endpoint)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          // Referrer must come from the real GitHub Pages URL (not file://)
          referrerPolicy: "origin-when-cross-origin",
          body: JSON.stringify({
            _subject: subject,
            _template: "table",
            _captcha: "false",
            ...fields
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || String(data.success) !== "true") {
          throw new Error(
            (data && (data.message || data.error)) ||
              (!res.ok ? "HTTP " + res.status : "FormSubmit did not confirm delivery")
          );
        }
      }
      state.submitStatus = {
        ok: true,
        message:
          "Responses were sent to the researcher. Please also download the CSV as a backup."
      };
    } catch (err) {
      state.submitStatus = {
        ok: false,
        message:
          "Auto-send failed — download the CSV and send it to the researcher. (" +
          (err && err.message ? err.message : "error") +
          ")"
      };
    }
  }

  /** Build a vertical radio list for one feedback field. */
  function radioListHtml(key, options, selected) {
    return `
      <div class="radio-list" role="radiogroup" data-fb="${key}">
        ${options
          .map((v, i) => {
            const id = `fb_${key}_${i}`;
            const checked = selected === v ? "checked" : "";
            return `
              <label class="radio-item" for="${id}">
                <input type="radio" id="${id}" name="fb_${key}" value="${v}" ${checked} />
                <span>${v}</span>
              </label>`;
          })
          .join("")}
      </div>`;
  }

  /** Pilot usability / control questions before debrief. */
  function renderFeedback() {
    state.screen = "feedback";
    setProgress();
    const f = state.feedback;

    app.innerHTML = `
      <div class="prose-narrow">
        <h1>Feedback on this pilot</h1>
        <p>
          Before we finish, please answer a few questions about the interface and session.
          This helps improve the design. It is not a test of your medical skill.
        </p>

        <div class="field">
          <label>Were the instructions and screens clear?</label>
          ${radioListHtml("clarity", ["Very clear", "Mostly clear", "Somewhat unclear", "Very unclear"], f.clarity)}
        </div>

        <div class="field">
          <label>How was the length of the session?</label>
          ${radioListHtml("length", ["Too short", "About right", "A bit long", "Much too long"], f.length)}
        </div>

        <div class="field">
          <label>Was anything confusing or hard to use? (optional)</label>
          <textarea id="fbConfusing" rows="3" placeholder="e.g. buttons, heatmap, ABCD, switching interfaces…">${f.confusing || ""}</textarea>
        </div>

        <div class="field">
          <label>Did you miss any information you would want in practice? (optional)</label>
          <textarea id="fbMissing" rows="3" placeholder="e.g. more history, other features, different wording…">${f.missing || ""}</textarea>
        </div>

        <div class="field">
          <label>Any other comments? (optional)</label>
          <textarea id="fbOther" rows="3" placeholder="Anything else…">${f.other || ""}</textarea>
        </div>

        <div class="btn-row">
          <button class="btn btn-primary" id="btnFeedbackNext" disabled>Continue</button>
        </div>
      </div>
    `;

    const next = document.getElementById("btnFeedbackNext");
    const sync = () => {
      next.disabled = !(state.feedback.clarity && state.feedback.length);
    };
    document.querySelectorAll("[data-fb]").forEach((group) => {
      const key = group.getAttribute("data-fb");
      group.querySelectorAll('input[type="radio"]').forEach((input) => {
        input.onchange = () => {
          state.feedback[key] = input.value;
          sync();
        };
      });
    });
    [
      ["fbConfusing", "confusing"],
      ["fbMissing", "missing"],
      ["fbOther", "other"]
    ].forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.oninput = () => {
        state.feedback[key] = el.value;
      };
    });
    sync();
    next.onclick = () => {
      state.feedback.confusing = document.getElementById("fbConfusing").value;
      state.feedback.missing = document.getElementById("fbMissing").value;
      state.feedback.other = document.getElementById("fbOther").value;
      renderDebrief();
    };
  }

  /** Post-study reveal: fuller explanation of the design (spoilers OK here). */
  function renderDebrief() {
    state.screen = "debrief";
    setProgress();
    app.innerHTML = `
      <div class="prose-narrow">
        <h1>Debrief</h1>
        <p>
          Thanks for completing this pilot. The aim is to understand how people use different
          AI interfaces when they judge dermoscopic images: one that recommends a label with a
          visual heatmap (recommendatory), and one that emphasises feature-level evidence for
          and against your own assessment (evaluative), also with a heatmap.
        </p>
        <p>
          Important: the AI in this session was sometimes intentionally wrong. That could mean
          a wrong diagnosis, a misleading explanation (for example a heatmap on the wrong region,
          or ABCD readings that do not match a careful reading of the image), or both. That was
          part of the design, not a bug. Please do not use anything from this session as medical advice.
        </p>
        <p>
          On the next screen your responses (including the feedback answers) are sent to the
          researcher when possible, and you can download a backup CSV.
        </p>
        <div class="btn-row">
          <button class="btn btn-primary" id="btnToDone">Continue</button>
        </div>
      </div>
    `;
    document.getElementById("btnToDone").onclick = () => {
      renderDone({ submitting: true });
      autoSubmitCsv().then(() => renderDone({ submitting: false }));
    };
  }

  /** Final screen: status of auto-send + backup download. */
  function renderDone(opts) {
    opts = opts || {};
    state.screen = "done";
    setProgress();
    const n = state.logs.length;
    const submitting = !!opts.submitting;
    const status = state.submitStatus;
    let statusHtml = "";
    if (submitting) {
      statusHtml = `<div class="notice">Sending responses…</div>`;
    } else if (status) {
      statusHtml = `<div class="notice">${status.message}</div>`;
    } else if (!canAutoSubmit()) {
      statusHtml = `<div class="notice">Please download your CSV and send it to the researcher (auto-send is not configured).</div>`;
    }

    app.innerHTML = `
      <h1>Thank you</h1>
      <p>
        You completed <strong>${n}</strong> logged trials (practice excluded).
        Session id: <strong>${state.participantId}</strong>
      </p>
      <div class="notice">
        Expected for this pilot: <strong>16</strong> rows.
        ${n === 16 ? "Count looks correct." : `Found ${n}. Tell the researcher if this differs from 16.`}
      </div>
      ${statusHtml}
      <div class="btn-row">
        <button class="btn btn-primary" id="btnDownload" ${submitting ? "disabled" : ""}>Download CSV (backup)</button>
      </div>
      <pre class="panel-box muted" style="margin-top:1rem;overflow:auto;max-height:180px;font-size:0.72rem">${toCsv(state.logs).slice(0, 1200)}${n ? "…" : ""}</pre>
    `;
    const dl = document.getElementById("btnDownload");
    if (dl) dl.onclick = downloadCsv;
  }

  // ---- Boot ----------------------------------------------------------------
  if (!window.STUDY_CASES || !window.STUDY_CASES.length) {
    app.innerHTML = `<h1>Missing cases.js</h1><p>Load cases.js before app.js.</p>`;
    return;
  }
  if (!document.getElementById("progressFill")) {
    app.innerHTML = `<h1>Open a version page</h1><p>Use recommendatory-first.html or evaluative-first.html.</p>`;
    return;
  }

  // Interview demos: one fixed case, skip welcome/consent/practice
  if (config.demoCondition === "recommendatory" || config.demoCondition === "evaluative") {
    state.participantId = "demo";
    state.blockOrder = [config.demoCondition];
    state.trials = [
      {
        ...window.STUDY_CASES[0],
        condition: config.demoCondition,
        trial_index: 1,
        block: 1,
        _demo: true
      }
    ];
    state.trialIndex = 0;
    state.logs = [];
    resetDraft();
    renderTrial();
    return;
  }

  renderWelcome();
})();
