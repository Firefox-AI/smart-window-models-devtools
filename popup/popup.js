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

/**
 * Slice the *raw* conversation (integer roles: 0=user, 1=assistant) to just
 * the assistant messages that come after the last user message. The basic
 * view's raw-conversation pre-fills (tagged memories, follow-ups) all share
 * this filter — `memoriesApplied` and `followUpSuggestions` only live on
 * raw assistant messages, not on the openAI-format conversion.
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
 * Slice the compacted conversation to just the assistant + tool messages that
 * come after the last user message. The basic view's pre-fill logic only
 * looks at this window — it represents what the assistant did in response to
 * the latest user turn, which is the turn the export is scored against.
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
 * string at the wire level, so we parse them here.
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
 * get_page_content with different url_lists.
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

function formatLocalDatetime(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const expertModeToggle = document.getElementById("expert-mode-toggle");
const expertView = document.getElementById("expert-view");
const basicView = document.getElementById("basic-view");
expertModeToggle.addEventListener("change", () => {
  const expert = expertModeToggle.checked;
  expertView.classList.toggle("hidden", !expert);
  basicView.classList.toggle("hidden", expert);
});

const basicExportBtn = document.getElementById("basic-export-btn");
const basicStatusEl = document.getElementById("basic-status");
const basicExpectedBehaviorTextarea = document.getElementById("basic-q-expected-behavior");
const basicTaggedMemoriesCheckbox = document.getElementById("basic-q-tagged-memories");
const basicTaggedMemoriesSub = document.getElementById("basic-q-tagged-memories-sub");
const basicTaggedMemoriesList = document.getElementById("basic-q-tagged-memories-list");
const basicSensitiveTopicCheckbox = document.getElementById("basic-q-sensitive-topic");
const basicFollowupsCheckbox = document.getElementById("basic-q-followups");

basicTaggedMemoriesCheckbox.addEventListener("change", () => {
  basicTaggedMemoriesSub.classList.toggle("hidden", !basicTaggedMemoriesCheckbox.checked);
});

// Load memories once on popup open and render the checkbox list. Same
// shape and source the expert view's tagged-memories control uses. The
// promise is awaited by the basic-view pre-fill so memory checkboxes
// exist in the DOM before we try to flip them.
const memoriesReady = (async () => {
  try {
    const memories = await browser.experiments.smartwindow.getMemories();
    basicTaggedMemoriesList.replaceChildren();
    if (!memories.length) {
      const empty = document.createElement("div");
      empty.textContent = "No memories stored.";
      empty.className = "basic-memory-list-empty";
      basicTaggedMemoriesList.appendChild(empty);
      return;
    }
    for (const memory of memories) {
      const row = document.createElement("div");
      row.className = "basic-memory-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "basic-memory-input";
      cb.value = memory.id;
      const label = document.createElement("label");
      label.textContent = memory.memory_summary;
      label.addEventListener("click", () => cb.click());
      row.append(cb, label);
      basicTaggedMemoriesList.appendChild(row);
    }
  } catch (err) {
    basicTaggedMemoriesList.replaceChildren();
    const errEl = document.createElement("div");
    errEl.textContent = `Failed to load memories: ${err.message}`;
    errEl.className = "basic-memory-list-empty";
    basicTaggedMemoriesList.appendChild(errEl);
  }
})();
const basicWebSearchCheckbox = document.getElementById("basic-q-web-search");
const basicWebSearchSub = document.getElementById("basic-q-web-search-sub");
const basicSearchQueryInput = document.getElementById("basic-q-search-query");
const basicOpenTabsCheckbox = document.getElementById("basic-q-open-tabs");
const basicOpenTabsSub = document.getElementById("basic-q-open-tabs-sub");
const basicOpenTabsList = document.getElementById("basic-q-open-tabs-list");
const basicOtherPagesCheckbox = document.getElementById("basic-q-other-pages");
const basicOtherPagesSub = document.getElementById("basic-q-other-pages-sub");
const basicOtherPagesContainer = document.getElementById("basic-q-other-pages-container");
const basicOtherPagesAddBtn = document.getElementById("basic-q-other-pages-add-btn");
const basicHistoryCheckbox = document.getElementById("basic-q-browsing-history");
const basicHistorySub = document.getElementById("basic-q-browsing-history-sub");
const basicHistorySearchTermInput = document.getElementById("basic-q-history-search-term");
const basicHistoryStartTsInput = document.getElementById("basic-q-history-start-ts");
const basicHistoryEndTsInput = document.getElementById("basic-q-history-end-ts");

basicHistoryCheckbox.addEventListener("change", () => {
  basicHistorySub.classList.toggle("hidden", !basicHistoryCheckbox.checked);
  if (basicHistoryCheckbox.checked) basicHistorySearchTermInput.focus();
});

basicOtherPagesCheckbox.addEventListener("change", () => {
  basicOtherPagesSub.classList.toggle("hidden", !basicOtherPagesCheckbox.checked);
});

function addOtherPageRow() {
  const row = document.createElement("div");
  row.className = "basic-url-row";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "basic-other-page-input";
  input.placeholder = "https://…";
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-btn icon-btn";
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => {
    if (basicOtherPagesContainer.children.length > 1) row.remove();
  });
  row.append(input, removeBtn);
  basicOtherPagesContainer.appendChild(row);
  input.focus();
}

basicOtherPagesAddBtn.addEventListener("click", addOtherPageRow);
// Wire up the first row's hardcoded remove button (matches the bug-row / tag-row pattern).
basicOtherPagesContainer.querySelector(".remove-btn").addEventListener("click", function() {
  if (basicOtherPagesContainer.children.length > 1) this.parentElement.remove();
});

basicWebSearchCheckbox.addEventListener("change", () => {
  basicWebSearchSub.classList.toggle("hidden", !basicWebSearchCheckbox.checked);
  if (basicWebSearchCheckbox.checked) basicSearchQueryInput.focus();
});

basicOpenTabsCheckbox.addEventListener("change", () => {
  basicOpenTabsSub.classList.toggle("hidden", !basicOpenTabsCheckbox.checked);
});

// Snapshot open tabs once on popup open and render the checkbox list. The
// list lives inside the hidden sub-element so toggling the question is
// instantaneous (no loading flash). The promise is awaited by the basic-view
// pre-fill so it can flip tab checkboxes once they exist in the DOM.
const openTabsReady = (async () => {
  try {
    const tabs = await browser.experiments.smartwindow.getOpenTabs();
    basicOpenTabsList.replaceChildren();
    if (!tabs.length) {
      const empty = document.createElement("div");
      empty.textContent = "No tabs open.";
      empty.className = "basic-tab-list-empty";
      basicOpenTabsList.appendChild(empty);
      return;
    }
    for (const tab of tabs) {
      const row = document.createElement("div");
      row.className = "basic-tab-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "basic-tab-input";
      cb.dataset.url = tab.url || "";
      const label = document.createElement("label");
      label.textContent = tab.title || tab.url || "(untitled)";
      label.addEventListener("click", () => cb.click());
      row.append(cb, label);
      basicOpenTabsList.appendChild(row);
    }
  } catch (err) {
    basicOpenTabsList.replaceChildren();
    const errEl = document.createElement("div");
    errEl.textContent = `Failed to load tabs: ${err.message}`;
    errEl.className = "basic-tab-list-empty";
    basicOpenTabsList.appendChild(errEl);
  }
})();

// Conversation snapshots the basic view pre-fills questions from. Both are
// fetched once on popup open; they stay null until their fetches resolve.
//   - compactedConversation: openAI-format messages (post-PromptOptimizer)
//   - rawConversation: ChatConversation.messages, used for tagged-memories
//     pre-fill (carries per-message `memoriesApplied` metadata that's lost
//     in the openAI-format conversion).
let compactedConversation = null;
let rawConversation = null;
const compactedConversationReady = (async () => {
  try {
    [compactedConversation, rawConversation] = await Promise.all([
      browser.experiments.smartwindow.getCompactedConversation(),
      browser.experiments.smartwindow.getRawConversation(),
    ]);
    // Pre-fill needs DOM checkboxes (open tabs + memories) to exist before
    // it can flip them, so wait for those renderers too.
    await Promise.all([openTabsReady, memoriesReady]);
    prefillBasicView(compactedConversation, rawConversation);
  } catch (err) {
    console.warn("Failed to load conversation snapshots:", err);
    compactedConversation = compactedConversation ?? [];
    rawConversation = rawConversation ?? [];
  }
})();

/**
 * Pre-fill the basic view's question answers based on what the assistant
 * actually did in response to the last user turn. Only inspects assistant +
 * tool messages after the last user message; see getPostUserAssistantToolMessages.
 */
