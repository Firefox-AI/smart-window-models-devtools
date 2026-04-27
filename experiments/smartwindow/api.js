"use strict";


const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AIWindow: "moz-src:///browser/components/aiwindow/ui/modules/AIWindow.sys.mjs",
  MemoriesManager:
    "moz-src:///browser/components/aiwindow/models/memories/MemoriesManager.sys.mjs",
  openAIEngine:
    "moz-src:///browser/components/aiwindow/models/Utils.sys.mjs",
  MODEL_FEATURES:
    "moz-src:///browser/components/aiwindow/models/Utils.sys.mjs",
  compactMessages:
    "moz-src:///browser/components/aiwindow/models/PromptOptimizer.sys.mjs",
  PlacesUtils:
    "resource://gre/modules/PlacesUtils.sys.mjs",
});

// Version number of the JSON file schema
// Downstream file postprocessors will depend on this to convert the data correctly
const JSON_SCHEMA_VERSION = "1.0"

// SmartWindow tab URL to know where to put the "Export Conversation" button
const AIWINDOW_TAB_URL = "chrome://browser/content/aiwindow/aiWindow.html";

const EXPORT_BTN_ID = "smart-window-devtools-export-btn";

const windowMediator = Cc["@mozilla.org/appshell/window-mediator;1"].getService(
  Ci.nsIWindowMediator
);
const appInfo = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo);


/**
 * Open an overlay with the export dialog box on top
 * The dialog box has fields for:
 * 1. Bugzillas
 * 2. Browsing history start/end dates
 * 3. Arbitrary notes
 */
