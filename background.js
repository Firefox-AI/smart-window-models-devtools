"use strict";

browser.experiments.smartwindow.init().catch(console.error);

browser.commands.onCommand.addListener(command => {
  if (command === "trigger-export") {
    browser.experiments.smartwindow.triggerExport().catch(console.error);
  }
});

window.addEventListener("unload", () => {
  browser.experiments.smartwindow.uninit().catch(console.error);
});
