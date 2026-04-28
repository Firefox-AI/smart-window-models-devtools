"use strict";

const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const PRESET_MS = { "1h": 3600000, "4h": 14400000, "24h": 86400000, "3d": 259200000, "7d": 604800000, "30d": 2592000000 };

function formatLocalDatetime(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const exportBtn = document.getElementById("export-btn");
const statusEl = document.getElementById("status");
const bugUrlsContainer = document.getElementById("bug-urls-container");
const bugAddBtn = document.getElementById("bug-add-btn");
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

exportBtn.addEventListener("click", async () => {
  exportBtn.disabled = true;
  statusEl.className = "status hidden";

  const bugzillaUrls = Array.from(bugUrlsContainer.querySelectorAll(".bug-input"))
    .map(i => i.value.trim())
    .filter(Boolean);

  const notes = document.getElementById("notes").value;

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

  try {
    const result = await browser.experiments.smartwindow.exportToFile({
      notes,
      bugzillaUrls,
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
