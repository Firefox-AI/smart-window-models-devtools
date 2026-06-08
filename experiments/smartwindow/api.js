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
  toolsConfig:
    "moz-src:///browser/components/aiwindow/models/Tools.sys.mjs",
  loadPrompt:
    "moz-src:///browser/components/aiwindow/models/PromptLoader.sys.mjs",
  loadCallContext:
    "moz-src:///browser/components/aiwindow/models/PromptLoader.sys.mjs",
});

/* Version number of the JSON file schema
 * Downstream file postprocessors will depend on this to convert the data correctly
 *
 * Schema History
 * 1.0: Base version exporting application info, browser context, and 3 forms of the conversation (DB, raw rendered, compacted)
 * 2.0: Adding `eval_format` as an additional exported conversation version
 **/
const JSON_SCHEMA_VERSION = "2.0"

// SmartWindow tab URL to know where to put the "Export Conversation" button
const AIWINDOW_TAB_URL = "chrome://browser/content/aiwindow/aiWindow.html";

const EXPORT_BTN_ID = "smart-window-devtools-export-btn";

const windowMediator = Cc["@mozilla.org/appshell/window-mediator;1"].getService(
  Ci.nsIWindowMediator
);
const appInfo = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo);
const uuidGenerator = Cc["@mozilla.org/uuid-generator;1"].getService(Ci.nsIUUIDGenerator);


