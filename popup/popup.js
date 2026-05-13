"use strict";

const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const PRESET_MS = { "1h": 3600000, "4h": 14400000, "24h": 86400000, "3d": 259200000, "7d": 604800000, "30d": 2592000000 };

// Per-tool, per-arg input formats. Keyed by tool name → arg name → format kind.
// Drives custom input rendering and submit-time validation for special arg types.
const TOOL_ARG_FORMATS = {
  search_browsing_history: { startTs: "iso-datetime", endTs: "iso-datetime" },
  get_page_content: { url_list: "string-list" },
};

// Inject/override tool args at render time based on runtime conversation
// context (e.g. number of user turns so far). Mutates the tool args in place.
function applyConditionalRequired(tools, ctx) {
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

function formatLocalDatetime(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const exportBtn = document.getElementById("export-btn");
const statusEl = document.getElementById("status");
const bugUrlsContainer = document.getElementById("bug-urls-container");
const bugAddBtn = document.getElementById("bug-add-btn");
const tagsContainer = document.getElementById("tags-container");
const tagAddBtn = document.getElementById("tag-add-btn");
const taggedMemoriesContainer = document.getElementById("tagged-memories-container");
const toolsContainer = document.getElementById("tools-container");
const toolAddBtn = document.getElementById("tool-add-btn");

let availableTools = [];
const historyPreset = document.getElementById("history-preset");
const customDateRow = document.getElementById("custom-date-row");
const startDateInput = document.getElementById("start-date");
const endDateInput = document.getElementById("end-date");
const dateErrorMsg = document.getElementById("date-error-msg");

historyPreset.addEventListener("change", () => {
  const isCustom = historyPreset.value === "custom";
  customDateRow.classList.toggle("hidden", !isCustom);
  if (!isCustom) {
    startDateInput.classList.remove("date-error");
    endDateInput.classList.remove("date-error");
    dateErrorMsg.classList.add("hidden");
  }
});

[startDateInput, endDateInput].forEach(el => {
  el.addEventListener("input", () => {
    el.classList.remove("date-error");
    dateErrorMsg.classList.add("hidden");
  });
});

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function addBugRow(value = "") {
  const row = document.createElement("div");
  row.className = "bug-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "bug-input";
  input.placeholder = "https://bugzilla.mozilla.org/show_bug.cgi?id=…";
  input.value = value;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-btn icon-btn";
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => {
    if (bugUrlsContainer.children.length > 1) row.remove();
  });

  row.append(input, removeBtn);
  bugUrlsContainer.appendChild(row);
  input.focus();
}

// Wire up the remove button on the initial row that's already in the HTML.
bugUrlsContainer.querySelector(".remove-btn").addEventListener("click", function() {
  if (bugUrlsContainer.children.length > 1) this.closest(".bug-row").remove();
});

bugAddBtn.addEventListener("click", () => addBugRow());

function addTagRow(value = "") {
  const row = document.createElement("div");
  row.className = "tag-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "tag-input";
  input.placeholder = "Add a tag…";
  input.value = value;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-btn icon-btn";
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => {
    if (tagsContainer.children.length > 1) row.remove();
  });

  row.append(input, removeBtn);
  tagsContainer.appendChild(row);
  input.focus();
}

tagsContainer.querySelector(".remove-btn").addEventListener("click", function() {
  if (tagsContainer.children.length > 1) this.closest(".tag-row").remove();
});

tagAddBtn.addEventListener("click", () => addTagRow());

async function loadTaggedMemories() {
  try {
    const memories = await browser.experiments.smartwindow.getMemories();
    taggedMemoriesContainer.replaceChildren();
    if (!memories.length) {
      const empty = document.createElement("div");
      empty.className = "tagged-memories-empty";
      empty.textContent = "No memories stored.";
      taggedMemoriesContainer.appendChild(empty);
      return;
    }
    for (const memory of memories) {
      const row = document.createElement("div");
      row.className = "tagged-memory-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "tagged-memory-input";
      checkbox.id = `tagged-memory-${memory.id}`;
      checkbox.value = memory.id;
      const label = document.createElement("label");
      label.htmlFor = checkbox.id;
      label.textContent = memory.memory_summary;
      row.append(checkbox, label);
      taggedMemoriesContainer.appendChild(row);
    }
  } catch (err) {
    taggedMemoriesContainer.replaceChildren();
    const errEl = document.createElement("div");
    errEl.className = "tagged-memories-empty";
    errEl.textContent = `Failed to load memories: ${err.message}`;
    taggedMemoriesContainer.appendChild(errEl);
  }
}
loadTaggedMemories();

function addStringListRow(container, value = "") {
  const row = document.createElement("div");
  row.className = "string-list-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "string-list-input";
  input.value = value;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-btn icon-btn";
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => {
    if (container.children.length > 1) row.remove();
  });

  row.append(input, removeBtn);
  container.appendChild(row);
  return input;
}

