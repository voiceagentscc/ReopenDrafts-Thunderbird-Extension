/* global browser */

document.querySelector("#keep-toolbar").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "set-settings", settings: { toolbarVisible: true } });
  window.close();
});
document.querySelector("#close").addEventListener("click", () => window.close());