/**
 * Open an overlay with the export dialog box on top
 * The dialog box has fields for:
 * 1. Bugzillas
 * 2. Tags
 * 3. Browsing history start/end dates
 * 4. Arbitrary notes
 * 5. Expected behavior
 * 6. Groundtruth (eval metadata) — currently: user_journey (expected behavior), tagged_memories, sensitive_topic_disclaimers, follow_ups, tools
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
      width: "720px",
      maxWidth: "90vw",
      maxHeight: "90vh",
      overflowY: "auto",
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

    const tagLabelRow = doc.createElement("div");
    Object.assign(tagLabelRow.style, { display: "flex", alignItems: "center", gap: "8px" });

    const tagLabel = doc.createElement("label");
    tagLabel.textContent = "Tags";
    Object.assign(tagLabel.style, fieldStyle);

    const tagAddBtn = doc.createElement("button");
    tagAddBtn.textContent = "+";
    Object.assign(tagAddBtn.style, {
      padding: "1px 7px",
      borderRadius: "4px",
      border: "1px solid #ccc",
      background: "#2c2c32",
      cursor: "pointer",
      fontSize: "13px",
    });

    tagLabelRow.append(tagLabel, tagAddBtn);

    const tagsContainer = doc.createElement("div");
    Object.assign(tagsContainer.style, { display: "flex", flexDirection: "column", gap: "6px" });

    const addTagRow = () => {
      const row = doc.createElement("div");
      Object.assign(row.style, { display: "flex", gap: "6px" });

      const input = doc.createElement("input");
      input.type = "text";
      input.placeholder = "Add a tag…";
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
        if (tagsContainer.children.length > 1) row.remove();
      });

      row.append(input, removeBtn);
      tagsContainer.appendChild(row);
      input.focus();
    };

    tagAddBtn.addEventListener("click", addTagRow);
    addTagRow();

    const DIALOG_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
    const DIALOG_ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
    const DIALOG_PRESET_MS = { "1h": 3600000, "4h": 14400000, "24h": 86400000, "3d": 259200000, "7d": 604800000, "30d": 2592000000 };

    // Per-tool, per-arg input formats. Keyed by tool name → arg name → format kind.
    // Drives custom input rendering and submit-time validation for special arg types.
    const TOOL_ARG_FORMATS = {
      search_browsing_history: { startTs: "iso-datetime", endTs: "iso-datetime" },
      get_page_content: { url_list: "string-list" },
    };
    const fmtLocal = d => {
      const pad = n => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const dateRangeLabel = doc.createElement("label");
    dateRangeLabel.textContent = "Browsing History";
    Object.assign(dateRangeLabel.style, fieldStyle);

    const presetSelect = doc.createElement("select");
    Object.assign(presetSelect.style, { ...inputStyle, background: "#2c2c32" });
    for (const [value, label] of [
      ["", "None"],
      ["1h", "Last 1 hour"],
      ["4h", "Last 4 hours"],
      ["24h", "Last 24 hours"],
      ["3d", "Last 3 days"],
      ["7d", "Last 7 days"],
      ["30d", "Last 30 days"],
      ["custom", "Custom range…"],
    ]) {
      const opt = doc.createElement("option");
      opt.value = value;
      opt.textContent = label;
      presetSelect.appendChild(opt);
    }

    const dateRow = doc.createElement("div");
    Object.assign(dateRow.style, { display: "none", gap: "8px", alignItems: "center" });

    const startInput = doc.createElement("input");
    startInput.type = "text";
    startInput.placeholder = "YYYY-MM-DD HH:MM";
    Object.assign(startInput.style, { ...inputStyle, flex: "1" });

    const dateSep = doc.createElement("span");
    dateSep.textContent = "–";
    Object.assign(dateSep.style, { fontSize: "13px", color: "#5b5b66", flexShrink: "0" });

    const endInput = doc.createElement("input");
    endInput.type = "text";
    endInput.placeholder = "YYYY-MM-DD HH:MM (optional)";
    Object.assign(endInput.style, { ...inputStyle, flex: "1" });

    const dateErrorMsg = doc.createElement("div");
    Object.assign(dateErrorMsg.style, { fontSize: "11px", color: "#a4000f", display: "none" });
    dateErrorMsg.textContent = "Use format YYYY-MM-DD HH:MM";

    dateRow.append(startInput, dateSep, endInput);

    presetSelect.addEventListener("change", () => {
      const isCustom = presetSelect.value === "custom";
      dateRow.style.display = isCustom ? "flex" : "none";
      if (!isCustom) {
        startInput.style.borderColor = "";
        endInput.style.borderColor = "";
        dateErrorMsg.style.display = "none";
      }
    });

    [startInput, endInput].forEach(el => {
      el.addEventListener("input", () => {
        el.style.borderColor = "";
        dateErrorMsg.style.display = "none";
      });
    });

    const notesLabel = doc.createElement("label");
    notesLabel.textContent = "Notes";
    Object.assign(notesLabel.style, fieldStyle);

    const textarea = doc.createElement("textarea");
    Object.assign(textarea.style, { ...inputStyle, height: "120px", resize: "vertical" });

    const expectedBehaviorTextarea = doc.createElement("textarea");
    Object.assign(expectedBehaviorTextarea.style, { ...inputStyle, height: "120px", resize: "vertical" });

    const groundtruthSection = doc.createElement("details");
    groundtruthSection.open = true;
    Object.assign(groundtruthSection.style, {
      border: "1px solid #d0d0d8",
      borderRadius: "4px",
      padding: "6px 10px",
      background: "#f8f8fb",
    });

    const groundtruthSummary = doc.createElement("summary");
    groundtruthSummary.textContent = "Expected Behavior";
    Object.assign(groundtruthSummary.style, {
      fontWeight: "600",
      fontSize: "13px",
      cursor: "pointer",
      color: "#0c0c0d",
      padding: "2px 0",
    });

    const userJourneySection = doc.createElement("details");
    userJourneySection.open = true;
    Object.assign(userJourneySection.style, { marginTop: "8px", paddingLeft: "4px" });

    const userJourneySummary = doc.createElement("summary");
    userJourneySummary.textContent = "User Journey";
    Object.assign(userJourneySummary.style, {
      fontWeight: "500",
      fontSize: "12px",
      cursor: "pointer",
      color: "#1c1b22",
      padding: "2px 0",
    });

    const userJourneyExpectedLabel = doc.createElement("label");
    userJourneyExpectedLabel.textContent = "Expected behavior";
    Object.assign(userJourneyExpectedLabel.style, {
      display: "block",
      fontWeight: "500",
      fontSize: "12px",
      color: "#1c1b22",
      marginTop: "6px",
      marginBottom: "4px",
    });

    userJourneySection.append(userJourneySummary, userJourneyExpectedLabel, expectedBehaviorTextarea);

    const taggedMemoriesSection = doc.createElement("details");
    Object.assign(taggedMemoriesSection.style, { marginTop: "8px", paddingLeft: "4px" });

    const taggedMemoriesSummary = doc.createElement("summary");
    taggedMemoriesSummary.textContent = "Tagged Memories";
    Object.assign(taggedMemoriesSummary.style, {
      fontWeight: "500",
      fontSize: "12px",
      cursor: "pointer",
      color: "#1c1b22",
      padding: "2px 0",
    });

    const taggedMemoriesContainer = doc.createElement("div");
    Object.assign(taggedMemoriesContainer.style, {
      marginTop: "6px",
      maxHeight: "180px",
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: "4px",
    });

    const taggedMemoriesPlaceholder = doc.createElement("div");
    taggedMemoriesPlaceholder.textContent = "Loading memories…";
    Object.assign(taggedMemoriesPlaceholder.style, {
      fontSize: "12px",
      color: "#5b5b66",
      fontStyle: "italic",
    });
    taggedMemoriesContainer.appendChild(taggedMemoriesPlaceholder);

    taggedMemoriesSection.append(taggedMemoriesSummary, taggedMemoriesContainer);

    const sensitiveTopicSection = doc.createElement("details");
    Object.assign(sensitiveTopicSection.style, { marginTop: "8px", paddingLeft: "4px" });

    const sensitiveTopicSummary = doc.createElement("summary");
    sensitiveTopicSummary.textContent = "Sensitive Topic";
    Object.assign(sensitiveTopicSummary.style, {
      fontWeight: "500",
      fontSize: "12px",
      cursor: "pointer",
      color: "#1c1b22",
      padding: "2px 0",
    });

    const sensitiveTopicRow = doc.createElement("div");
    Object.assign(sensitiveTopicRow.style, {
      marginTop: "6px",
      display: "flex",
      alignItems: "flex-start",
      gap: "6px",
      fontSize: "12px",
      lineHeight: "1.3",
    });

    const sensitiveTopicCheckbox = doc.createElement("input");
    sensitiveTopicCheckbox.type = "checkbox";
    Object.assign(sensitiveTopicCheckbox.style, { margin: "2px 0 0 0", flexShrink: "0" });

    const sensitiveTopicLabel = doc.createElement("label");
    sensitiveTopicLabel.textContent = "Mark this turn as sensitive.";
    Object.assign(sensitiveTopicLabel.style, { margin: "0", fontWeight: "400", color: "#1c1b22", cursor: "pointer" });
    sensitiveTopicLabel.addEventListener("click", () => sensitiveTopicCheckbox.click());

    sensitiveTopicRow.append(sensitiveTopicCheckbox, sensitiveTopicLabel);
    sensitiveTopicSection.append(sensitiveTopicSummary, sensitiveTopicRow);

    const followupsSection = doc.createElement("details");
    Object.assign(followupsSection.style, { marginTop: "8px", paddingLeft: "4px" });

    const followupsSummary = doc.createElement("summary");
    followupsSummary.textContent = "Follow-ups";
    Object.assign(followupsSummary.style, {
      fontWeight: "500",
      fontSize: "12px",
      cursor: "pointer",
      color: "#1c1b22",
      padding: "2px 0",
    });

    const followupsRow = doc.createElement("div");
    Object.assign(followupsRow.style, {
      marginTop: "6px",
      display: "flex",
      alignItems: "flex-start",
      gap: "6px",
      fontSize: "12px",
      lineHeight: "1.3",
    });

    const followupsCheckbox = doc.createElement("input");
    followupsCheckbox.type = "checkbox";
    Object.assign(followupsCheckbox.style, { margin: "2px 0 0 0", flexShrink: "0" });

    const followupsLabel = doc.createElement("label");
    followupsLabel.textContent = "Expect follow-up suggestions on this turn.";
    Object.assign(followupsLabel.style, { margin: "0", fontWeight: "400", color: "#1c1b22", cursor: "pointer" });
    followupsLabel.addEventListener("click", () => followupsCheckbox.click());

    followupsRow.append(followupsCheckbox, followupsLabel);
    followupsSection.append(followupsSummary, followupsRow);

    const toolsSection = doc.createElement("details");
    Object.assign(toolsSection.style, { marginTop: "8px", paddingLeft: "4px" });

    const toolsSummary = doc.createElement("summary");
    toolsSummary.textContent = "Tools";
    Object.assign(toolsSummary.style, {
      fontWeight: "500",
      fontSize: "12px",
      cursor: "pointer",
      color: "#1c1b22",
      padding: "2px 0",
    });

    const toolsContainer = doc.createElement("div");
    Object.assign(toolsContainer.style, {
      marginTop: "6px",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    });

    const toolsPlaceholder = doc.createElement("div");
    toolsPlaceholder.textContent = "Loading tools…";
    Object.assign(toolsPlaceholder.style, { fontSize: "12px", color: "#5b5b66", fontStyle: "italic" });
    toolsContainer.appendChild(toolsPlaceholder);

    const toolsAddBtn = doc.createElement("button");
    toolsAddBtn.textContent = "+ Add tool";
    toolsAddBtn.hidden = true;
    Object.assign(toolsAddBtn.style, {
      marginTop: "8px",
      padding: "1px 7px",
      borderRadius: "4px",
      border: "1px solid #ccc",
      background: "#2c2c32",
      cursor: "pointer",
      fontSize: "12px",
      alignSelf: "flex-start",
    });

    toolsSection.append(toolsSummary, toolsContainer, toolsAddBtn);

    let availableTools = [];

    const addStringListRowDialog = (container, value = "") => {
      const row = doc.createElement("div");
      Object.assign(row.style, { display: "flex", gap: "6px" });

      const input = doc.createElement("input");
      input.type = "text";
      input.className = "string-list-input";
      input.value = value;
      Object.assign(input.style, { ...inputStyle, flex: "1", padding: "4px 6px", fontSize: "12px" });

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
        if (container.children.length > 1) row.remove();
      });

      row.append(input, removeBtn);
      container.appendChild(row);
      return input;
    };

    const buildArgInputDialog = (arg, toolName) => {
      const format = TOOL_ARG_FORMATS[toolName]?.[arg.name];
      if (format === "iso-datetime") {
        const input = doc.createElement("input");
        input.type = "text";
        input.placeholder = "YYYY-MM-DDTHH:MM:SS";
        Object.assign(input.style, { ...inputStyle, padding: "4px 6px", fontSize: "12px" });
        return { el: input, kind: "iso-datetime" };
      }
      if (format === "string-list") {
        const rowsWrap = doc.createElement("div");
        rowsWrap.className = "string-list-rows";
        Object.assign(rowsWrap.style, { display: "flex", flexDirection: "column", gap: "4px" });
        addStringListRowDialog(rowsWrap);
        return { el: rowsWrap, kind: "string-list" };
      }
      if (arg.enum && Array.isArray(arg.enum)) {
        const select = doc.createElement("select");
        Object.assign(select.style, { ...inputStyle, padding: "4px 6px", fontSize: "12px" });
        const blank = doc.createElement("option");
        blank.value = "";
        blank.textContent = arg.required ? "Select…" : "(omit)";
        select.appendChild(blank);
        for (const v of arg.enum) {
          const opt = doc.createElement("option");
          opt.value = String(v);
          opt.textContent = String(v);
          select.appendChild(opt);
        }
        return { el: select, kind: "string" };
      }
      if (arg.type === "boolean") {
        const input = doc.createElement("input");
        input.type = "checkbox";
        return { el: input, kind: "boolean" };
      }
      if (arg.type === "number" || arg.type === "integer") {
        const input = doc.createElement("input");
        input.type = "number";
        if (arg.type === "integer") input.step = "1";
        Object.assign(input.style, { ...inputStyle, padding: "4px 6px", fontSize: "12px" });
        return { el: input, kind: "number" };
      }
      if (arg.type === "object" || arg.type === "array") {
        const textarea = doc.createElement("textarea");
        textarea.rows = 2;
        textarea.placeholder = arg.type === "array" ? "[…] (JSON)" : "{…} (JSON)";
        Object.assign(textarea.style, { ...inputStyle, padding: "4px 6px", fontSize: "12px", resize: "vertical" });
        return { el: textarea, kind: "json" };
      }
      const input = doc.createElement("input");
      input.type = "text";
      Object.assign(input.style, { ...inputStyle, padding: "4px 6px", fontSize: "12px" });
      return { el: input, kind: "string" };
    };

    const renderToolArgsDialog = (tool, argsWrap) => {
      argsWrap.replaceChildren();
      for (const arg of tool.args) {
        const wrap = doc.createElement("div");
        wrap.className = "tool-arg";
        Object.assign(wrap.style, { display: "flex", flexDirection: "column", gap: "2px" });

        const { el, kind } = buildArgInputDialog(arg, tool.name);
        el.dataset.argName = arg.name;
        el.dataset.argKind = kind;
        if (arg.required) el.dataset.argRequired = "true";

        const label = doc.createElement("label");
        label.textContent = arg.name + (arg.required ? " *" : "");
        Object.assign(label.style, { fontSize: "11px", fontWeight: "500", color: "#1c1b22" });

        if (kind === "boolean") {
          Object.assign(wrap.style, { flexDirection: "row", alignItems: "center", gap: "6px" });
          wrap.append(el, label);
        } else if (kind === "string-list") {
          const labelRow = doc.createElement("div");
          Object.assign(labelRow.style, { display: "flex", alignItems: "center", gap: "6px" });
          const addBtn = doc.createElement("button");
          addBtn.textContent = "+";
          Object.assign(addBtn.style, {
            padding: "1px 7px",
            borderRadius: "4px",
            border: "1px solid #ccc",
            background: "#2c2c32",
            cursor: "pointer",
            fontSize: "13px",
          });
          addBtn.addEventListener("click", () => addStringListRowDialog(el).focus());
          labelRow.append(label, addBtn);
          wrap.appendChild(labelRow);
          if (arg.description) {
            const desc = doc.createElement("div");
            desc.textContent = arg.description;
            Object.assign(desc.style, { fontSize: "10px", color: "#5b5b66" });
            wrap.appendChild(desc);
          }
          wrap.appendChild(el);
        } else {
          wrap.appendChild(label);
          if (arg.description) {
            const desc = doc.createElement("div");
            desc.textContent = arg.description;
            Object.assign(desc.style, { fontSize: "10px", color: "#5b5b66" });
            wrap.appendChild(desc);
          }
          wrap.appendChild(el);
        }

        if (kind !== "boolean") {
          const err = doc.createElement("div");
          err.className = "tool-arg-error";
          Object.assign(err.style, { fontSize: "10px", color: "#a4000f", display: "none", marginTop: "2px" });
          wrap.appendChild(err);
          wrap.addEventListener("input", () => {
            el.style.borderColor = "";
            err.style.display = "none";
          });
        }

        argsWrap.appendChild(wrap);
      }
    };

    const addToolRowDialog = () => {
      const row = doc.createElement("div");
      Object.assign(row.style, {
        border: "1px solid #d0d0d8",
        borderRadius: "4px",
        padding: "6px 8px",
        background: "#fff",
      });

      const header = doc.createElement("div");
      Object.assign(header.style, { display: "flex", gap: "6px", alignItems: "center" });

      const select = doc.createElement("select");
      select.className = "tool-select";
      Object.assign(select.style, { ...inputStyle, flex: "1", padding: "4px 6px", fontSize: "12px", color: "#0c0c0d" });
      const blank = doc.createElement("option");
      blank.value = "";
      blank.textContent = "Select a tool…";
      select.appendChild(blank);
      for (const tool of availableTools) {
        const opt = doc.createElement("option");
        opt.value = tool.name;
        opt.textContent = tool.name;
        select.appendChild(opt);
      }

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
      removeBtn.addEventListener("click", () => row.remove());

      header.append(select, removeBtn);

      const argsWrap = doc.createElement("div");
      argsWrap.className = "tool-args";
      Object.assign(argsWrap.style, { display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" });

      select.addEventListener("change", () => {
        const tool = availableTools.find(t => t.name === select.value);
        if (tool) renderToolArgsDialog(tool, argsWrap);
        else argsWrap.replaceChildren();
      });

      row.append(header, argsWrap);
      row.classList.add("tool-row");
      toolsContainer.appendChild(row);
    };

    toolsAddBtn.addEventListener("click", addToolRowDialog);

    groundtruthSection.append(groundtruthSummary, userJourneySection, taggedMemoriesSection, sensitiveTopicSection, followupsSection, toolsSection);

    (async () => {
      try {
        const memories = await lazy.MemoriesManager.getAllMemories();
        taggedMemoriesContainer.replaceChildren();
        if (!memories.length) {
          const empty = doc.createElement("div");
          empty.textContent = "No memories stored.";
          Object.assign(empty.style, { fontSize: "12px", color: "#5b5b66", fontStyle: "italic" });
          taggedMemoriesContainer.appendChild(empty);
          return;
        }
        for (const memory of memories) {
          const row = doc.createElement("div");
          Object.assign(row.style, {
            display: "flex",
            alignItems: "flex-start",
            gap: "6px",
            fontSize: "12px",
            lineHeight: "1.3",
          });
          const checkbox = doc.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "tagged-memory-input";
          checkbox.value = memory.id;
          Object.assign(checkbox.style, { margin: "2px 0 0 0", flexShrink: "0" });
          const label = doc.createElement("label");
          label.textContent = memory.memory_summary;
          Object.assign(label.style, { margin: "0", fontWeight: "400", color: "#1c1b22", cursor: "pointer" });
          label.addEventListener("click", () => checkbox.click());
          row.append(checkbox, label);
          taggedMemoriesContainer.appendChild(row);
        }
      } catch (err) {
        taggedMemoriesContainer.replaceChildren();
        const errEl = doc.createElement("div");
        errEl.textContent = `Failed to load memories: ${err.message}`;
        Object.assign(errEl.style, { fontSize: "12px", color: "#a4000f", fontStyle: "italic" });
        taggedMemoriesContainer.appendChild(errEl);
      }
    })();

    (async () => {
      try {
        availableTools = normalizeToolsConfig(lazy.toolsConfig);
        const userMessageCount = await countUserMessages();
        applyConditionalRequiredDialog(availableTools, { userMessageCount });
        toolsContainer.replaceChildren();
        if (!availableTools.length) {
          const empty = doc.createElement("div");
          empty.textContent = "No tools available.";
          Object.assign(empty.style, { fontSize: "12px", color: "#5b5b66", fontStyle: "italic" });
          toolsContainer.appendChild(empty);
          return;
        }
        toolsAddBtn.hidden = false;
      } catch (err) {
        toolsContainer.replaceChildren();
        const errEl = doc.createElement("div");
        errEl.textContent = `Failed to load tools: ${err.message}`;
        Object.assign(errEl.style, { fontSize: "12px", color: "#a4000f", fontStyle: "italic" });
        toolsContainer.appendChild(errEl);
      }
    })();

    // Conversation snapshots the basic view pre-fills from. Both are
    // fetched once on dialog open; they stay null until their fetches
    // resolve.
    //   - compactedConversation: openAI-format messages (post-PromptOptimizer)
    //   - rawConversation: raw ChatConversation.messages, used for
    //     tagged-memories pre-fill (carries per-message `memoriesApplied`
    //     metadata that's lost in the openAI-format conversion).
    let compactedConversation = null;
    let rawConversation = null;
    const compactedConversationReady = (async () => {
      try {
        compactedConversation = await getCompactedConversation();
        rawConversation = getRawConversation();
        await basicMemoriesReady;
        prefillBasicView(compactedConversation, rawConversation);
      } catch (err) {
        console.warn("[smartwindow] failed to load conversation snapshots:", err);
        compactedConversation = compactedConversation ?? [];
        rawConversation = rawConversation ?? [];
      }
    })();

    // Pre-fill the basic view's question answers based on what the assistant
    // actually did in response to the last user turn. Mirrors prefillBasicView
    // in popup.js but targets the dialog's locally-built elements.
    const SENSITIVE_TOPIC_DISCLAIMER = "This is not professional advice, but here's how to think about it.";

    const prefillBasicView = (compacted, raw) => {
      const postMessages = getPostUserAssistantToolMessages(compacted);
      const userMessageCount = compacted.filter(m => m?.role === "user").length;

      // Tagged-memories + follow-ups questions both inspect the *raw*
      // conversation's post-last-user assistant messages (the openAI-format
      // conversion drops `memoriesApplied` and `followUpSuggestions`).
      const postUserRawAssistants = getPostUserRawAssistantMessages(raw);

      // Tagged-memories: collect every memoriesApplied[].id and check
      // matching memory rows (plus the main box and reveal the sub-list so
      // the user sees the pre-fill).
      const appliedIds = new Set();
      for (const msg of postUserRawAssistants) {
        if (!Array.isArray(msg.memoriesApplied)) continue;
        for (const mem of msg.memoriesApplied) {
          if (mem?.id) appliedIds.add(mem.id);
        }
      }
      if (appliedIds.size) {
        basicTaggedMemoriesCheckbox.checked = true;
        basicTaggedMemoriesSub.style.display = "flex";
        for (const cb of basicTaggedMemoriesList.querySelectorAll(".basic-memory-input")) {
          if (appliedIds.has(cb.value)) cb.checked = true;
        }
      }

      // Follow-ups: if any of those assistant messages has a non-empty
      // followUpSuggestions list, check the box.
      const hasFollowups = postUserRawAssistants.some(
        m => Array.isArray(m.followUpSuggestions) && m.followUpSuggestions.length
      );
      if (hasFollowups) {
        basicFollowupsCheckbox.checked = true;
      }

      // Sensitive-topic question: if any assistant message after the last
      // user turn includes the disclaimer string, check the box.
      const disclaimerSeen = postMessages.some(
        m => m?.role === "assistant"
          && typeof m.content === "string"
          && m.content.includes(SENSITIVE_TOPIC_DISCLAIMER)
      );
      if (disclaimerSeen) {
        basicSensitiveTopicCheckbox.checked = true;
      }

      // Web-search question: was run_search called? → check the box. On turns
      // 2+, also reveal the sub-input and pre-fill the query from the tool
      // call. The `query` arg is only expected on follow-up turns, so on the
      // first user turn we leave the sub-question hidden.
      const runSearchArgs = getToolCallArgs(postMessages, "run_search");
      if (runSearchArgs) {
        webSearchCheckbox.checked = true;
        if (userMessageCount >= 2) {
          webSearchSub.style.display = "flex";
          if (typeof runSearchArgs.query === "string" && runSearchArgs.query.trim()) {
            searchQueryInput.value = runSearchArgs.query;
          }
        }
      }

      // Open-tabs question: was get_open_tabs called? → check the main box
      // and reveal the tab sub-list.
      if (getToolCallArgs(postMessages, "get_open_tabs")) {
        openTabsCheckbox.checked = true;
        openTabsSub.style.display = "flex";
      }

      // Aggregate every URL the assistant tried to fetch via get_page_content
      // across all such calls in this turn, then split by whether it's
      // currently open in a tab:
      //   - Matches an open tab → check that tab's checkbox under Q3
      //   - Not in any open tab → pre-fill Q4 (other pages) URL inputs
      const pageContentCalls = getAllToolCallArgs(postMessages, "get_page_content");
      const requestedUrls = pageContentCalls
        .flatMap(args => Array.isArray(args?.url_list) ? args.url_list : [])
        .filter(u => typeof u === "string" && u.trim());

      if (requestedUrls.length) {
        const openTabUrls = new Set(
          Array.from(openTabsList.querySelectorAll(".basic-tab-input"))
            .map(cb => cb.dataset.url)
            .filter(Boolean)
        );

        const seen = new Set();
        const matchingTabUrls = new Set();
        const otherUrls = [];
        for (const url of requestedUrls) {
          if (seen.has(url)) continue;
          seen.add(url);
          if (openTabUrls.has(url)) matchingTabUrls.add(url);
          else otherUrls.push(url);
        }

        // Q3: check matching tab checkboxes.
        if (matchingTabUrls.size) {
          for (const cb of openTabsList.querySelectorAll(".basic-tab-input")) {
            if (matchingTabUrls.has(cb.dataset.url)) cb.checked = true;
          }
        }

        // Q4: pre-fill non-tab URLs into the input rows, check the box,
        // reveal the sub-section. The first row already exists from
        // addOtherPageRowDialog()'s initial call; use it for the first URL
        // and add new rows for the rest.
        if (otherUrls.length) {
          const firstInput = otherPagesContainer.querySelector(".basic-other-page-input");
          firstInput.value = otherUrls[0];
          for (let i = 1; i < otherUrls.length; i++) {
            addOtherPageRowDialog();
            const newInput = otherPagesContainer.lastElementChild.querySelector("input");
            newInput.value = otherUrls[i];
          }
          otherPagesCheckbox.checked = true;
          otherPagesSub.style.display = "flex";
        }
      }

      // Browsing-history question: was search_browsing_history called? →
      // check the box, reveal the sub-section, and pre-fill any of
      // searchTerm / startTs / endTs that the tool call carried.
      const historyArgs = getToolCallArgs(postMessages, "search_browsing_history");
      if (historyArgs) {
        historyCheckbox.checked = true;
        historySub.style.display = "flex";
        if (typeof historyArgs.searchTerm === "string" && historyArgs.searchTerm.trim()) {
          historySearchTermInput.value = historyArgs.searchTerm;
        }
        if (typeof historyArgs.startTs === "string" && historyArgs.startTs.trim()) {
          historyStartTsInput.value = historyArgs.startTs;
        }
        if (typeof historyArgs.endTs === "string" && historyArgs.endTs.trim()) {
          historyEndTsInput.value = historyArgs.endTs;
        }
      }
    };

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
    saveBtn.addEventListener("click", () => {
      let startDate = "", endDate = "";
      const preset = presetSelect.value;
      if (preset === "custom") {
        const startVal = startInput.value.trim();
        const endVal = endInput.value.trim();
        let valid = true;
        if (!DIALOG_DATETIME_RE.test(startVal)) { startInput.style.borderColor = "#e22850"; valid = false; }
        else startInput.style.borderColor = "";
        if (endVal && !DIALOG_DATETIME_RE.test(endVal)) { endInput.style.borderColor = "#e22850"; valid = false; }
        else endInput.style.borderColor = "";
        if (!valid) { dateErrorMsg.style.display = "block"; return; }
        startDate = startVal;
        endDate = endVal;
      } else if (preset) {
        const now = new Date();
        startDate = fmtLocal(new Date(now - DIALOG_PRESET_MS[preset]));
        endDate = fmtLocal(now);
      }

      // Validate tool-arg inputs (required + iso-datetime format) before resolving.
      const isArgEmptyDialog = el => {
        const kind = el.dataset.argKind;
        if (kind === "boolean") return false;
        if (kind === "string-list") {
          return Array.from(el.querySelectorAll(".string-list-input"))
            .every(i => !i.value.trim());
        }
        return !el.value.trim();
      };
      let toolsValid = true;
      for (const el of toolsContainer.querySelectorAll("[data-arg-name]")) {
        const wrap = el.closest(".tool-arg");
        const errEl = wrap?.querySelector(".tool-arg-error");
        const required = el.dataset.argRequired === "true";
        const kind = el.dataset.argKind;
        let error = null;
        if (required && isArgEmptyDialog(el)) {
          error = "This field is required.";
        } else if (kind === "iso-datetime") {
          const v = el.value.trim();
          if (v && !DIALOG_ISO_DATETIME_RE.test(v)) error = "Use format YYYY-MM-DDTHH:MM:SS";
        }
        if (error) {
          if (kind === "iso-datetime") el.style.borderColor = "#e22850";
          if (errEl) {
            errEl.textContent = error;
            errEl.style.display = "block";
          }
          toolsValid = false;
        } else {
          el.style.borderColor = "";
          if (errEl) errEl.style.display = "none";
        }
      }
      if (!toolsValid) return;

      const taggedMemoryIds = Array.from(
        taggedMemoriesContainer.querySelectorAll(".tagged-memory-input")
      ).filter(cb => cb.checked).map(cb => cb.value);

      const collectToolValueDialog = el => {
        const kind = el.dataset.argKind;
        if (kind === "boolean") return el.checked;
        if (kind === "string-list") {
          const values = Array.from(el.querySelectorAll(".string-list-input"))
            .map(i => i.value.trim())
            .filter(Boolean);
          return values.length ? values : undefined;
        }
        const raw = el.value.trim();
        if (raw === "") return undefined;
        if (kind === "number") {
          const n = Number(raw);
          return Number.isNaN(n) ? undefined : n;
        }
        if (kind === "json") {
          try { return JSON.parse(raw); } catch { return raw; }
        }
        return raw;
      };
      const toolsGT = [];
      for (const row of toolsContainer.querySelectorAll(".tool-row")) {
        const name = row.querySelector(".tool-select")?.value;
        if (!name) continue;
        const args = {};
        for (const el of row.querySelectorAll(".tool-args [data-arg-name]")) {
          const value = collectToolValueDialog(el);
          if (value !== undefined) args[el.dataset.argName] = value;
        }
        toolsGT.push({ name, args });
      }

      const groundtruth = {};
      if (taggedMemoryIds.length) groundtruth.tagged_memories = taggedMemoryIds;
      if (sensitiveTopicCheckbox.checked) {
        groundtruth.sensitive_topic_disclaimers = { is_sensitive: true };
      }
      if (followupsCheckbox.checked) groundtruth.followups = [];
      if (toolsGT.length) groundtruth.tools = toolsGT;
      const expectedBehaviorTrimmed = expectedBehaviorTextarea.value.trim();
      if (expectedBehaviorTrimmed) {
        groundtruth.user_journey = { expected_behavior: expectedBehaviorTrimmed };
      }

      finish({
        mode: "expert",
        notes: textarea.value,
        bugzillaUrls: Array.from(bugUrlsContainer.querySelectorAll("input"))
          .map(i => i.value.trim())
          .filter(Boolean),
        tags: Array.from(tagsContainer.querySelectorAll("input"))
          .map(i => i.value.trim())
          .filter(Boolean),
        groundtruth: Object.keys(groundtruth).length ? groundtruth : null,
        startDate,
        endDate,
      });
    });
    overlay.addEventListener("keydown", e => {
      if (e.key === "Escape") finish(null);
    });

    btnRow.append(cancelBtn, saveBtn);

    const dialogHeader = doc.createElement("div");
    Object.assign(dialogHeader.style, {
      display: "flex",
      justifyContent: "flex-end",
      alignItems: "center",
    });

    const expertToggleLabel = doc.createElement("label");
    Object.assign(expertToggleLabel.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "12px",
      fontWeight: "500",
      color: "#1c1b22",
      cursor: "pointer",
      margin: "0",
    });

    const expertToggleText = doc.createElement("span");
    expertToggleText.textContent = "Expert mode";

    // Build the toggle switch with inline styles only — pseudo-elements and
    // :checked sibling selectors don't work reliably when style sheets are
    // injected into chrome:// documents, so the thumb position and track
    // color are updated imperatively on `change`.
    const expertToggleSwitch = doc.createElement("span");
    Object.assign(expertToggleSwitch.style, {
      position: "relative",
      display: "inline-block",
      width: "32px",
      height: "18px",
      flexShrink: "0",
      background: "#c0c0c8",
      borderRadius: "18px",
      transition: "background-color 0.15s ease",
    });

    const expertToggleCheckbox = doc.createElement("input");
    expertToggleCheckbox.type = "checkbox";
    expertToggleCheckbox.id = "expert-mode-toggle";
    Object.assign(expertToggleCheckbox.style, {
      position: "absolute",
      opacity: "0",
      width: "100%",
      height: "100%",
      margin: "0",
      cursor: "pointer",
      zIndex: "1",
    });

    const expertToggleThumb = doc.createElement("span");
    Object.assign(expertToggleThumb.style, {
      position: "absolute",
      height: "14px",
      width: "14px",
      left: "2px",
      top: "2px",
      background: "#fff",
      borderRadius: "50%",
      transition: "left 0.15s ease",
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.2)",
    });

    expertToggleCheckbox.addEventListener("change", () => {
      const on = expertToggleCheckbox.checked;
      expertToggleSwitch.style.background = on ? "#0060df" : "#c0c0c8";
      expertToggleThumb.style.left = on ? "16px" : "2px";
      expertView.style.display = on ? "flex" : "none";
      basicView.style.display = on ? "none" : "flex";
    });

    expertToggleSwitch.append(expertToggleCheckbox, expertToggleThumb);
    expertToggleLabel.append(expertToggleText, expertToggleSwitch);
    dialogHeader.appendChild(expertToggleLabel);

    const columnsWrapper = doc.createElement("div");
    Object.assign(columnsWrapper.style, {
      display: "flex",
      gap: "16px",
      alignItems: "flex-start",
    });

    const leftColumn = doc.createElement("div");
    Object.assign(leftColumn.style, {
      flex: "1",
      minWidth: "0",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    });

    const rightColumn = doc.createElement("div");
    Object.assign(rightColumn.style, {
      flex: "1",
      minWidth: "0",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    });

    leftColumn.append(bugLabelRow, bugUrlsContainer, tagLabelRow, tagsContainer, dateRangeLabel, presetSelect, dateRow, dateErrorMsg, notesLabel, textarea);
    rightColumn.append(groundtruthSection);
    columnsWrapper.append(leftColumn, rightColumn);

    const expertView = doc.createElement("div");
    Object.assign(expertView.style, {
      display: "none",
      flexDirection: "column",
      gap: "12px",
    });
    expertView.append(columnsWrapper, btnRow);

    // Basic (non-expert) view — shown by default. Questions here map to
    // pieces of `groundtruth` in the export; see collectBasicSmartWindowData.
    const basicView = doc.createElement("div");
    Object.assign(basicView.style, {
      display: "flex",
      flexDirection: "column",
      gap: "14px",
    });

    const basicContent = doc.createElement("div");
    Object.assign(basicContent.style, {
      display: "flex",
      flexDirection: "column",
      gap: "14px",
    });

    // Q: "Write 1 to 3 sentences describing what you expected…"
    //   Maps to groundtruth.user_journey.expected_behavior
    const expectedBehaviorWrap = doc.createElement("div");
    Object.assign(expectedBehaviorWrap.style, { display: "flex", flexDirection: "column", gap: "8px" });

    const expectedBehaviorLabel = doc.createElement("label");
    expectedBehaviorLabel.setAttribute("for", "basic-q-expected-behavior");
    expectedBehaviorLabel.textContent = "Write 1 to 3 sentences describing what you expected the SmartWindow assistant to do";
    Object.assign(expectedBehaviorLabel.style, {
      fontSize: "13px",
      fontWeight: "500",
      color: "#1c1b22",
      lineHeight: "1.4",
      margin: "0",
    });

    const basicExpectedBehaviorTextarea = doc.createElement("textarea");
    basicExpectedBehaviorTextarea.id = "basic-q-expected-behavior";
    basicExpectedBehaviorTextarea.rows = 3;
    basicExpectedBehaviorTextarea.placeholder = "I expected the assistant to…";
    Object.assign(basicExpectedBehaviorTextarea.style, { ...inputStyle, fontSize: "13px", resize: "vertical" });

    expectedBehaviorWrap.append(expectedBehaviorLabel, basicExpectedBehaviorTextarea);
    basicContent.append(expectedBehaviorWrap);

    // Q: "Did you expect the assistant to mention any of these topics it has
    //  learned about you?" → groundtruth.tagged_memories = [memoryId, ...]
    //  (Locals prefixed with `basic` to avoid colliding with the expert
    //   view's taggedMemoriesSection / taggedMemoriesContainer / etc.)
    const basicTaggedMemoriesWrap = doc.createElement("div");
    Object.assign(basicTaggedMemoriesWrap.style, { display: "flex", flexDirection: "column", gap: "8px" });

    const basicTaggedMemoriesRow = doc.createElement("div");
    Object.assign(basicTaggedMemoriesRow.style, {
      display: "flex",
      alignItems: "flex-start",
      gap: "8px",
      fontSize: "13px",
      lineHeight: "1.4",
    });

    const basicTaggedMemoriesCheckbox = doc.createElement("input");
    basicTaggedMemoriesCheckbox.type = "checkbox";
    basicTaggedMemoriesCheckbox.id = "basic-q-tagged-memories";
    Object.assign(basicTaggedMemoriesCheckbox.style, { margin: "3px 0 0 0", flexShrink: "0" });

    const basicTaggedMemoriesLabel = doc.createElement("label");
    basicTaggedMemoriesLabel.setAttribute("for", "basic-q-tagged-memories");
    basicTaggedMemoriesLabel.textContent = "Did you expect the assistant to mention any of the topics below that it has learned about you?";
    Object.assign(basicTaggedMemoriesLabel.style, { margin: "0", fontWeight: "500", color: "#1c1b22", cursor: "pointer" });

    basicTaggedMemoriesRow.append(basicTaggedMemoriesCheckbox, basicTaggedMemoriesLabel);

    const basicTaggedMemoriesSub = doc.createElement("div");
    Object.assign(basicTaggedMemoriesSub.style, {
      display: "none",
      flexDirection: "column",
      gap: "4px",
      marginLeft: "24px",
      paddingLeft: "8px",
      borderLeft: "2px solid #d0d0d8",
    });

    const basicTaggedMemoriesList = doc.createElement("div");
    Object.assign(basicTaggedMemoriesList.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      maxHeight: "180px",
      overflowY: "auto",
    });

    const basicTaggedMemoriesPlaceholder = doc.createElement("div");
    basicTaggedMemoriesPlaceholder.textContent = "Loading memories…";
    Object.assign(basicTaggedMemoriesPlaceholder.style, { fontSize: "12px", color: "#5b5b66", fontStyle: "italic" });
    basicTaggedMemoriesList.appendChild(basicTaggedMemoriesPlaceholder);

    basicTaggedMemoriesSub.append(basicTaggedMemoriesList);

    basicTaggedMemoriesCheckbox.addEventListener("change", () => {
      basicTaggedMemoriesSub.style.display = basicTaggedMemoriesCheckbox.checked ? "flex" : "none";
    });

    basicTaggedMemoriesWrap.append(basicTaggedMemoriesRow, basicTaggedMemoriesSub);
    basicContent.append(basicTaggedMemoriesWrap);

    // Load memories asynchronously (same source the expert view uses) and
    // render checkbox rows. Captured in a promise so the basic-view pre-fill
    // can wait for the rows to exist before flipping them.
    const basicMemoriesReady = (async () => {
      try {
        const memories = await lazy.MemoriesManager.getAllMemories();
        basicTaggedMemoriesList.replaceChildren();
        if (!memories.length) {
          const empty = doc.createElement("div");
          empty.textContent = "No memories stored.";
          Object.assign(empty.style, { fontSize: "12px", color: "#5b5b66", fontStyle: "italic" });
          basicTaggedMemoriesList.appendChild(empty);
          return;
        }
        for (const memory of memories) {
          const row = doc.createElement("div");
          Object.assign(row.style, {
            display: "flex",
            alignItems: "flex-start",
            gap: "6px",
            fontSize: "12px",
            lineHeight: "1.3",
          });
          const cb = doc.createElement("input");
          cb.type = "checkbox";
          cb.className = "basic-memory-input";
          cb.value = memory.id;
          Object.assign(cb.style, { margin: "2px 0 0 0", flexShrink: "0" });
          const label = doc.createElement("label");
          label.textContent = memory.memory_summary;
          Object.assign(label.style, { margin: "0", fontWeight: "400", color: "#1c1b22", cursor: "pointer" });
          label.addEventListener("click", () => cb.click());
          row.append(cb, label);
          basicTaggedMemoriesList.appendChild(row);
        }
      } catch (err) {
        basicTaggedMemoriesList.replaceChildren();
        const errEl = doc.createElement("div");
        errEl.textContent = `Failed to load memories: ${err.message}`;
        Object.assign(errEl.style, { fontSize: "12px", color: "#a4000f", fontStyle: "italic" });
        basicTaggedMemoriesList.appendChild(errEl);
      }
    })();

    // Q: "Did you ask about a topic that would require consulting a professional?"
    //   Maps to groundtruth.sensitive_topic_disclaimers = { is_sensitive: true }
    //   (Just a checkbox — no sub-fields. All locals here are `basic`-prefixed
    //    to avoid colliding with the expert view's sensitiveTopic* variables
    //    (sensitiveTopicSection, sensitiveTopicRow, sensitiveTopicCheckbox, …)
    //    declared in the same function scope.)
    const basicSensitiveTopicWrap = doc.createElement("div");
    Object.assign(basicSensitiveTopicWrap.style, { display: "flex", flexDirection: "column", gap: "8px" });

    const basicSensitiveTopicRow = doc.createElement("div");
    Object.assign(basicSensitiveTopicRow.style, {
      display: "flex",
      alignItems: "flex-start",
      gap: "8px",
      fontSize: "13px",
      lineHeight: "1.4",
    });

    const basicSensitiveTopicCheckbox = doc.createElement("input");
    basicSensitiveTopicCheckbox.type = "checkbox";
    basicSensitiveTopicCheckbox.id = "basic-q-sensitive-topic";
    Object.assign(basicSensitiveTopicCheckbox.style, { margin: "3px 0 0 0", flexShrink: "0" });

    const basicSensitiveTopicLabel = doc.createElement("label");
    basicSensitiveTopicLabel.setAttribute("for", "basic-q-sensitive-topic");
    basicSensitiveTopicLabel.textContent = "Did you ask the assistant about any topic that would require consulting a professional (i.e. legal, medical, etc.)?";
    Object.assign(basicSensitiveTopicLabel.style, { margin: "0", fontWeight: "500", color: "#1c1b22", cursor: "pointer" });

    basicSensitiveTopicRow.append(basicSensitiveTopicCheckbox, basicSensitiveTopicLabel);
    basicSensitiveTopicWrap.append(basicSensitiveTopicRow);
    basicContent.append(basicSensitiveTopicWrap);

    // Q: "Did the assistant suggest any follow-ups…?"
    //   Maps to groundtruth.followups = []
    //   (Locals prefixed with `basic` to avoid colliding with the expert
    //    view's followupsSection / followupsCheckbox / etc.)
    const basicFollowupsWrap = doc.createElement("div");
    Object.assign(basicFollowupsWrap.style, { display: "flex", flexDirection: "column", gap: "8px" });

    const basicFollowupsRow = doc.createElement("div");
    Object.assign(basicFollowupsRow.style, {
      display: "flex",
      alignItems: "flex-start",
      gap: "8px",
      fontSize: "13px",
      lineHeight: "1.4",
    });

    const basicFollowupsCheckbox = doc.createElement("input");
    basicFollowupsCheckbox.type = "checkbox";
    basicFollowupsCheckbox.id = "basic-q-followups";
    Object.assign(basicFollowupsCheckbox.style, { margin: "3px 0 0 0", flexShrink: "0" });

    const basicFollowupsLabel = doc.createElement("label");
    basicFollowupsLabel.setAttribute("for", "basic-q-followups");
    basicFollowupsLabel.textContent = "Did the assistant suggest any follow-ups to continue the conversation, either in its response or as bubbles below it?";
    Object.assign(basicFollowupsLabel.style, { margin: "0", fontWeight: "500", color: "#1c1b22", cursor: "pointer" });

    basicFollowupsRow.append(basicFollowupsCheckbox, basicFollowupsLabel);
    basicFollowupsWrap.append(basicFollowupsRow);
    basicContent.append(basicFollowupsWrap);

    // Q: "Did you expect the SmartWindow assistant to search the web for you?"
    //   Maps to groundtruth.tools = [{ name: "run_search", args: { query } }]
    const webSearchWrap = doc.createElement("div");
    Object.assign(webSearchWrap.style, { display: "flex", flexDirection: "column", gap: "8px" });

    const webSearchRow = doc.createElement("div");
    Object.assign(webSearchRow.style, {
      display: "flex",
      alignItems: "flex-start",
      gap: "8px",
      fontSize: "13px",
      lineHeight: "1.4",
    });

    const webSearchCheckbox = doc.createElement("input");
    webSearchCheckbox.type = "checkbox";
    webSearchCheckbox.id = "basic-q-web-search";
    Object.assign(webSearchCheckbox.style, { margin: "3px 0 0 0", flexShrink: "0" });

    const webSearchLabel = doc.createElement("label");
    webSearchLabel.setAttribute("for", "basic-q-web-search");
    webSearchLabel.textContent = "Did you expect the SmartWindow assistant to search the web for you?";
    Object.assign(webSearchLabel.style, { margin: "0", fontWeight: "500", color: "#1c1b22", cursor: "pointer" });

    webSearchRow.append(webSearchCheckbox, webSearchLabel);

    const webSearchSub = doc.createElement("div");
    Object.assign(webSearchSub.style, {
      display: "none",
      flexDirection: "column",
      gap: "4px",
      marginLeft: "24px",
      paddingLeft: "8px",
      borderLeft: "2px solid #d0d0d8",
    });

    const webSearchSubLabel = doc.createElement("label");
    webSearchSubLabel.setAttribute("for", "basic-q-search-query");
    webSearchSubLabel.textContent = "What did you expect it to search for?";
    Object.assign(webSearchSubLabel.style, { fontSize: "12px", fontWeight: "500", color: "#1c1b22", margin: "0" });

    const searchQueryInput = doc.createElement("input");
    searchQueryInput.type = "text";
    searchQueryInput.id = "basic-q-search-query";
    searchQueryInput.placeholder = "Search query…";
    Object.assign(searchQueryInput.style, { ...inputStyle, fontSize: "13px" });

    webSearchSub.append(webSearchSubLabel, searchQueryInput);

    webSearchCheckbox.addEventListener("change", () => {
      const on = webSearchCheckbox.checked;
      webSearchSub.style.display = on ? "flex" : "none";
      if (on) searchQueryInput.focus();
    });

    webSearchWrap.append(webSearchRow, webSearchSub);
    basicContent.append(webSearchWrap);

    // Q: "Did you expect the assistant to show/list/use/reference your open tabs?"
    //   Maps to groundtruth.tools += { name: "get_open_tabs", args: { url_list } }
    const openTabsWrap = doc.createElement("div");
    Object.assign(openTabsWrap.style, { display: "flex", flexDirection: "column", gap: "8px" });

    const openTabsRow = doc.createElement("div");
    Object.assign(openTabsRow.style, {
      display: "flex",
      alignItems: "flex-start",
      gap: "8px",
      fontSize: "13px",
      lineHeight: "1.4",
    });

    const openTabsCheckbox = doc.createElement("input");
    openTabsCheckbox.type = "checkbox";
    openTabsCheckbox.id = "basic-q-open-tabs";
    Object.assign(openTabsCheckbox.style, { margin: "3px 0 0 0", flexShrink: "0" });

    const openTabsLabel = doc.createElement("label");
    openTabsLabel.setAttribute("for", "basic-q-open-tabs");
    openTabsLabel.textContent = "Did you expect the SmartWindow assistant to show you, list, use, or reference your currently opened tabs to answer your question?";
    Object.assign(openTabsLabel.style, { margin: "0", fontWeight: "500", color: "#1c1b22", cursor: "pointer" });

    openTabsRow.append(openTabsCheckbox, openTabsLabel);

    const openTabsSub = doc.createElement("div");
    Object.assign(openTabsSub.style, {
      display: "none",
      flexDirection: "column",
      gap: "4px",
      marginLeft: "24px",
      paddingLeft: "8px",
      borderLeft: "2px solid #d0d0d8",
    });

    const openTabsList = doc.createElement("div");
    Object.assign(openTabsList.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      maxHeight: "180px",
      overflowY: "auto",
    });

    // Populate tab list synchronously — gBrowser is right here.
    const openTabsSnapshot = getOpenTabs();
    if (!openTabsSnapshot.length) {
      const empty = doc.createElement("div");
      empty.textContent = "No tabs open.";
      Object.assign(empty.style, { fontSize: "12px", color: "#5b5b66", fontStyle: "italic" });
      openTabsList.appendChild(empty);
    } else {
      for (const tab of openTabsSnapshot) {
        const row = doc.createElement("div");
        Object.assign(row.style, {
          display: "flex",
          alignItems: "flex-start",
          gap: "6px",
          fontSize: "12px",
          lineHeight: "1.3",
        });
        const cb = doc.createElement("input");
        cb.type = "checkbox";
        cb.className = "basic-tab-input";
        cb.dataset.url = tab.url || "";
        Object.assign(cb.style, { margin: "2px 0 0 0", flexShrink: "0" });
        const label = doc.createElement("label");
        label.textContent = tab.title || tab.url || "(untitled)";
        Object.assign(label.style, {
          margin: "0",
          fontWeight: "400",
          color: "#1c1b22",
          cursor: "pointer",
          wordBreak: "break-word",
        });
        label.addEventListener("click", () => cb.click());
        row.append(cb, label);
        openTabsList.appendChild(row);
      }
    }

    openTabsSub.append(openTabsList);

    openTabsCheckbox.addEventListener("change", () => {
      openTabsSub.style.display = openTabsCheckbox.checked ? "flex" : "none";
    });

    openTabsWrap.append(openTabsRow, openTabsSub);
    basicContent.append(openTabsWrap);

    // Q: "Did you expect the assistant to read other (non-tab) pages?"
    //   Maps to groundtruth.tools += { name: "get_page_content", args: { url_list } }
    //   This is an ADDITIONAL entry, separate from the get_page_content the
    //   open-tabs question may emit — different intent (open tabs vs. URLs
    //   the user typed in).
    const otherPagesWrap = doc.createElement("div");
    Object.assign(otherPagesWrap.style, { display: "flex", flexDirection: "column", gap: "8px" });

    const otherPagesRow = doc.createElement("div");
    Object.assign(otherPagesRow.style, {
      display: "flex",
      alignItems: "flex-start",
      gap: "8px",
      fontSize: "13px",
      lineHeight: "1.4",
    });

    const otherPagesCheckbox = doc.createElement("input");
    otherPagesCheckbox.type = "checkbox";
    otherPagesCheckbox.id = "basic-q-other-pages";
    Object.assign(otherPagesCheckbox.style, { margin: "3px 0 0 0", flexShrink: "0" });

    const otherPagesLabel = doc.createElement("label");
    otherPagesLabel.setAttribute("for", "basic-q-other-pages");
    otherPagesLabel.textContent = "Did you expect the SmartWindow assistant to read content from any other web pages you do NOT have open in a tab to answer your question (i.e. summarizing a website, comparing products across pages, etc.)?";
    Object.assign(otherPagesLabel.style, { margin: "0", fontWeight: "500", color: "#1c1b22", cursor: "pointer" });

    otherPagesRow.append(otherPagesCheckbox, otherPagesLabel);

    const otherPagesSub = doc.createElement("div");
    Object.assign(otherPagesSub.style, {
      display: "none",
      flexDirection: "column",
      gap: "6px",
      marginLeft: "24px",
      paddingLeft: "8px",
      borderLeft: "2px solid #d0d0d8",
    });

    const otherPagesHeaderRow = doc.createElement("div");
    Object.assign(otherPagesHeaderRow.style, { display: "flex", alignItems: "center", gap: "6px" });

    const otherPagesHeaderLabel = doc.createElement("label");
    otherPagesHeaderLabel.textContent = "URLs the assistant should have read";
    Object.assign(otherPagesHeaderLabel.style, { fontSize: "12px", fontWeight: "500", color: "#1c1b22", margin: "0" });

    const otherPagesAddBtn = doc.createElement("button");
    otherPagesAddBtn.textContent = "+";
    Object.assign(otherPagesAddBtn.style, {
      padding: "1px 7px",
      borderRadius: "4px",
      border: "1px solid #ccc",
      background: "#2c2c32",
      cursor: "pointer",
      fontSize: "13px",
    });

    otherPagesHeaderRow.append(otherPagesHeaderLabel, otherPagesAddBtn);

    const otherPagesContainer = doc.createElement("div");
    Object.assign(otherPagesContainer.style, { display: "flex", flexDirection: "column", gap: "6px" });

    const addOtherPageRowDialog = () => {
      const row = doc.createElement("div");
      Object.assign(row.style, { display: "flex", gap: "6px" });

      const input = doc.createElement("input");
      input.type = "text";
      input.className = "basic-other-page-input";
      input.placeholder = "https://…";
      Object.assign(input.style, { ...inputStyle, flex: "1", fontSize: "13px" });

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
        if (otherPagesContainer.children.length > 1) row.remove();
      });

      row.append(input, removeBtn);
      otherPagesContainer.appendChild(row);
      input.focus();
    };

    otherPagesAddBtn.addEventListener("click", addOtherPageRowDialog);
    addOtherPageRowDialog();

    otherPagesSub.append(otherPagesHeaderRow, otherPagesContainer);

    otherPagesCheckbox.addEventListener("change", () => {
      otherPagesSub.style.display = otherPagesCheckbox.checked ? "flex" : "none";
    });

    otherPagesWrap.append(otherPagesRow, otherPagesSub);
    basicContent.append(otherPagesWrap);

    // Q: "Did you expect the assistant to search your browsing history?"
    //   Maps to groundtruth.tools += { name: "search_browsing_history", args: { query } }
    const historyWrap = doc.createElement("div");
    Object.assign(historyWrap.style, { display: "flex", flexDirection: "column", gap: "8px" });

    const historyRow = doc.createElement("div");
    Object.assign(historyRow.style, {
      display: "flex",
      alignItems: "flex-start",
      gap: "8px",
      fontSize: "13px",
      lineHeight: "1.4",
    });

    const historyCheckbox = doc.createElement("input");
    historyCheckbox.type = "checkbox";
    historyCheckbox.id = "basic-q-browsing-history";
    Object.assign(historyCheckbox.style, { margin: "3px 0 0 0", flexShrink: "0" });

    const historyLabel = doc.createElement("label");
    historyLabel.setAttribute("for", "basic-q-browsing-history");
    historyLabel.textContent = "Did you expect the SmartWindow assistant to search through or reference your browsing history to answer your question?";
    Object.assign(historyLabel.style, { margin: "0", fontWeight: "500", color: "#1c1b22", cursor: "pointer" });

    historyRow.append(historyCheckbox, historyLabel);

    const historySub = doc.createElement("div");
    Object.assign(historySub.style, {
      display: "none",
      flexDirection: "column",
      gap: "8px",
      marginLeft: "24px",
      paddingLeft: "8px",
      borderLeft: "2px solid #d0d0d8",
    });

    // Helper for one label+input field within historySub.
    const subFieldStyle = { display: "flex", flexDirection: "column", gap: "4px" };
    const subLabelStyle = { fontSize: "12px", fontWeight: "500", color: "#1c1b22", margin: "0" };

    const historySearchTermField = doc.createElement("div");
    Object.assign(historySearchTermField.style, subFieldStyle);

    const historySearchTermLabel = doc.createElement("label");
    historySearchTermLabel.setAttribute("for", "basic-q-history-search-term");
    historySearchTermLabel.textContent = "What did you expect it to search for in your browsing history?";
    Object.assign(historySearchTermLabel.style, subLabelStyle);

    const historySearchTermInput = doc.createElement("input");
    historySearchTermInput.type = "text";
    historySearchTermInput.id = "basic-q-history-search-term";
    historySearchTermInput.placeholder = "Browsing history search term…";
    Object.assign(historySearchTermInput.style, { ...inputStyle, fontSize: "13px" });

    historySearchTermField.append(historySearchTermLabel, historySearchTermInput);

    // datetime-local doesn't work in chrome:// (see CLAUDE.md), so use a
    // text input with the iso-datetime format as the placeholder — matches
    // the expert dialog's iso-datetime tool-arg input.
    const historyStartTsField = doc.createElement("div");
    Object.assign(historyStartTsField.style, subFieldStyle);

    const historyStartTsLabel = doc.createElement("label");
    historyStartTsLabel.setAttribute("for", "basic-q-history-start-ts");
    historyStartTsLabel.textContent = "Start Datetime";
    Object.assign(historyStartTsLabel.style, subLabelStyle);

    const historyStartTsInput = doc.createElement("input");
    historyStartTsInput.type = "text";
    historyStartTsInput.id = "basic-q-history-start-ts";
    historyStartTsInput.placeholder = "YYYY-MM-DDTHH:MM:SS";
    Object.assign(historyStartTsInput.style, { ...inputStyle, fontSize: "13px" });

    historyStartTsField.append(historyStartTsLabel, historyStartTsInput);

    const historyEndTsField = doc.createElement("div");
    Object.assign(historyEndTsField.style, subFieldStyle);

    const historyEndTsLabel = doc.createElement("label");
    historyEndTsLabel.setAttribute("for", "basic-q-history-end-ts");
    historyEndTsLabel.textContent = "End Datetime";
    Object.assign(historyEndTsLabel.style, subLabelStyle);

    const historyEndTsInput = doc.createElement("input");
    historyEndTsInput.type = "text";
    historyEndTsInput.id = "basic-q-history-end-ts";
    historyEndTsInput.placeholder = "YYYY-MM-DDTHH:MM:SS";
    Object.assign(historyEndTsInput.style, { ...inputStyle, fontSize: "13px" });

    historyEndTsField.append(historyEndTsLabel, historyEndTsInput);

    historySub.append(historySearchTermField, historyStartTsField, historyEndTsField);

    historyCheckbox.addEventListener("change", () => {
      const on = historyCheckbox.checked;
      historySub.style.display = on ? "flex" : "none";
      if (on) historySearchTermInput.focus();
    });

    historyWrap.append(historyRow, historySub);
    basicContent.append(historyWrap);

    const basicBtnRow = doc.createElement("div");
    Object.assign(basicBtnRow.style, { display: "flex", justifyContent: "flex-end", gap: "8px" });

    const basicCancelBtn = doc.createElement("button");
    basicCancelBtn.textContent = "Cancel";
    Object.assign(basicCancelBtn.style, {
      padding: "6px 14px",
      borderRadius: "4px",
      border: "1px solid #ccc",
      background: "#2c2c32",
      cursor: "pointer",
      fontSize: "13px",
    });
    basicCancelBtn.addEventListener("click", () => finish(null));

    const basicSaveBtn = doc.createElement("button");
    basicSaveBtn.textContent = "Save";
    Object.assign(basicSaveBtn.style, {
      padding: "6px 14px",
      borderRadius: "4px",
      border: "none",
      background: "#0060df",
      color: "#fff",
      cursor: "pointer",
      fontSize: "13px",
    });
    basicSaveBtn.addEventListener("click", () => {
      const expectedOpenTabUrls = Array.from(
        openTabsList.querySelectorAll(".basic-tab-input")
      ).filter(cb => cb.checked).map(cb => cb.dataset.url).filter(Boolean);

      const otherPageUrls = Array.from(
        otherPagesContainer.querySelectorAll(".basic-other-page-input")
      ).map(i => i.value.trim()).filter(Boolean);

      const basicTaggedMemoryIds = Array.from(
        basicTaggedMemoriesList.querySelectorAll(".basic-memory-input")
      ).filter(cb => cb.checked).map(cb => cb.value);

      finish({
        mode: "basic",
        expectedBehavior: basicExpectedBehaviorTextarea.value.trim(),
        expectedTaggedMemories: basicTaggedMemoriesCheckbox.checked,
        taggedMemoryIds: basicTaggedMemoryIds,
        sensitiveTopic: basicSensitiveTopicCheckbox.checked,
        followups: basicFollowupsCheckbox.checked,
        expectedWebSearch: webSearchCheckbox.checked,
        searchQuery: searchQueryInput.value.trim(),
        expectedOpenTabs: openTabsCheckbox.checked,
        expectedOpenTabUrls,
        expectedOtherPages: otherPagesCheckbox.checked,
        otherPageUrls,
        expectedBrowsingHistory: historyCheckbox.checked,
        browsingHistorySearchTerm: historySearchTermInput.value.trim(),
        browsingHistoryStartTs: historyStartTsInput.value.trim(),
        browsingHistoryEndTs: historyEndTsInput.value.trim(),
      });
    });

    basicBtnRow.append(basicCancelBtn, basicSaveBtn);
    basicView.append(basicContent, basicBtnRow);

    dialog.append(dialogHeader, basicView, expertView);
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
async function collectSmartWindowData({ notes = "", bugzillaUrls = [], tags = [], groundtruth = null, startDate = "", endDate = "" } = {}) {
  // Find the conversation in the current SmartWindow
  const win = windowMediator.getMostRecentWindow("navigator:browser");
  const conversation = lazy.AIWindow.getActiveConversation(win);
  // Render the messages in openAI format
  // The conversation isn't stored in ChatConversation in the same form it is when it hits the API
  // We convert it here to make sure the 2 are properly aligned, and there aren't bugs in conversion
  const openAIFormatMessages = conversation.getMessagesInOpenAiFormat();
  const compactedMessages = lazy.compactMessages(openAIFormatMessages);

  // Create a temp openAIEngine with the active config in order to pull its parameters
  let engineConfig = null;
  let engine;
  try {
    engine = await lazy.openAIEngine.build(
      lazy.MODEL_FEATURES.CHAT,
      `FOR_DUMP-${conversation.id}`
    );
    engineConfig = await lazy.loadCallContext(lazy.MODEL_FEATURES.CHAT);
  } catch (e) {
    engineConfig = { error: String(e) };
  }
  const chatPrompt = await lazy.loadPrompt(lazy.MODEL_FEATURES.CHAT);

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


  // Prep eval_format conversation export
  const messages = []
  const lastUserMsgIdx = compactedMessages.findLastIndex(msg => msg.role == "user");

  // Format tabs for turn context
  let tabContext = null;
  if (tabs.length) {
    let activeTab;
    const otherTabs = []
    for (const tab of tabs) {
      if (tab.isActiveTab) {
        activeTab = {
          url: tab.url,
          title: tab.title,
          description: ""
        }
      } else {
        otherTabs.push({
          url: tab.url,
          title: tab.title,
          description: ""
        })
      }
    }
    tabContext = {
      content: {
        active: activeTab,
        other: otherTabs
      }
    }
  }

  // Format memeories for turn context
  let memoriesContext = null;
  if (memories.length) {
    const memoriesContextList = []
    for (const memory of memories) {
      memoriesContextList.push({
        id: memory.id,
        memory_summary: memory.memory_summary
      })
    }
    memoriesContext = {
      content: memoriesContextList
    }
  }

  // Pull user-mocked system prompts to make sure they're skipped in user message counts
  const realTimeInfoPromptTemplate = await lazy.loadPrompt(lazy.MODEL_FEATURES.REAL_TIME_CONTEXT_DATE);
  const relevantMemoriesPromptTemplate = await lazy.loadPrompt(lazy.MODEL_FEATURES.MEMORIES_RELEVANT_CONTEXT)

  // Create messages list
  for (const msgIdx in compactedMessages) {
    const msg = compactedMessages[msgIdx];

    // Skip system messages
    // The testing framework will regenerate these
    // System prompt
    if (msg["role"] === "system") { continue; }
    // Real time context message
    else if (msg["role"] === "user" && msg["content"].slice(0, 100) === realTimeInfoPromptTemplate.prompt.slice(0, 100)) { continue; }
    // Relevant memories message
    else if (msg["role"] === "user" && msg["content"].slice(0, 100) === relevantMemoriesPromptTemplate.prompt.slice(0, 100)) { continue; }

    // Actual messages we want to capture
    // Add the last user message as the scorable turn; add all other messages only as conversation context
    else {
      if (msgIdx != lastUserMsgIdx) {
        messages.push(msg);
      } else {
        // Final user message marked as scorable
        // Saved with groundtruth and context info
        messages.push({
          ...msg,
          is_scorable: true,
          context: {
            tabs: tabContext,
            memories: memoriesContext,
            datetime: {
                content: (() => {
                const now = new Date();
                const resolved = Intl.DateTimeFormat().resolvedOptions();
                const localeRegion = resolved.locale.split("-")[1];
                return {
                  isoTimestamp: now.toISOString().slice(0, 19),
                  todayDate: now.toISOString().slice(0, 10),
                  timezone: resolved.timeZone,
                  locale: localeRegion ? localeRegion.toLowerCase() : resolved.locale.toLowerCase()
                };
              })()
            }
          },
          groundtruth: groundtruth && Object.keys(groundtruth).length ? groundtruth : null
        })
      }
    }
  }

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
      tags,
      notes,
    },
    // Information about the SmartWindow application including Fx version, openAIEngine (prompt, model, etc.), and user's locale/timezone
    applicationMetadata: {
      firefox: {
        version: appInfo.version,
        buildID: appInfo.appBuildID,
      },
      openAIEngine: {...engineConfig, chatPromptVersion: chatPrompt.version},
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
        compacted: compactedMessages
      },
      // Format for evaluation framework
      eval_format: {
        uuid: uuidGenerator.generateUUID().toString().slice(1, -1),
        messages: messages,
        tags: tags
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
 * Translate basic-view question answers into the eval `groundtruth` shape.
 *
 * Each basic-view question maps to a slice of groundtruth. Returns null if no
 * answers map to any groundtruth (i.e. the user left every question blank).
 *
 * Expected-behavior textarea → groundtruth.user_journey.expected_behavior
 * Tagged-memories checkbox + per-memory checks → groundtruth.tagged_memories = [memoryId, ...]
 *   (only emitted if the main checkbox is on AND at least one memory is checked)
 * Sensitive-topic checkbox → groundtruth.sensitive_topic_disclaimers = { is_sensitive: true }
 * Follow-ups checkbox → groundtruth.followups = []
 * Web-search checkbox + query → groundtruth.tools += { name: "run_search", args: { query } }
 * Open-tabs checkbox → groundtruth.tools += { name: "get_open_tabs", args: {} }
 * Open-tabs checked tabs → groundtruth.tools += { name: "get_page_content", args: { url_list } }
 * Other-pages checkbox + URL list → groundtruth.tools += { name: "get_page_content", args: { url_list } }
 *   (a SEPARATE entry from the open-tabs one, even when both produce
 *   get_page_content — they capture different intents)
 * Browsing-history checkbox + search term + start/end datetimes
 *   → groundtruth.tools += { name: "search_browsing_history",
 *                            args: { searchTerm, startTs, endTs } }
 */
