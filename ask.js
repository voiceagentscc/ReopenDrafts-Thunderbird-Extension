/* global browser */

const $ = selector => document.querySelector(selector);

function logError(event, error) {
  console.error(`[reopen-drafts] ${event}`, error);
}

function create(tag, text = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function render(model) {
  const drafts = $("#drafts");
  drafts.replaceChildren();
  for (const group of model.groups) {
    drafts.append(create("h2", `${group.accountName}:`));
    const list = document.createElement("ul");
    for (const draft of group.drafts) {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "draft";
      input.value = draft.key;
      input.checked = true;
      const label = document.createElement("label");
      label.append(input, document.createTextNode(` ${draft.subject}`));
      const item = document.createElement("li");
      item.append(label);
      list.append(item);
    }
    drafts.append(list);
  }
  $("#empty").hidden = model.count !== 0;
}
async function restore(type) {
  const keys = [...document.querySelectorAll('input[name="draft"]:checked')].map(input => input.value);
  await browser.runtime.sendMessage(type === "all" ? { type: "restore-all" } : { type: "restore-selected", keys });
  window.close();
}
$("#restore-selected").addEventListener("click", () => restore("selected").catch(error => logError("ask-restore-selected-failed", error)));
$("#restore-all").addEventListener("click", () => restore("all").catch(error => logError("ask-restore-all-failed", error)));
$("#not-now").addEventListener("click", () => window.close());
browser.runtime.sendMessage({ type: "get-popup" }).then(render).catch(error => logError("ask-load-failed", error));
