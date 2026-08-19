/* global browser */

const $ = selector => document.querySelector(selector);

function logError(event, error) {
  console.error(`[reopen-drafts] ${event}`, error);
}

function render(settings) {
  for (const name of ["draftRestore", "toolbarIcon"]) {
    document.querySelector(`input[name="${name}"][value="${settings[name]}"]`).checked = true;
  }
  $("#toolbar-visible").checked = Boolean(settings.toolbarVisible);
}

async function save() {
  const result = await browser.runtime.sendMessage({
    type: "set-settings",
    source: "toolbar",
    settings: {
      draftRestore: document.querySelector('input[name="draftRestore"]:checked').value,
      toolbarVisible: $("#toolbar-visible").checked,
      toolbarIcon: document.querySelector('input[name="toolbarIcon"]:checked').value,
    },
  });
  render(result.settings);
}

document.addEventListener("change", event => {
  if (event.target.matches("input")) save().catch(error => logError("toolbar-settings-save-failed", error));
});
browser.runtime.sendMessage({ type: "get-popup" }).then(model => render(model.settings)).catch(error => logError("toolbar-settings-load-failed", error));