function buildBasicGroundtruth(options) {
  const groundtruth = {};
  const tools = [];

  if (options.expectedBehavior?.trim()) {
    groundtruth.user_journey = { expected_behavior: options.expectedBehavior.trim() };
  }

  if (options.expectedTaggedMemories
      && Array.isArray(options.taggedMemoryIds)
      && options.taggedMemoryIds.length) {
    groundtruth.tagged_memories = options.taggedMemoryIds;
  }

  if (options.sensitiveTopic) {
    groundtruth.sensitive_topic_disclaimers = { is_sensitive: true };
  }

  if (options.followups) {
    groundtruth.followups = [];
  }

  if (options.expectedWebSearch) {
    const args = {};
    if (options.searchQuery?.trim()) args.query = options.searchQuery.trim();
    tools.push({ name: "run_search", args });
  }

  if (options.expectedOpenTabs) {
    // Checking the box always asserts the assistant should have called
    // get_open_tabs (which takes no arguments).
    tools.push({ name: "get_open_tabs", args: {} });

    // If specific tabs were checked, also assert the assistant should have
    // fetched their content via get_page_content.
    if (Array.isArray(options.expectedOpenTabUrls) && options.expectedOpenTabUrls.length) {
      tools.push({ name: "get_page_content", args: { url_list: options.expectedOpenTabUrls } });
    }
  }

  // Separate get_page_content entry for URLs the user typed in (pages they
  // expected the assistant to read that are not currently open in tabs).
  // Intentionally an additional groundtruth entry rather than merging with
  // the open-tabs one.
  if (options.expectedOtherPages
      && Array.isArray(options.otherPageUrls)
      && options.otherPageUrls.length) {
    tools.push({ name: "get_page_content", args: { url_list: options.otherPageUrls } });
  }

  if (options.expectedBrowsingHistory) {
    const args = {};
    if (options.browsingHistorySearchTerm?.trim()) args.searchTerm = options.browsingHistorySearchTerm.trim();
    if (options.browsingHistoryStartTs?.trim()) args.startTs = options.browsingHistoryStartTs.trim();
    if (options.browsingHistoryEndTs?.trim()) args.endTs = options.browsingHistoryEndTs.trim();
    tools.push({ name: "search_browsing_history", args });
  }

  if (tools.length) groundtruth.tools = tools;

  return Object.keys(groundtruth).length ? groundtruth : null;
}