const SENSITIVE_TOPIC_DISCLAIMER = "This is not professional advice, but here's how to think about it.";

function prefillBasicView(compacted, raw) {
  const postMessages = getPostUserAssistantToolMessages(compacted);
  const userMessageCount = compacted.filter(m => m?.role === "user").length;

  // Tagged-memories + follow-ups questions both inspect the *raw*
  // conversation's post-last-user assistant messages (the openAI-format
  // conversion drops `memoriesApplied` and `followUpSuggestions`).
  const postUserRawAssistants = getPostUserRawAssistantMessages(raw);

  // Tagged-memories: collect every memoriesApplied[].id and check matching
  // memory rows (plus the main box and reveal the sub-list so the user
  // sees the pre-fill).
  const appliedIds = new Set();
  for (const msg of postUserRawAssistants) {
    if (!Array.isArray(msg.memoriesApplied)) continue;
    for (const mem of msg.memoriesApplied) {
      if (mem?.id) appliedIds.add(mem.id);
    }
  }
  if (appliedIds.size) {
    basicTaggedMemoriesCheckbox.checked = true;
    basicTaggedMemoriesSub.classList.remove("hidden");
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

  // Sensitive-topic question: if any assistant message after the last user
  // turn includes the disclaimer string, check the box.
  const disclaimerSeen = postMessages.some(
    m => m?.role === "assistant"
      && typeof m.content === "string"
      && m.content.includes(SENSITIVE_TOPIC_DISCLAIMER)
  );
  if (disclaimerSeen) {
    basicSensitiveTopicCheckbox.checked = true;
  }

  // Web-search question: was run_search called? → check the box. On turns 2+,
  // also reveal the sub-input and pre-fill the query from the tool call. The
  // `query` arg is only expected on follow-up turns, so on the first user
  // turn we leave the sub-question hidden.
  const runSearchArgs = getToolCallArgs(postMessages, "run_search");
  if (runSearchArgs) {
    basicWebSearchCheckbox.checked = true;
    if (userMessageCount >= 2) {
      basicWebSearchSub.classList.remove("hidden");
      if (typeof runSearchArgs.query === "string" && runSearchArgs.query.trim()) {
        basicSearchQueryInput.value = runSearchArgs.query;
      }
    }
  }

  // Open-tabs question: was get_open_tabs called? → check the main box and
  // reveal the tab sub-list.
  if (getToolCallArgs(postMessages, "get_open_tabs")) {
    basicOpenTabsCheckbox.checked = true;
    basicOpenTabsSub.classList.remove("hidden");
  }

  // Aggregate every URL the assistant tried to fetch via get_page_content
  // across all such calls in this turn, then split by whether it's currently
  // open in a tab:
  //   - Matches an open tab → check that tab's checkbox under Q3 (open tabs)
  //   - Not in any open tab → pre-fill Q4 (other pages) URL inputs
  const pageContentCalls = getAllToolCallArgs(postMessages, "get_page_content");
  const requestedUrls = pageContentCalls
    .flatMap(args => Array.isArray(args?.url_list) ? args.url_list : [])
    .filter(u => typeof u === "string" && u.trim());

  if (requestedUrls.length) {
    const openTabUrls = new Set(
      Array.from(basicOpenTabsList.querySelectorAll(".basic-tab-input"))
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
      for (const cb of basicOpenTabsList.querySelectorAll(".basic-tab-input")) {
        if (matchingTabUrls.has(cb.dataset.url)) cb.checked = true;
      }
    }

    // Q4: pre-fill the leftover (non-tab) URLs into input rows, check the
    // box, reveal the sub-section. Fill the existing hardcoded first row
    // first, then call addOtherPageRow() for any extras.
    if (otherUrls.length) {
      const firstInput = basicOtherPagesContainer.querySelector(".basic-other-page-input");
      firstInput.value = otherUrls[0];
      for (let i = 1; i < otherUrls.length; i++) {
        addOtherPageRow();
        const newInput = basicOtherPagesContainer.lastElementChild.querySelector("input");
        newInput.value = otherUrls[i];
      }
      basicOtherPagesCheckbox.checked = true;
      basicOtherPagesSub.classList.remove("hidden");
    }
  }

  // Browsing-history question: was search_browsing_history called? → check
  // the box, reveal the sub-section, and pre-fill any of searchTerm /
  // startTs / endTs that the tool call carried.
  const historyArgs = getToolCallArgs(postMessages, "search_browsing_history");
  if (historyArgs) {
    basicHistoryCheckbox.checked = true;
    basicHistorySub.classList.remove("hidden");
    if (typeof historyArgs.searchTerm === "string" && historyArgs.searchTerm.trim()) {
      basicHistorySearchTermInput.value = historyArgs.searchTerm;
    }
    // <input type="datetime-local" step="1"> accepts YYYY-MM-DDTHH:MM[:SS];
    // strip any fractional-seconds / timezone suffix the conversation might
    // carry (e.g. ".sssZ") so the picker accepts and displays the value.
    const normalizeDt = s => {
      if (typeof s !== "string") return "";
      const m = s.trim().match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/);
      return m ? m[0] : "";
    };
    const startTs = normalizeDt(historyArgs.startTs);
    if (startTs) basicHistoryStartTsInput.value = startTs;
    const endTs = normalizeDt(historyArgs.endTs);
    if (endTs) basicHistoryEndTsInput.value = endTs;
  }
}

