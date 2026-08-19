/* global ChromeUtils, Cc, Ci, Services */

var { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
var { FileUtils } = ChromeUtils.importESModule("resource://gre/modules/FileUtils.sys.mjs");
var { getFolder } = ChromeUtils.importESModule("resource:///modules/ExtensionAccounts.sys.mjs");

this.existingDraft = class extends ExtensionCommon.ExtensionAPI {
  constructor(...args) {
    super(...args);
    this.applicationQuitting = false;
    this.quitObserver = {
      observe: (_subject, topic) => {
        if (topic === "quit-application-granted") {
          this.applicationQuitting = true;
          console.info("[reopen-drafts] application-quit-granted");
        }
      },
    };
    Services.obs.addObserver(this.quitObserver, "quit-application-granted");
  }

  onShutdown() {
    Services.obs.removeObserver(this.quitObserver, "quit-application-granted");
  }

  getAPI(context) {
    const extensionApi = this;
    const logger = (event, data = {}) => console.info(`[reopen-drafts] ${event}`, data);
    function openHeader(messageHeader) {
      const messageUri = messageHeader.folder.getUriForMsg(messageHeader);
      const existingWindow = findOpenDraft(messageUri);
      if (existingWindow) {
        existingWindow.focus();
        return "focused";
      }
      MailServices.compose.OpenComposeWindow(null, messageHeader, messageUri,
        Ci.nsIMsgCompType.Draft, Ci.nsIMsgCompFormat.Default, null, "", null);
      return "opened";
    }

    function findFolder(folderId) {
      try {
        // A MailFolder.id (for example account5://Drafts) is an extension
        // identifier, not an nsIMsgFolder URI. Use Thunderbird's own mapping
        // before touching the native folder database.
        return getFolder(folderId).folder;
      } catch (error) {
        logger("native-durable-folder-resolution-failed", { folderId, message: error.message });
        return null;
      }
    }

    function findOpenDraft(messageUri) {
      const windows = Services.wm.getEnumerator("msgcompose");
      while (windows.hasMoreElements()) {
        const window = windows.getNext();
        try {
          if (window.gMsgCompose?.compFields?.draftId === messageUri) return window;
        } catch (_error) {}
      }
      return null;
    }

    function toGeometry(window) {
      if (!window) return null;
      return {
        left: Math.round(window.screenX), top: Math.round(window.screenY),
        width: Math.round(window.outerWidth), height: Math.round(window.outerHeight),
        state: window.windowState === window.STATE_MAXIMIZED ? "maximized" : "normal",
      };
    }

    function applyGeometry(window, geometry) {
      if (!window || !geometry) return;
      if (geometry.state === "maximized") {
        window.maximize();
        return;
      }
      if ([geometry.left, geometry.top].every(Number.isInteger)) window.moveTo(geometry.left, geometry.top);
      if ([geometry.width, geometry.height].every(Number.isInteger)) window.resizeTo(geometry.width, geometry.height);
    }

    return {
      existingDraft: {
        async openExistingDraft(messageId) {
          const messageHeader = context.extension.messageManager.get(messageId);
          if (!messageHeader?.folder) throw new Error("Resolved message no longer exists");
          const status = openHeader(messageHeader);
          if (status === "focused") {
            logger("native-open-focused-existing", { messageId });
            return false;
          }
          logger("native-open-draft", { messageId });
          return true;
        },
        async openDurableDraft(folderId, headerMessageId) {
          const folder = findFolder(folderId);
          if (!folder) {
            logger("native-durable-draft-unavailable", { folderId, reason: "folder-not-found" });
            return { status: "unavailable", reason: "folder-not-found" };
          }
          let messageHeader;
          try {
            messageHeader = folder.msgDatabase.getMsgHdrForMessageID(headerMessageId);
          } catch (error) {
            // Do not infer a deletion from an unavailable local database. The
            // lifecycle deletion event is authoritative; retaining this entry
            // permits a later manual restore without creating a replacement.
            logger("native-durable-draft-unavailable", {
              folderId, headerMessageId, reason: "message-header-unavailable", message: error.message,
            });
            return { status: "unavailable", reason: "message-header-unavailable" };
          }
          if (!messageHeader) {
            logger("native-durable-draft-unavailable", {
              folderId, headerMessageId, reason: "message-header-unavailable",
            });
            return { status: "unavailable", reason: "message-header-unavailable" };
          }
          const status = openHeader(messageHeader);
          logger("native-durable-draft-open", { folderId, headerMessageId, status });
          return { status };
        },
        async getMainWindowIds() {
          const ids = [];
          const windows = Services.wm.getEnumerator("mail:3pane");
          while (windows.hasMoreElements()) {
            try { ids.push(context.extension.windowManager.getWrapper(windows.getNext()).id); } catch (_error) {}
          }
          return ids;
        },
        async getBrowserConsole() {
          const window = Services.wm.getMostRecentWindow("devtools:webconsole");
          return window ? { open: true, ...toGeometry(window) } : { open: false };
        },
        async listOpenComposeDrafts() {
          const drafts = [];
          const windows = Services.wm.getEnumerator("msgcompose");
          while (windows.hasMoreElements()) {
            const window = windows.getNext();
            try {
              const draftUri = window.gMsgCompose?.compFields?.draftId;
              if (!draftUri) continue;
              const messageHeader = MailServices.messageServiceFromURI(draftUri).messageURIToMsgHdr(draftUri);
              drafts.push({
                message: context.extension.messageManager.convert(messageHeader),
                tabId: context.extension.tabManager.getWrapper(window).id,
                windowId: context.extension.windowManager.getWrapper(window).id,
              });
            } catch (error) {
              logger("compose-scan-skip", { message: error.message });
            }
          }
          logger("compose-scan-result", { count: drafts.length });
          return drafts;
        },
        async setToolbarVisible(visible) {
          const windows = Services.wm.getEnumerator("mail:3pane");
          while (windows.hasMoreElements()) {
            const window = windows.getNext();
            const item = window.document.querySelector(
              `#unifiedToolbarContent [item-id="ext-${context.extension.id}"]`
            );
            if (item) item.hidden = !visible;
          }
          logger("toolbar-visibility", { visible });
        },
        async isApplicationQuitting() {
          return extensionApi.applicationQuitting;
        },
        async openBrowserConsole(geometry) {
          let window = Services.wm.getMostRecentWindow("devtools:webconsole");
          logger("browser-console-open-request", { alreadyOpen: Boolean(window), geometry });
          if (!window) {
            const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs");
            const { BrowserConsoleManager } = require("devtools/client/webconsole/browser-console-manager");
            const hud = await BrowserConsoleManager.openBrowserConsoleOrFocus();
            window = hud.iframeWindow;
          } else {
            window.focus();
          }
          window.setTimeout(() => {
            try {
              logger("browser-console-geometry-apply-request", { geometry });
              applyGeometry(window, geometry);
              logger("browser-console-geometry-applied", { geometry, actual: toGeometry(window) });
            } catch (error) {
              console.error("[reopen-drafts] browser-console-geometry-failed", error);
            }
          }, 0);
          logger("browser-console-opened");
        },
        async appendLog(path, line) {
          const file = new FileUtils.File(path);
          if (!file.isAbsolute()) throw new Error("Log file path must be absolute");
          const stream = FileUtils.openFileOutputStream(
            file,
            FileUtils.MODE_WRONLY | FileUtils.MODE_CREATE | FileUtils.MODE_APPEND
          );
          const converter = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(
            Ci.nsIConverterOutputStream
          );
          converter.init(stream, "UTF-8");
          converter.writeString(line);
          converter.close();
        },
        async getDefaultLogFilePath() {
          const temporaryDirectory = Services.dirsvc.get("TmpD", Ci.nsIFile).clone();
          temporaryDirectory.append("reopen-drafts.log");
          return temporaryDirectory.path;
        },
      },
    };
  }
};
