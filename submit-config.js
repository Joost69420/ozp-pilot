/**
 * Auto-send of CSV + feedback when the session ends.
 *
 * Preferred: Web3Forms (more reliable than FormSubmit for repeated tests).
 * 1) Go to https://web3forms.com/
 * 2) Enter your email → Create Access Key
 * 3) Confirm the email they send you
 * 4) Paste the access key below in web3formsAccessKey
 *
 * Fallback: FormSubmit random id (often flaky / silent).
 * Leave web3formsAccessKey as "" to use FormSubmit only.
 *
 * Always keep Download CSV as backup for participants.
 */
window.SUBMIT_CONFIG = {
  // Paste your Web3Forms access key here (from the confirmation email)
  web3formsAccessKey: "477bc900-db41-486e-a4b0-d8400a31e733",

  // FormSubmit fallback (only used if web3formsAccessKey is empty)
  formsubmitId: "1e773ba945ecc18f905108244390373d",

  studyName: "Judgment pilot"
};
