/* global browser */

const $ = selector => document.querySelector(selector);

function create(tag, text = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function render(model) {
  for (const name of ["draftRestore", "browserConsoleRestore", "toolbarIcon"]) {
    const input = document.querySelector(`input[name="${name}"][value="${model.settings[name]}"]`);
    if (input) input.checked = true;
  }
  $("#preserve").checked = Boolean(model.settings.preserveOnMainClose);
  $("#toolbar-visible").checked = Boolean(model.settings.toolbarVisible);
  $("#restore-position").checked = Boolean(model.settings.restorePosition);
  $("#restore-size").checked = Boolean(model.settings.restoreSize);
  $("#log-to-file").checked = Boolean(model.settings.logToFile);
  $("#log-file-path").value = model.settings.logFilePath;
  $("#log-file-path").disabled = !model.settings.logToFile;
  const drafts = $("#drafts");
  drafts.replaceChildren();
  for (const group of model.groups) {
    const heading = create("h2", `${group.accountName}:`);
    drafts.append(heading);
    const list = document.createElement("ul");
    for (const draft of group.drafts) {
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.name = "draft";
      box.value = draft.key;
      box.checked = true;
      label.append(box, document.createTextNode(` ${draft.subject}`));
      const item = document.createElement("li");
      item.append(label);
      list.append(item);
    }
    drafts.append(list);
  }
  $("#empty").hidden = model.count !== 0;
  $("#restore-selected").disabled = model.count === 0;
  $("#restore-all").disabled = model.count === 0;
}

async function refresh() {
  render(await browser.runtime.sendMessage({ type: "get-popup" }));
}

async function saveSettings() {
  await browser.runtime.sendMessage({
    type: "set-settings",
    settings: {
      draftRestore: document.querySelector('input[name="draftRestore"]:checked').value,
      browserConsoleRestore: document.querySelector('input[name="browserConsoleRestore"]:checked').value,
      preserveOnMainClose: $("#preserve").checked,
      toolbarVisible: $("#toolbar-visible").checked,
      toolbarIcon: document.querySelector('input[name="toolbarIcon"]:checked').value,
      restorePosition: $("#restore-position").checked,
      restoreSize: $("#restore-size").checked,
      logToFile: $("#log-to-file").checked,
      logFilePath: $("#log-file-path").value.trim(),
    },
  });
}

function logUiError(event, error) {
  console.error(`[reopen-drafts] ${event}`, error);
}

document.addEventListener("change", event => {
  if (event.target.matches("input[name], #preserve, #toolbar-visible, #restore-position, #restore-size, #log-to-file")) saveSettings().catch(error => logUiError("settings-save-failed", error));
});
$("#log-file-path").addEventListener("change", () => saveSettings().catch(error => logUiError("log-path-save-failed", error)));
$("#restore-selected").addEventListener("click", async () => {
  const keys = [...document.querySelectorAll('input[name="draft"]:checked')].map(input => input.value);
  render(await browser.runtime.sendMessage({ type: "restore-selected", keys }));
});
$("#restore-all").addEventListener("click", async () => render(await browser.runtime.sendMessage({ type: "restore-all" })));
$("#forget").addEventListener("click", async () => render(await browser.runtime.sendMessage({ type: "forget-session" })));
refresh().catch(error => logUiError("popup-load-failed", error));
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.composeSessionState) {
    refresh().catch(error => logUiError("session-list-refresh-failed", error));
  }
});