function buildArgInput(arg, toolName) {
  const format = TOOL_ARG_FORMATS[toolName]?.[arg.name];
  if (format === "iso-datetime") {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "YYYY-MM-DDTHH:MM:SS";
    return { el: input, kind: "iso-datetime" };
  }
  if (format === "string-list") {
    const rowsWrap = document.createElement("div");
    rowsWrap.className = "string-list-rows";
    addStringListRow(rowsWrap);
    return { el: rowsWrap, kind: "string-list" };
  }
  if (arg.enum && Array.isArray(arg.enum)) {
    const select = document.createElement("select");
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = arg.required ? "Select…" : "(omit)";
    select.appendChild(blank);
    for (const v of arg.enum) {
      const opt = document.createElement("option");
      opt.value = String(v);
      opt.textContent = String(v);
      select.appendChild(opt);
    }
    return { el: select, kind: "string" };
  }
  if (arg.type === "boolean") {
    const input = document.createElement("input");
    input.type = "checkbox";
    return { el: input, kind: "boolean" };
  }
  if (arg.type === "number" || arg.type === "integer") {
    const input = document.createElement("input");
    input.type = "number";
    if (arg.type === "integer") input.step = "1";
    return { el: input, kind: "number" };
  }
  if (arg.type === "object" || arg.type === "array") {
    const textarea = document.createElement("textarea");
    textarea.rows = 2;
    textarea.placeholder = arg.type === "array" ? "[…] (JSON)" : "{…} (JSON)";
    return { el: textarea, kind: "json" };
  }
  // string default
  const input = document.createElement("input");
  input.type = "text";
  return { el: input, kind: "string" };
}

function renderToolArgs(tool, argsWrap) {
  argsWrap.replaceChildren();
  for (const arg of tool.args) {
    const wrap = document.createElement("div");
    wrap.className = "tool-arg";

    const { el, kind } = buildArgInput(arg, tool.name);
    el.dataset.argName = arg.name;
    el.dataset.argKind = kind;
    if (arg.required) el.dataset.argRequired = "true";

    const label = document.createElement("label");
    label.className = "tool-arg-label";
    label.textContent = arg.name;
    if (arg.required) {
      const req = document.createElement("span");
      req.className = "tool-arg-required";
      req.textContent = "*";
      label.appendChild(req);
    }

    if (kind === "boolean") {
      wrap.classList.add("checkbox");
      wrap.append(el, label);
    } else if (kind === "string-list") {
      const labelRow = document.createElement("div");
      labelRow.className = "tool-arg-label-row";
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "icon-btn";
      addBtn.textContent = "+";
      addBtn.addEventListener("click", () => addStringListRow(el).focus());
      labelRow.append(label, addBtn);
      wrap.appendChild(labelRow);
      if (arg.description) {
        const desc = document.createElement("div");
        desc.className = "tool-arg-description";
        desc.textContent = arg.description;
        wrap.appendChild(desc);
      }
      wrap.appendChild(el);
    } else {
      wrap.appendChild(label);
      if (arg.description) {
        const desc = document.createElement("div");
        desc.className = "tool-arg-description";
        desc.textContent = arg.description;
        wrap.appendChild(desc);
      }
      wrap.appendChild(el);
    }

    if (kind !== "boolean") {
      const err = document.createElement("div");
      err.className = "tool-arg-error hidden";
      wrap.appendChild(err);
      // Clear validation state on any edit bubbling up from this arg's input(s).
      wrap.addEventListener("input", () => {
        el.classList.remove("date-error");
        err.classList.add("hidden");
      });
    }

    argsWrap.appendChild(wrap);
  }
}

function addToolRow() {
  const row = document.createElement("div");
  row.className = "tool-row";

  const header = document.createElement("div");
  header.className = "tool-row-header";

  const select = document.createElement("select");
  select.className = "tool-select";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Select a tool…";
  select.appendChild(blank);
  for (const tool of availableTools) {
    const opt = document.createElement("option");
    opt.value = tool.name;
    opt.textContent = tool.name;
    select.appendChild(opt);
  }

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-btn icon-btn";
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => row.remove());

  header.append(select, removeBtn);

  const argsWrap = document.createElement("div");
  argsWrap.className = "tool-args";

  select.addEventListener("change", () => {
    const tool = availableTools.find(t => t.name === select.value);
    if (tool) renderToolArgs(tool, argsWrap);
    else argsWrap.replaceChildren();
  });

  row.append(header, argsWrap);
  toolsContainer.appendChild(row);
}

async function loadTools() {
  try {
    const [tools, userMessageCount] = await Promise.all([
      browser.experiments.smartwindow.getTools(),
      browser.experiments.smartwindow.getUserMessageCount(),
    ]);
    availableTools = tools;
    applyConditionalRequired(availableTools, { userMessageCount });
    toolsContainer.replaceChildren();
    if (!availableTools.length) {
      const empty = document.createElement("div");
      empty.className = "tools-empty";
      empty.textContent = "No tools available.";
      toolsContainer.appendChild(empty);
      return;
    }
    toolAddBtn.hidden = false;
  } catch (err) {
    toolsContainer.replaceChildren();
    const errEl = document.createElement("div");
    errEl.className = "tools-empty";
    errEl.textContent = `Failed to load tools: ${err.message}`;
    toolsContainer.appendChild(errEl);
  }
}
loadTools();

