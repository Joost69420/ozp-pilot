/**
 * Stimulus pack for the pilot (8 cases).
 *
 * Design: 2 of each cell CC / CI / IC / II (Morrison-style imperfect XAI).
 * Within-subjects: each case appears once in recommendatory and once in evaluative = 16 trials.
 *
 * vignette: age, sex, localization match HAM10000 metadata fields.
 * The free-text "note" (history) is NOT in HAM10000 — added for the pilot only.
 */
window.STUDY_CASES = [
  {
    case_id: 1,
    cell: "CC",
    pred_correct: 1,
    expl_correct: 1,
    ground_truth: "malignant",
    ai_prediction: "malignant",
    ai_probability: 0.87,
    image: "assets/images/case-01.png",
    cam_image: "assets/images/case-01-cam.png",
    image_label: "Case 1",
    image_brief:
      "Elongated irregular lesion with light/dark brown and blue-grey blotches.",
    vignette: {
      age: 54,
      sex: "female",
      localization: "back",
      note: "Patient noticed the spot changing over about 3 months. No known personal history of melanoma."
    },
    cam_note:
      "Heatmap focused on the irregular pigment blotches inside the lesion (not the surrounding skin markers).",
    cam_quality: "correct",
    abcd_true: { A: "asymmetric", B: "irregular", C: "multiple colours", D: "enlarged" },
    abcd_shown: { A: "asymmetric", B: "irregular", C: "multiple colours", D: "enlarged" }
  },
  {
    case_id: 2,
    cell: "CC",
    pred_correct: 1,
    expl_correct: 1,
    ground_truth: "benign",
    ai_prediction: "benign",
    ai_probability: 0.81,
    image: "assets/images/case-02.png",
    cam_image: "assets/images/case-02-cam.png",
    image_label: "Case 2",
    image_brief: "Small, round, uniform medium-brown mole with soft regular border.",
    vignette: {
      age: 32,
      sex: "male",
      localization: "upper extremity",
      note: "Long-standing mole; patient asks for reassurance after a family member had skin cancer."
    },
    cam_note: "Heatmap centred on the mole itself, matching a benign-focused reading.",
    cam_quality: "correct",
    abcd_true: { A: "symmetric", B: "regular", C: "uniform colour", D: "small" },
    abcd_shown: { A: "symmetric", B: "regular", C: "uniform colour", D: "small" }
  },
  {
    case_id: 3,
    cell: "CI",
    pred_correct: 1,
    expl_correct: 0,
    ground_truth: "malignant",
    ai_prediction: "malignant",
    ai_probability: 0.79,
    image: "assets/images/case-03.png",
    cam_image: "assets/images/case-03-cam.png",
    image_label: "Case 3",
    image_brief:
      "Tall irregular multi-lobed lesion; dark brown/black with a blue-grey tip.",
    vignette: {
      age: 61,
      sex: "male",
      localization: "chest",
      note: "New lesion noticed by partner. History of frequent sun exposure."
    },
    cam_note:
      "Heatmap pulled toward a small white ring artifact on the surrounding skin (misleading).",
    cam_quality: "incorrect",
    abcd_true: { A: "asymmetric", B: "irregular", C: "multiple colours", D: "enlarged" },
    abcd_shown: { A: "symmetric", B: "regular", C: "uniform colour", D: "small" }
  },
  {
    case_id: 4,
    cell: "CI",
    pred_correct: 1,
    expl_correct: 0,
    ground_truth: "benign",
    ai_prediction: "benign",
    ai_probability: 0.84,
    image: "assets/images/case-04.png",
    cam_image: "assets/images/case-04-cam.png",
    image_label: "Case 4",
    image_brief: "Small symmetric reddish-brown macule with a soft even border.",
    vignette: {
      age: 28,
      sex: "female",
      localization: "lower extremity",
      note: "Stable appearance for years; recent concern after reading about melanoma online."
    },
    cam_note:
      "Heatmap highlighted white circle markers on surrounding skin instead of the central mole.",
    cam_quality: "incorrect",
    abcd_true: { A: "symmetric", B: "regular", C: "uniform colour", D: "small" },
    abcd_shown: { A: "asymmetric", B: "irregular", C: "multiple colours", D: "enlarged" }
  },
  {
    case_id: 5,
    cell: "IC",
    pred_correct: 0,
    expl_correct: 1,
    ground_truth: "malignant",
    ai_prediction: "benign",
    ai_probability: 0.76,
    image: "assets/images/case-05.png",
    cam_image: "assets/images/case-05-cam.png",
    image_label: "Case 5",
    image_brief:
      "Heart/U-shaped irregular lesion with tan, dark brown and blue-grey patches.",
    vignette: {
      age: 49,
      sex: "female",
      localization: "abdomen",
      note: "Patient reports gradual darkening. No prior dermatoscopy of this spot."
    },
    cam_note:
      "Heatmap on the lesion body, used to back the (incorrect) benign prediction.",
    cam_quality: "correct",
    abcd_true: { A: "asymmetric", B: "irregular", C: "multiple colours", D: "enlarged" },
    abcd_shown: { A: "symmetric", B: "regular", C: "uniform colour", D: "small" }
  },
  {
    case_id: 6,
    cell: "IC",
    pred_correct: 0,
    expl_correct: 1,
    ground_truth: "benign",
    ai_prediction: "malignant",
    ai_probability: 0.73,
    image: "assets/images/case-06.png",
    cam_image: "assets/images/case-06-cam.png",
    image_label: "Case 6",
    image_brief:
      "Mostly round medium-brown mole; mild internal speckles, overall neat border.",
    vignette: {
      age: 41,
      sex: "male",
      localization: "face",
      note: "Present for many years; patient worried after recent bleeding from scratching."
    },
    cam_note:
      "Heatmap on the mole, used to back the (incorrect) malignant prediction.",
    cam_quality: "correct",
    abcd_true: { A: "symmetric", B: "regular", C: "uniform colour", D: "small" },
    abcd_shown: { A: "asymmetric", B: "irregular", C: "multiple colours", D: "enlarged" }
  },
  {
    case_id: 7,
    cell: "II",
    pred_correct: 0,
    expl_correct: 0,
    ground_truth: "malignant",
    ai_prediction: "benign",
    ai_probability: 0.71,
    image: "assets/images/case-07.png",
    cam_image: "assets/images/case-07-cam.png",
    image_label: "Case 7",
    image_brief:
      "Highly irregular multi-lobed lesion; brown/black/red with blue-grey haze.",
    vignette: {
      age: 67,
      sex: "male",
      localization: "scalp",
      note: "Family history of melanoma in a sibling. Lesion found during routine check."
    },
    cam_note:
      "Heatmap scattered onto faint white ring artifacts beside the lesion.",
    cam_quality: "incorrect",
    abcd_true: { A: "asymmetric", B: "irregular", C: "multiple colours", D: "enlarged" },
    abcd_shown: { A: "unclear", B: "unclear", C: "mixed signals", D: "unclear" }
  },
  {
    case_id: 8,
    cell: "II",
    pred_correct: 0,
    expl_correct: 0,
    ground_truth: "benign",
    ai_prediction: "malignant",
    ai_probability: 0.69,
    image: "assets/images/case-08.png",
    cam_image: "assets/images/case-08-cam.png",
    image_label: "Case 8",
    image_brief:
      "Round uniform dark-brown mole; bright glare arc and white rings on the skin.",
    vignette: {
      age: 36,
      sex: "female",
      localization: "foot",
      note: "Patient unsure how long it has been present; mild itching reported."
    },
    cam_note:
      "Heatmap locked onto glare/reflection and ring artifacts instead of the mole.",
    cam_quality: "incorrect",
    abcd_true: { A: "symmetric", B: "regular", C: "uniform colour", D: "small" },
    abcd_shown: { A: "unclear", B: "unclear", C: "mixed signals", D: "unclear" }
  }
];