function showExportDialog(doc) {
  return new Promise(resolve => {
    const overlay = doc.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.5)",
      zIndex: "2147483646",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });

    const dialog = doc.createElement("div");
    Object.assign(dialog.style, {
      background: "#fff",
      borderRadius: "8px",
      padding: "20px",
      width: "400px",
      maxWidth: "90vw",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      fontFamily: "system-ui, sans-serif",
    });

    const fieldStyle = { fontWeight: "600", fontSize: "14px", color: "#0c0c0d" };
    const inputStyle = {
      width: "100%",
      padding: "8px",
      borderRadius: "4px",
      border: "1px solid #ccc",
      fontSize: "13px",
      fontFamily: "system-ui, sans-serif",
      boxSizing: "border-box",
    };

    const bugLabelRow = doc.createElement("div");
    Object.assign(bugLabelRow.style, { display: "flex", alignItems: "center", gap: "8px" });

    const bugLabel = doc.createElement("label");
    bugLabel.textContent = "Bugzilla URLs";
    Object.assign(bugLabel.style, fieldStyle);

    const bugAddBtn = doc.createElement("button");
    bugAddBtn.textContent = "+";
    Object.assign(bugAddBtn.style, {
      padding: "1px 7px",
      borderRadius: "4px",
      border: "1px solid #ccc",
      background: "#2c2c32",
      cursor: "pointer",
      fontSize: "13px",
    });

    bugLabelRow.append(bugLabel, bugAddBtn);

    const bugUrlsContainer = doc.createElement("div");
    Object.assign(bugUrlsContainer.style, { display: "flex", flexDirection: "column", gap: "6px" });

    const addBugRow = () => {
      const row = doc.createElement("div");
      Object.assign(row.style, { display: "flex", gap: "6px" });

      const input = doc.createElement("input");
      input.type = "text";
      input.placeholder = "https://bugzilla.mozilla.org/show_bug.cgi?id=…";
      Object.assign(input.style, { ...inputStyle, flex: "1" });

      const removeBtn = doc.createElement("button");
      removeBtn.textContent = "×";
      Object.assign(removeBtn.style, {
        padding: "4px 8px",
        borderRadius: "4px",
        border: "1px solid #ccc",
        background: "#bb0b0b",
        cursor: "pointer",
        fontSize: "13px",
        flexShrink: "0",
      });
      removeBtn.addEventListener("click", () => {
        if (bugUrlsContainer.children.length > 1) row.remove();
      });

      row.append(input, removeBtn);
      bugUrlsContainer.appendChild(row);
      input.focus();
    };

    bugAddBtn.addEventListener("click", addBugRow);
    addBugRow();

    const dateRangeLabel = doc.createElement("label");
    dateRangeLabel.textContent = "Browsing History Date Range";
    Object.assign(dateRangeLabel.style, fieldStyle);

    const dateRow = doc.createElement("div");
    Object.assign(dateRow.style, { display: "flex", gap: "8px", alignItems: "center" });

    const startInput = doc.createElement("input");
    startInput.type = "text";
    startInput.placeholder = "YYYY-MM-DD HH:MM";
    Object.assign(startInput.style, { ...inputStyle, flex: "1" });

    const dateSep = doc.createElement("span");
    dateSep.textContent = "–";
    Object.assign(dateSep.style, { fontSize: "13px", color: "#5b5b66", flexShrink: "0" });

    const endInput = doc.createElement("input");
    endInput.type = "text";
    endInput.placeholder = "YYYY-MM-DD HH:MM";
    Object.assign(endInput.style, { ...inputStyle, flex: "1" });

    dateRow.append(startInput, dateSep, endInput);

    const notesLabel = doc.createElement("label");
    notesLabel.textContent = "Notes";
    Object.assign(notesLabel.style, fieldStyle);

    const textarea = doc.createElement("textarea");
    Object.assign(textarea.style, { ...inputStyle, height: "120px", resize: "vertical" });

    const btnRow = doc.createElement("div");
    Object.assign(btnRow.style, { display: "flex", justifyContent: "flex-end", gap: "8px" });

    const cancelBtn = doc.createElement("button");
    cancelBtn.textContent = "Cancel";
    Object.assign(cancelBtn.style, {
      padding: "6px 14px",
      borderRadius: "4px",
      border: "1px solid #ccc",
      background: "#2c2c32",
      cursor: "pointer",
      fontSize: "13px",
    });

    const saveBtn = doc.createElement("button");
    saveBtn.textContent = "Save";
    Object.assign(saveBtn.style, {
      padding: "6px 14px",
      borderRadius: "4px",
      border: "none",
      background: "#0060df",
      color: "#fff",
      cursor: "pointer",
      fontSize: "13px",
    });

    const finish = result => { overlay.remove(); resolve(result); };
    cancelBtn.addEventListener("click", () => finish(null));
    saveBtn.addEventListener("click", () =>
      finish({
        notes: textarea.value,
        bugzillaUrls: Array.from(bugUrlsContainer.querySelectorAll("input"))
          .map(i => i.value.trim())
          .filter(Boolean),
        startDate: startInput.value,
        endDate: endInput.value,
      })
    );
    overlay.addEventListener("keydown", e => {
      if (e.key === "Escape") finish(null);
    });

    btnRow.append(cancelBtn, saveBtn);
    dialog.append(bugLabelRow, bugUrlsContainer, dateRangeLabel, dateRow, notesLabel, textarea, btnRow);
    overlay.appendChild(dialog);
    doc.body.appendChild(overlay);
    textarea.focus();
  });
}

/**
 * Retrieve browser history from Places
 *
 * @param {string} startDate - Start date for history search.
 * @param {string} endDate - End date for history search. If null, will use the current datetime instead
 * @returns {Array} - List of history object including url, title, and visitTime
 */
async function getBrowsingHistory(startDate, endDate) {
  if (!startDate?.trim()) return null;

  // Parse out the user-provided start and end times
  const startMs = Date.parse(startDate.trim().replace(" ", "T"));
  if (isNaN(startMs)) return null;

  const endRaw = endDate?.trim();
  const endMs = endRaw ? Date.parse(endRaw.replace(" ", "T")) : Date.now();
  if (isNaN(endMs)) return null;

  // Places stores visit_date as PRTime (microseconds since Unix epoch).
  const startPRTime = startMs * 1000;
  const endPRTime = endMs * 1000;

  // Query the Places DB
  const db = await lazy.PlacesUtils.promiseDBConnection();
  const rows = await db.executeCached(
    `SELECT p.url, p.title, v.visit_date
     FROM moz_historyvisits v
     JOIN moz_places p ON p.id = v.place_id
     WHERE v.visit_date >= :startTime AND v.visit_date <= :endTime
     ORDER BY v.visit_date ASC`,
    { startTime: startPRTime, endTime: endPRTime }
  );

  return rows.map(row => ({
    url: row.getResultByName("url"),
    title: row.getResultByName("title") || null,
    visitTime: new Date(row.getResultByName("visit_date") / 1000).toISOString(),
  }));
}

