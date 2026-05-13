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

    dialog.append(columnsWrapper, btnRow);
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
  const realTimeInfoPromptTemplate = await engine.loadPrompt(lazy.MODEL_FEATURES.REAL_TIME_CONTEXT_DATE);
  const relevantMemoriesPromptTemplate = await engine.loadPrompt(lazy.MODEL_FEATURES.MEMORIES_RELEVANT_CONTEXT)

  // Create messages list
  for (const msgIdx in compactedMessages) {
    const msg = compactedMessages[msgIdx];

    // Skip system messages
    // The testing framework will regenerate these
    // System prompt
    if (msg["role"] === "system") { continue; }
    // Real time context message
    else if (msg["role"] === "user" && msg["content"].slice(0, 100) === realTimeInfoPromptTemplate.slice(0, 100)) { continue; }
    // Relevant memories message
    else if (msg["role"] === "user" && msg["content"].slice(0, 100) === relevantMemoriesPromptTemplate.slice(0, 100)) { continue; }

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
    const realTimeInfoPromptTemplate = await engine.loadPrompt(lazy.MODEL_FEATURES.REAL_TIME_CONTEXT_DATE);
    const relevantMemoriesPromptTemplate = await engine.loadPrompt(lazy.MODEL_FEATURES.MEMORIES_RELEVANT_CONTEXT);

    let count = 0;
    for (const msg of compactedMessages) {
      if (msg.role === "system") continue;
      if (msg.role !== "user") continue;
      if (msg.content.slice(0, 100) === realTimeInfoPromptTemplate.slice(0, 100)) continue;
      if (msg.content.slice(0, 100) === relevantMemoriesPromptTemplate.slice(0, 100)) continue;
      count++;
    }
    return count;
  } catch (e) {
    console.warn("[smartwindow] countUserMessages failed:", e);
    return 0;
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

          async exportToFile({ notes = "", bugzillaUrls = [], tags = [], groundtruth = null, startDate = "", endDate = "" } = {}) {
            const chromeWindow = windowMediator.getMostRecentWindow("navigator:browser");
            return doExport(chromeWindow.browsingContext, { notes, bugzillaUrls, tags, groundtruth, startDate, endDate });
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
