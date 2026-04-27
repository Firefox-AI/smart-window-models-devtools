"use strict";

const exportBtn = document.getElementById("export-btn");
const statusEl = document.getElementById("status");
const bugUrlsContainer = document.getElementById("bug-urls-container");
const bugAddBtn = document.getElementById("bug-add-btn");

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
  const startDate = document.getElementById("start-date").value;
  const endDate = document.getElementById("end-date").value;

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