/**
 * Collection function for the basic (non-expert) export view. Produces the
 * same export shape as collectSmartWindowData — the difference is in *how*
 * the groundtruth is built: instead of raw groundtruth inputs, the basic
 * view passes answers to plain-language questions that we translate here.
 *
 * @param {object} options - Answers from the basic view's questions.
 * @returns {object} - SmartWindow data in the standard export shape.
 */
async function collectBasicSmartWindowData(options = {}) {
  const groundtruth = buildBasicGroundtruth(options);
  return collectSmartWindowData({ groundtruth });
}

/**
 * Basic export — opens the file picker, collects basic SmartWindow data, and
 * writes it to JSON. Parallel to doExport for the expert flow so the two can
 * evolve independently.
 */
async function doBasicExport(browsingContext, options = {}) {
  const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
  fp.init(browsingContext, "Export SmartWindow Data", Ci.nsIFilePicker.modeSave);
  fp.defaultExtension = "json";
  fp.defaultString = "smartwindow-export.json";
  fp.appendFilter("JSON Files", "*.json");
  fp.appendFilters(Ci.nsIFilePicker.filterAll);

  const result = await new Promise(resolve => fp.open(resolve));
  if (result !== Ci.nsIFilePicker.returnOK && result !== Ci.nsIFilePicker.returnReplace) {
    return { saved: false, reason: "cancelled" };
  }

  const rawData = await collectBasicSmartWindowData(options);
  const data = JSON.stringify(rawData, null, 2);

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
 * Open the file picker, gather SmartWindow information based on user parameters, and save to a JSON file
 */
async function doExport(browsingContext, { notes = "", bugzillaUrls = [], tags = [], groundtruth = null, startDate = "", endDate = "" } = {}) {

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
  const rawData = await collectSmartWindowData({ notes, bugzillaUrls, tags, groundtruth, startDate, endDate });
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
    const exportFn = result.mode === "basic" ? doBasicExport : doExport;
    exportFn(aiWindowBrowser.browsingContext, result).catch(e =>
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

// Inject/override tool args at render time based on runtime conversation
// context (e.g. number of user turns so far). Mutates the tool args in place.
// Mirrors applyConditionalRequired in popup.js — keep both in sync.
function applyConditionalRequiredDialog(tools, ctx) {
  for (const tool of tools) {
    // run_search.query is not in the default toolsConfig schema. On follow-up
    // turns (2+ user messages) the model is expected to supply a query string,
    // so we inject it here as a required arg so users can fill in groundtruth.
    if (tool.name === "run_search" &&
        ctx.userMessageCount >= 2 &&
        !tool.args.find(a => a.name === "query")) {
      tool.args.push({
        name: "query",
        type: "string",
        required: true,
        description: "Search query the model should send.",
      });
    }
  }
}

// Normalize toolsConfig into [{name, description, args: [{name, type, required, description, enum?}]}]
// regardless of whether it's a Map, array, or plain object — and whether each tool's
// parameters are JSON-Schema-shaped, an array of arg specs, or a flat name→type object.
function normalizeToolsConfig(cfg) {
  if (!cfg) return [];
  const raw = cfg.tools ?? cfg;
  let toolArray;
  if (Array.isArray(raw)) toolArray = raw;
  else if (raw instanceof Map) toolArray = Array.from(raw.values());
  else if (typeof raw === "object") toolArray = Object.values(raw);
  else return [];

  return toolArray
    .map(t => {
      if (!t || typeof t !== "object") return null;
      // OpenAI function-calling shape: { type: "function", function: { name, description, parameters } }
      const inner = (t.type === "function" && t.function && typeof t.function === "object") ? t.function : t;
      const name = inner.name ?? inner.toolName ?? inner.id;
      if (!name) return null;
      const description = inner.description ?? inner.desc ?? "";
      const params = inner.parameters ?? inner.params ?? inner.schema ?? inner.args;
      return { name, description, args: normalizeToolArgs(params) };
    })
    .filter(Boolean);
}

function normalizeToolArgs(params) {
  if (!params) return [];
  // JSON-Schema style: { type: "object", properties: {...}, required: [...] }
  if (params.properties && typeof params.properties === "object") {
    const required = new Set(params.required ?? []);
    return Object.entries(params.properties).map(([argName, spec]) => ({
      name: argName,
      type: spec?.type ?? "string",
      required: required.has(argName),
      description: spec?.description ?? "",
      enum: spec?.enum,
    }));
  }
  // Array of arg specs: [{name, type, required?, description?, enum?}, ...]
  if (Array.isArray(params)) {
    return params.filter(p => p?.name).map(p => ({
      name: p.name,
      type: p.type ?? "string",
      required: !!p.required,
      description: p.description ?? "",
      enum: p.enum,
    }));
  }
  // Flat object: { argName: "type" } or { argName: {type, ...} }
  if (typeof params === "object") {
    return Object.entries(params).map(([argName, spec]) => {
      const isObj = spec && typeof spec === "object";
      return {
        name: argName,
        type: isObj ? (spec.type ?? "string") : (typeof spec === "string" ? spec : "string"),
        required: isObj ? !!spec.required : false,
        description: isObj ? (spec.description ?? "") : "",
        enum: isObj ? spec.enum : undefined,
      };
    });
  }
  return [];
}

/**
 * Count real user messages in the active SmartWindow conversation. Mirrors the
 * filtering in collectSmartWindowData: openAI-format conversion can surface
 * auto-injected system prompts as messages with role "user" (real-time
 * context, relevant memories), so we drop them before counting.
 *
 * @returns {Promise<number>} - Number of real user messages, or 0 if no
 *   conversation/engine is available.
 */
async function countUserMessages() {
  try {
    const win = windowMediator.getMostRecentWindow("navigator:browser");
    const conversation = lazy.AIWindow.getActiveConversation(win);
    if (!conversation) return 0;

    const openAIFormatMessages = conversation.getMessagesInOpenAiFormat();
    const compactedMessages = lazy.compactMessages(openAIFormatMessages);

    const engine = await lazy.openAIEngine.build(
      lazy.MODEL_FEATURES.CHAT,
      `FOR_USER_COUNT-${conversation.id}`
    );
    const realTimeInfoPromptTemplate = await lazy.loadPrompt(lazy.MODEL_FEATURES.REAL_TIME_CONTEXT_DATE);
    const relevantMemoriesPromptTemplate = await lazy.loadPrompt(lazy.MODEL_FEATURES.MEMORIES_RELEVANT_CONTEXT);

    let count = 0;
    for (const msg of compactedMessages) {
      if (msg.role === "system") continue;
      if (msg.role !== "user") continue;
      if (msg.content.slice(0, 100) === realTimeInfoPromptTemplate.prompt.slice(0, 100)) continue;
      if (msg.content.slice(0, 100) === relevantMemoriesPromptTemplate.prompt.slice(0, 100)) continue;
      count++;
    }
    return count;
  } catch (e) {
    console.warn("[smartwindow] countUserMessages failed:", e);
    return 0;
  }
}

/**
 * Slice the *raw* conversation (integer roles: 0=user, 1=assistant) to just
 * the assistant messages that come after the last user message. The basic
 * view's raw-conversation pre-fills (tagged memories, follow-ups) all share
 * this filter — `memoriesApplied` and `followUpSuggestions` only live on
 * raw assistant messages, not on the openAI-format conversion. Mirrors
 * getPostUserRawAssistantMessages in popup.js.
 */
function getPostUserRawAssistantMessages(raw) {
  if (!Array.isArray(raw) || !raw.length) return [];
  let lastUserIdx = -1;
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i]?.role === 0) { lastUserIdx = i; break; }
  }
  const subsequent = lastUserIdx === -1 ? raw : raw.slice(lastUserIdx + 1);
  return subsequent.filter(m => m?.role === 1);
}

