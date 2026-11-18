/**
 * Optional auto-send of the CSV when the session ends (FormSubmit).
 *
 * Use the random FormSubmit string (not your naked email) so the address
 * is not visible in the page source. Get it from FormSubmit after activation.
 *
 * Leave formsubmitId as "" to disable auto-send (download only).
 * Open the study over http(s); file:// often blocks the request.
 */
window.SUBMIT_CONFIG = {
  // FormSubmit random id (replaces the email in the action / ajax URL)
  formsubmitId: "1e773ba945ecc18f905108244390373d",
  studyName: "Judgment pilot" // used in the email subject line
};
