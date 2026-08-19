import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const implementationSource = await readFile("experiment/implementation.js", "utf8");

function loadExperiment({ getFolder }) {
  const opened = [];
  const ExtensionAPI = class {};
  const mailServices = {
    compose: { OpenComposeWindow(...args) { opened.push(args); } },
  };
  const sandbox = {
    console: { info() {}, error() {} },
    setTimeout,
    clearTimeout,
    Cc: {},
    Ci: {
      nsIMsgCompType: { Draft: "draft" },
      nsIMsgCompFormat: { Default: "default" },
    },
    Services: {
      obs: { addObserver() {}, removeObserver() {} },
      wm: { getEnumerator: () => ({ hasMoreElements: () => false }) },
    },
    ChromeUtils: {
      importESModule(path) {
        if (path.endsWith("ExtensionCommon.sys.mjs")) return { ExtensionCommon: { ExtensionAPI } };
        if (path.endsWith("MailServices.sys.mjs")) return { MailServices: mailServices };
        if (path.endsWith("FileUtils.sys.mjs")) return { FileUtils: {} };
        if (path.endsWith("ExtensionAccounts.sys.mjs")) return { getFolder };
        throw new Error(`Unexpected module import: ${path}`);
      },
    },
  };
  vm.runInNewContext(implementationSource, sandbox, { filename: "experiment/implementation.js" });
  const api = new sandbox.existingDraft();
  return { methods: api.getAPI({ extension: {} }).existingDraft, opened };
}

test("durable restore maps a WebExtension MailFolder.id before opening the native draft", async () => {
  const calls = [];
  const header = { id: "native-header" };
  const folder = {
    msgDatabase: {
      getMsgHdrForMessageID(id) {
        assert.equal(id, "draft@example.test");
        return header;
      },
    },
    getUriForMsg(value) {
      assert.equal(value, header);
      return "imap-message://draft";
    },
    // Startup restore must not refresh IMAP merely to resolve an entry.
    updateFolder() { throw new Error("unexpected folder refresh"); },
  };
  header.folder = folder;
  const { methods, opened } = loadExperiment({
    getFolder(folderId) {
      calls.push(folderId);
      return { folder };
    },
  });

  const result = await methods.openDurableDraft("account5://Drafts", "draft@example.test");
  assert.deepEqual(calls, ["account5://Drafts"]);
  assert.equal(result.status, "opened");
  assert.equal(opened.length, 1);
  assert.equal(opened[0][1], header);
});

test("an unresolvable durable folder is retained as unavailable, never recreated", async () => {
  const { methods, opened } = loadExperiment({
    getFolder() { throw new Error("Folder not found"); },
  });

  const result = await methods.openDurableDraft("account5://Gone", "gone@example.test");
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "folder-not-found");
  assert.deepEqual(opened, []);
});