/**
 * Slice the compacted conversation to just the assistant + tool messages
 * that come after the last user message. The basic view's pre-fill logic
 * only looks at this window — it represents what the assistant did in
 * response to the latest user turn, which is the turn the export is scored
 * against. Mirrors getPostUserAssistantToolMessages in popup.js.
 */
function getPostUserAssistantToolMessages(compacted) {
  if (!Array.isArray(compacted)) return [];
  let lastUserIdx = -1;
  for (let i = compacted.length - 1; i >= 0; i--) {
    if (compacted[i]?.role === "user") { lastUserIdx = i; break; }
  }
  const after = lastUserIdx === -1 ? compacted : compacted.slice(lastUserIdx + 1);
  return after.filter(m => m?.role === "assistant" || m?.role === "tool");
}

function parseToolCallArgs(tc) {
  const raw = tc.function?.arguments;
  if (raw == null || raw === "") return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

/**
 * Find the first assistant tool call to `toolName` in `messages` and return
 * its parsed arguments object. Returns `null` if no such call exists, or `{}`
 * if the call has no arguments. OpenAI tool-call `arguments` are a JSON
 * string at the wire level, so we parse them here. Mirrors getToolCallArgs
 * in popup.js.
 */
function getToolCallArgs(messages, toolName) {
  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.tool_calls)) continue;
    const tc = msg.tool_calls.find(tc => tc?.function?.name === toolName);
    if (tc) return parseToolCallArgs(tc);
  }
  return null;
}