/**
 * Template export flow for the basic (non-expert) view.
 *
 * TODO: gather the basic-view's form fields and pass them through to the
 * experiment API. Until the basic view has real inputs, this just calls
 * basicExportToFile with default/empty params — the same backend entry
 * point the in-page dialog's basic Save button dispatches to.
 */
async function runBasicExport() {
  basicExportBtn.disabled = true;
  basicStatusEl.className = "status hidden";

  try {
    const expectedOpenTabUrls = Array.from(
      basicOpenTabsList.querySelectorAll(".basic-tab-input:checked")
    ).map(cb => cb.dataset.url).filter(Boolean);

    const otherPageUrls = Array.from(
      basicOtherPagesContainer.querySelectorAll(".basic-other-page-input")
    ).map(i => i.value.trim()).filter(Boolean);

    // Normalize datetime-local value (YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS)
    // to the iso-datetime format the expert flow emits.
    const toIsoDatetime = v => {
      const t = (v || "").trim();
      if (!t) return "";
      return /T\d{2}:\d{2}$/.test(t) ? `${t}:00` : t;
    };

    const taggedMemoryIds = Array.from(
      basicTaggedMemoriesList.querySelectorAll(".basic-memory-input:checked")
    ).map(cb => cb.value);

    const options = {
      expectedBehavior: basicExpectedBehaviorTextarea.value.trim(),
      expectedTaggedMemories: basicTaggedMemoriesCheckbox.checked,
      taggedMemoryIds,
      sensitiveTopic: basicSensitiveTopicCheckbox.checked,
      followups: basicFollowupsCheckbox.checked,
      expectedWebSearch: basicWebSearchCheckbox.checked,
      searchQuery: basicSearchQueryInput.value.trim(),
      expectedOpenTabs: basicOpenTabsCheckbox.checked,
      expectedOpenTabUrls,
      expectedOtherPages: basicOtherPagesCheckbox.checked,
      otherPageUrls,
      expectedBrowsingHistory: basicHistoryCheckbox.checked,
      browsingHistorySearchTerm: basicHistorySearchTermInput.value.trim(),
      browsingHistoryStartTs: toIsoDatetime(basicHistoryStartTsInput.value),
      browsingHistoryEndTs: toIsoDatetime(basicHistoryEndTsInput.value),
    };
    const result = await browser.experiments.smartwindow.basicExportToFile(options);

    if (result.saved) {
      basicStatusEl.textContent = `Saved to: ${result.path}`;
      basicStatusEl.className = "status success";
    } else {
      basicStatusEl.textContent = "Export cancelled.";
      basicStatusEl.className = "status error";
    }
  } catch (err) {
    basicStatusEl.textContent = `Error: ${err.message}`;
    basicStatusEl.className = "status error";
  } finally {
    basicExportBtn.disabled = false;
  }
}

basicExportBtn.addEventListener("click", runBasicExport);

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