/**
 * Gather data from the active SmartWindow
 *
 * @returns {object} - Collection of SmartWindow contextual data related to AI models and their use
 */
async function collectSmartWindowData({ notes = "", bugzillaUrls = [], startDate = "", endDate = "" } = {}) {
  // Find the conversation in the current SmartWindow
  const win = windowMediator.getMostRecentWindow("navigator:browser");
  const conversation = lazy.AIWindow.getActiveConversation(win);
  // Render the messages in openAI format
  // The conversation isn't stored in ChatConversation in the same form it is when it hits the API
  // We convert it here to make sure the 2 are properly aligned, and there aren't bugs in conversion
  const openAIFormatMessages = conversation.getMessagesInOpenAiFormat();

  // Create a temp openAIEngine with the active config in order to pull its parameters
  let engineConfig = null;
  try {
    const engine = await lazy.openAIEngine.build(
      lazy.MODEL_FEATURES.CHAT,
      `FOR_DUMP-${conversation.id}`
    );
    engineConfig = engine.getConfig(lazy.MODEL_FEATURES.CHAT);
  } catch (e) {
    engineConfig = { error: String(e) };
  }

  // Collect all open tabs
  const tabs = Array.from(win.gBrowser.tabs).map(tab => ({
    url: tab.linkedBrowser?.currentURI?.spec ?? null,
    title: tab.label ?? null,
    isActiveTab: tab.selected,
    lastAccessed: tab.lastAccessed,
  }));

  // Gather all stored SmartWindow memories
  const memories = await lazy.MemoriesManager.getAllMemories();

  // Pull history if the user specified at least a startDate
  const browsingHistory = await getBrowsingHistory(startDate, endDate);


  // Output object
  return {
    // Information about the extension, itself, including its version and the JSON schema version
    extensionInformation: {
      extensionVersion,
      JSON_SCHEMA_VERSION
    },
    // Bug reporting information including the current time, Bugzilla URLs, and any notes from the reporter
    reportingInformation: {
      exportTimestamp: new Date().toISOString(),
      bugzillaUrls,
      notes
    },
    // Information about the SmartWindow application including Fx version, openAIEngine (prompt, model, etc.), and user's locale/timezone
    applicationMetadata: {
      firefox: {
        version: appInfo.version,
        buildID: appInfo.appBuildID,
      },
      openAIEngine: engineConfig,
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    // Different forms of the conversation including the raw ChatConversation object and messages rendered in a few different formats
    conversation: {
      raw: {
        chatConversationObject: {
          metadata: conversation,
          messages: conversation.messages
        }
      },
      rendered: {
        basic: openAIFormatMessages,
        compacted: lazy.compactMessages(openAIFormatMessages)
      }
    },
    // Context for the browser like tabs, SmartWindow memories, and browsing history if the user specified at least a startDate
    browserContext: {
      tabs,
      memories,
      browsingHistory: {
        datetimeRange: { start: startDate, end: endDate },
        historyRecords: browsingHistory
      }
    }
  };
}

/**
 * Open the file picker, gather SmartWindow information based on user parameters, and save to a JSON file
 */
async function doExport(browsingContext, { notes = "", bugzillaUrls = [], startDate = "", endDate = "" } = {}) {

  // Set up the file picker
  const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
  fp.init(browsingContext, "Export SmartWindow Data", Ci.nsIFilePicker.modeSave);
  fp.defaultExtension = "json";
  fp.defaultString = "smartwindow-export.json";
  fp.appendFilter("JSON Files", "*.json");
  fp.appendFilters(Ci.nsIFilePicker.filterAll);

  const result = await new Promise(resolve => fp.open(resolve));

  // Check if the user canceled saving
  if (result !== Ci.nsIFilePicker.returnOK && result !== Ci.nsIFilePicker.returnReplace) {
    return { saved: false, reason: "cancelled" };
  }

  // Collect the SmartWindow models data
  const rawData = await collectSmartWindowData({ notes, bugzillaUrls, startDate, endDate });
  const data = JSON.stringify(rawData, null, 2);

  // Save
  const file = fp.file;

  const foStream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(
    Ci.nsIFileOutputStream
  );
  foStream.init(file, 0x02 | 0x08 | 0x20, 0o644, 0);

  const converter = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(
    Ci.nsIConverterOutputStream
  );
  converter.init(foStream, "UTF-8");
  converter.writeString(data);
  converter.close();

  return { saved: true, path: file.path };
}

/**
 * Inject the export button into the aiWindow document and watch if it's removed by web component re-renders, re-adding it if so.
 */
function attachButton(aiWindowBrowser) {
  const doc = aiWindowBrowser.contentDocument;
  if (!doc?.body) return;

  // Already injected — don't stack another observer.
  if (doc.getElementById(EXPORT_BTN_ID)) return;

  const btn = doc.createElement("button");
  btn.id = EXPORT_BTN_ID;
  btn.textContent = "Export Conversation";
  Object.assign(btn.style, {
    position: "fixed",
    top: "8px",
    right: "8px",
    zIndex: "2147483647",
    padding: "6px 12px",
    background: "#0060df",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "12px",
    fontFamily: "system-ui, sans-serif",
  });
  btn.addEventListener("click", async () => {
    const result = await showExportDialog(doc);
    if (result === null) return;
    doExport(aiWindowBrowser.browsingContext, result).catch(e =>
      console.error("SmartWindow export failed:", e)
    );
  });
  doc.body.appendChild(btn);

  // Re-add the button if a web component re-render removes it.
  const observer = new doc.defaultView.MutationObserver(() => {
    if (!doc.getElementById(EXPORT_BTN_ID)) {
      observer.disconnect();
      attachButton(aiWindowBrowser);
    }
  });
  observer.observe(doc.body, { childList: true, subtree: true });

  return observer;
}

// Per-window cleanup state.
const windowState = new WeakMap();

/**
 * Wire up the sidebar button for a window once #ai-window-browser is present.
 * Safe to call multiple times — attach only once per element.
 */
function setupSidebarForWindow(win, aiWindowBrowser, state) {
  if (state.aiWindowBrowser) return; // already done

  state.aiWindowBrowser = aiWindowBrowser;
  state.bodyObserver = attachButton(aiWindowBrowser);

  // Re-inject the button into the sidebar after full-page navigations.
  const loadHandler = () => {
    state.bodyObserver?.disconnect();
    state.bodyObserver = attachButton(aiWindowBrowser);
  };
  aiWindowBrowser.addEventListener("load", loadHandler, { capture: true });
  state.loadHandler = loadHandler;
}

/**
 * Inject the export button into SmartWindow tabs and watches for new ones.
 * Tab listeners are registered immediately so new SmartWindow tabs in a window
 * get the button even before the SmartWindow sidebar has been opened.
 */
function setupExportButtonForWindow(win) {
  // Guard against double-initialization for the same window.
  if (windowState.has(win)) return;

  // Register state early so the guard works from this point on.
  const state = {};
  windowState.set(win, state);

  // Register tab listeners unconditionally — these must be active regardless of
  // whether the SmartWindow sidebar (#ai-window-browser) exists yet.
  const tabsProgressListener = {
    onLocationChange(browser, webProgress, request, location) {
      if (!webProgress.isTopLevel) return;
      if (location.spec === AIWINDOW_TAB_URL && browser.contentDocument?.body) {
        attachButton(browser);
      }
    },
    onStateChange(browser, webProgress, request, stateFlags) {
      if (!webProgress.isTopLevel) return;
      const { STATE_STOP, STATE_IS_DOCUMENT } = Ci.nsIWebProgressListener;
      if (
        (stateFlags & (STATE_STOP | STATE_IS_DOCUMENT)) === (STATE_STOP | STATE_IS_DOCUMENT) &&
        browser.currentURI?.spec === AIWINDOW_TAB_URL
      ) {
        attachButton(browser);
      }
    },
  };
  win.gBrowser.addTabsProgressListener(tabsProgressListener);
  state.tabsProgressListener = tabsProgressListener;

  // TabOpen fires synchronously when a new tab is created. At that moment
  // currentURI is already set to the SmartWindow URL for SmartWindow tabs,
  // and contentDocument.body is ready — so we can attach directly.
  const onTabOpen = ({ target: tab }) => {
    const browser = tab.linkedBrowser;
    if (browser.currentURI?.spec === AIWINDOW_TAB_URL && browser.contentDocument?.body) {
      attachButton(browser);
    }
  };
  win.gBrowser.tabContainer.addEventListener("TabOpen", onTabOpen);
  state.onTabOpen = onTabOpen;

  // Inject button into any SmartWindow tabs already open in this window.
  for (const tabBrowser of win.gBrowser.browsers) {
    if (tabBrowser.currentURI?.spec === AIWINDOW_TAB_URL && tabBrowser.contentDocument?.body) {
      attachButton(tabBrowser);
    }
  }

  // Handle the sidebar — it may not exist yet in a freshly opened window.
  const aiWindowBrowser = win.document.getElementById("ai-window-browser");
  if (aiWindowBrowser) {
    setupSidebarForWindow(win, aiWindowBrowser, state);
  } else {
    // Watch for the sidebar element to be added to the chrome later.
    const chromeObserver = new win.MutationObserver(() => {
      const el = win.document.getElementById("ai-window-browser");
      if (el) {
        chromeObserver.disconnect();
        state.chromeObserver = null;
        setupSidebarForWindow(win, el, state);
      }
    });
    chromeObserver.observe(win.document.documentElement, { childList: true, subtree: true });
    state.chromeObserver = chromeObserver;
  }
}

/**
 * Disconnect all observers, listeners, and buttons
 */
function teardownExportButtonForWindow(win) {
  const state = windowState.get(win);
  if (!state) return;

  state.chromeObserver?.disconnect();
  state.bodyObserver?.disconnect();

  if (state.tabsProgressListener) {
    win.gBrowser?.removeTabsProgressListener(state.tabsProgressListener);
  }
  if (state.onTabOpen) {
    win.gBrowser?.tabContainer?.removeEventListener("TabOpen", state.onTabOpen);
  }

  if (state.aiWindowBrowser) {
    state.aiWindowBrowser.removeEventListener("load", state.loadHandler, { capture: true });
    state.aiWindowBrowser.contentDocument?.getElementById(EXPORT_BTN_ID)?.remove();
  }

  windowState.delete(win);
}

let wmListener = null;
let extensionVersion = null;

this.smartwindow = class extends ExtensionAPI {
  getAPI(context) {
    extensionVersion = context.extension.version;
    return {
      experiments: {
        smartwindow: {
          async init() {
            const enumerator = windowMediator.getEnumerator("navigator:browser");
            while (enumerator.hasMoreElements()) {
              setupExportButtonForWindow(enumerator.getNext());
            }

            wmListener = {
              onOpenWindow(xulWindow) {
                const win = xulWindow.docShell.domWindow;
                win.addEventListener("load", () => setupExportButtonForWindow(win), { once: true });
              },
              onCloseWindow() {},
              onWindowTitleChange() {},
            };
            windowMediator.addListener(wmListener);
          },

          async uninit() {
            if (wmListener) {
              windowMediator.removeListener(wmListener);
              wmListener = null;
            }
            const enumerator = windowMediator.getEnumerator("navigator:browser");
            while (enumerator.hasMoreElements()) {
              teardownExportButtonForWindow(enumerator.getNext());
            }
          },

          async getSmartWindowData() {
            return collectSmartWindowData();
          },

          async exportToFile({ notes = "", bugzillaUrls = [], startDate = "", endDate = "" } = {}) {
            const chromeWindow = windowMediator.getMostRecentWindow("navigator:browser");
            return doExport(chromeWindow.browsingContext, { notes, bugzillaUrls, startDate, endDate });
          },

          async triggerExport() {
            const win = windowMediator.getMostRecentWindow("navigator:browser");

            // Prefer the active gBrowser tab — this is the full-screen SmartWindow case.
            const activeBrowser = win.gBrowser.selectedBrowser;
            let doc = null;
            if (activeBrowser.currentURI?.spec === AIWINDOW_TAB_URL &&
                activeBrowser.contentDocument?.body) {
              doc = activeBrowser.contentDocument;
            }

            // Fall back to the sidebar (#ai-window-browser) if the active tab
            // isn't a SmartWindow tab.
            if (!doc) {
              const sidebar = win.document.getElementById("ai-window-browser");
              if (sidebar?.contentDocument?.body) {
                doc = sidebar.contentDocument;
              }
            }

            if (!doc) return { saved: false, reason: "no-smartwindow" };

            const result = await showExportDialog(doc);
            if (!result) return { saved: false, reason: "cancelled" };

            return doExport(win.browsingContext, result);
          },
        },
      },
    };
  }
};