/**
 * Like getToolCallArgs but returns the parsed args of every call to
 * `toolName` across the messages (in conversation order). Useful when the
 * model can call the same tool more than once in a single turn — e.g.
 * get_page_content with different url_lists. Mirrors getAllToolCallArgs
 * in popup.js.
 */
function getAllToolCallArgs(messages, toolName) {
  const all = [];
  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.tool_calls)) continue;
    for (const tc of msg.tool_calls) {
      if (tc?.function?.name === toolName) all.push(parseToolCallArgs(tc));
    }
  }
  return all;
}

/**
 * Return the raw ChatConversation messages — the same `conversation.messages`
 * that collectSmartWindowData embeds under `conversation.raw`. Used by the
 * basic-view tagged-memories pre-fill, which needs the per-message
 * `memoriesApplied` metadata (lost in the openAI-format conversion).
 *
 * Note: roles here are integers — `0` = user, `1` = assistant.
 */
function getRawConversation() {
  const win = windowMediator.getMostRecentWindow("navigator:browser");
  const conversation = lazy.AIWindow.getActiveConversation(win);
  if (!conversation) return [];
  return Array.from(conversation.messages ?? []);
}

/**
 * Snapshot the open tabs in the most recent browser window in a shape the
 * basic-view UI can render. Mirrors the tabs collection inside
 * collectSmartWindowData (sans `lastAccessed`, which the UI doesn't need).
 */