toolAddBtn.addEventListener("click", addToolRow);

function collectToolValue(el) {
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
}

function isArgEmpty(el) {
  const kind = el.dataset.argKind;
  if (kind === "boolean") return false;
  if (kind === "string-list") {
    return Array.from(el.querySelectorAll(".string-list-input")).every(i => !i.value.trim());
  }
  return !el.value.trim();
}

function validateToolInputs() {
  let valid = true;
  for (const el of toolsContainer.querySelectorAll("[data-arg-name]")) {
    const wrap = el.closest(".tool-arg");
    const errEl = wrap?.querySelector(".tool-arg-error");
    const required = el.dataset.argRequired === "true";
    const kind = el.dataset.argKind;
    let error = null;
    if (required && isArgEmpty(el)) {
      error = "This field is required.";
    } else if (kind === "iso-datetime") {
      const v = el.value.trim();
      if (v && !ISO_DATETIME_RE.test(v)) error = "Use format YYYY-MM-DDTHH:MM:SS";
    }
    if (error) {
      if (kind === "iso-datetime") el.classList.add("date-error");
      if (errEl) {
        errEl.textContent = error;
        errEl.classList.remove("hidden");
      }
      valid = false;
    } else {
      el.classList.remove("date-error");
      errEl?.classList.add("hidden");
    }
  }
  return valid;
}

function collectTools() {
  const tools = [];
  for (const row of toolsContainer.querySelectorAll(".tool-row")) {
    const name = row.querySelector(".tool-select")?.value;
    if (!name) continue;
    const args = {};
    for (const el of row.querySelectorAll(".tool-args [data-arg-name]")) {
      const value = collectToolValue(el);
      if (value !== undefined) args[el.dataset.argName] = value;
    }
    tools.push({ name, args });
  }
  return tools;
}

exportBtn.addEventListener("click", async () => {
  exportBtn.disabled = true;
  statusEl.className = "status hidden";

  const bugzillaUrls = Array.from(bugUrlsContainer.querySelectorAll(".bug-input"))
    .map(i => i.value.trim())
    .filter(Boolean);

  const tags = Array.from(tagsContainer.querySelectorAll(".tag-input"))
    .map(i => i.value.trim())
    .filter(Boolean);

  const notes = document.getElementById("notes").value;
  const expectedBehavior = document.getElementById("expected-behavior").value;
  const expectedBehaviorTrimmed = expectedBehavior.trim();

  let startDate = "", endDate = "";
  const preset = historyPreset.value;
  if (preset === "custom") {
    const startVal = startDateInput.value.trim();
    const endVal = endDateInput.value.trim();
    let valid = true;
    if (!DATETIME_RE.test(startVal)) { startDateInput.classList.add("date-error"); valid = false; }
    else startDateInput.classList.remove("date-error");
    if (endVal && !DATETIME_RE.test(endVal)) { endDateInput.classList.add("date-error"); valid = false; }
    else endDateInput.classList.remove("date-error");
    if (!valid) {
      dateErrorMsg.classList.remove("hidden");
      exportBtn.disabled = false;
      return;
    }
    startDate = startVal;
    endDate = endVal;
  } else if (preset) {
    const now = new Date();
    startDate = formatLocalDatetime(new Date(now - PRESET_MS[preset]));
    endDate = formatLocalDatetime(now);
  }

  if (!validateToolInputs()) {
    exportBtn.disabled = false;
    return;
  }

  try {
    const taggedMemoryIds = Array.from(
      taggedMemoriesContainer.querySelectorAll(".tagged-memory-input:checked")
    ).map(cb => cb.value);

    const isSensitive = document.getElementById("sensitive-topic-input").checked;
    const expectFollowups = document.getElementById("followups-input").checked;
    const toolsGT = collectTools();

    const groundtruth = {};
    if (taggedMemoryIds.length) groundtruth.tagged_memories = taggedMemoryIds;
    if (isSensitive) groundtruth.sensitive_topic_disclaimers = { is_sensitive: true };
    if (expectFollowups) groundtruth.followups = [];
    if (toolsGT.length) groundtruth.tools = toolsGT;
    if (expectedBehaviorTrimmed) {
      groundtruth.user_journey = { expected_behavior: expectedBehaviorTrimmed };
    }

    const result = await browser.experiments.smartwindow.exportToFile({
      notes,
      bugzillaUrls,
      tags,
      groundtruth: Object.keys(groundtruth).length ? groundtruth : null,
      startDate,
      endDate,
    });

    if (result.saved) {
      showStatus(`Saved to: ${result.path}`, "success");
    } else {
      showStatus("Export cancelled.", "error");
    }
  } catch (err) {
    showStatus(`Error: ${err.message}`, "error");
  } finally {
    exportBtn.disabled = false;
  }
});