function getOpenTabs() {
  const win = windowMediator.getMostRecentWindow("navigator:browser");
  if (!win?.gBrowser) return [];
  return Array.from(win.gBrowser.tabs).map(tab => ({
    url: tab.linkedBrowser?.currentURI?.spec ?? null,
    title: tab.label ?? null,
    isActiveTab: tab.selected,
  }));
}

/**
 * Get the compacted SmartWindow conversation messages with auto-injected
 * system/user messages (system prompt, real-time-context, relevant-memories)
 * filtered out. Mirrors the filtering used in collectSmartWindowData's
 * eval_format build so the basic view sees the same canonical message list
 * the eval framework would.
 *
 * Returned shape is the openAI-format message list: [{role, content, ...}].
 * Returns [] if no conversation/engine is available.
 *
 * @returns {Promise<Array<object>>}
 */
async function getCompactedConversation() {
  try {
    const win = windowMediator.getMostRecentWindow("navigator:browser");
    const conversation = lazy.AIWindow.getActiveConversation(win);
    if (!conversation) return [];

    const openAIFormatMessages = conversation.getMessagesInOpenAiFormat();
    const compactedMessages = lazy.compactMessages(openAIFormatMessages);

    const engine = await lazy.openAIEngine.build(
      lazy.MODEL_FEATURES.CHAT,
      `FOR_COMPACTED-${conversation.id}`
    );
    const realTimeInfoPromptTemplate = await lazy.loadPrompt(lazy.MODEL_FEATURES.REAL_TIME_CONTEXT_DATE);
    const relevantMemoriesPromptTemplate = await lazy.loadPrompt(lazy.MODEL_FEATURES.MEMORIES_RELEVANT_CONTEXT);

    return compactedMessages.filter(msg => {
      if (msg.role === "system") return false;
      if (msg.role === "user" && msg.content?.slice(0, 100) === realTimeInfoPromptTemplate.prompt.slice(0, 100)) return false;
      if (msg.role === "user" && msg.content?.slice(0, 100) === relevantMemoriesPromptTemplate.prompt.slice(0, 100)) return false;
      return true;
    });
  } catch (e) {
    console.warn("[smartwindow] getCompactedConversation failed:", e);
    return [];
  }
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

          async getMemories() {
            const memories = await lazy.MemoriesManager.getAllMemories();
            return memories.map(m => ({ id: m.id, memory_summary: m.memory_summary }));
          },

          async getTools() {
            const cfg = lazy.toolsConfig;
            const normalized = normalizeToolsConfig(cfg);
            if (!normalized.length) {
              console.warn("[smartwindow] getTools: normalizer returned empty. typeof toolsConfig =",
                typeof cfg, "keys =", cfg && typeof cfg === "object" ? Object.keys(cfg) : null,
                "value =", cfg);
            }
            return normalized;
          },

          async getUserMessageCount() {
            return countUserMessages();
          },

          async getCompactedConversation() {
            return getCompactedConversation();
          },

          async getRawConversation() {
            return getRawConversation();
          },

          async getOpenTabs() {
            return getOpenTabs();
          },

          async exportToFile({ notes = "", bugzillaUrls = [], tags = [], groundtruth = null, startDate = "", endDate = "" } = {}) {
            const chromeWindow = windowMediator.getMostRecentWindow("navigator:browser");
            return doExport(chromeWindow.browsingContext, { notes, bugzillaUrls, tags, groundtruth, startDate, endDate });
          },

          async basicExportToFile(options = {}) {
            const chromeWindow = windowMediator.getMostRecentWindow("navigator:browser");
            return doBasicExport(chromeWindow.browsingContext, options);
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

            if (result.mode === "basic") {
              return doBasicExport(win.browsingContext, result);
            }
            return doExport(win.browsingContext, result);
          },
        },
      },
    };
  }
};
