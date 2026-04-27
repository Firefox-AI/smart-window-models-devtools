# `smart-window-models-devtools`

This is an **unsigned**, **privileged** Firefox extension that exports SmartWindow model contextual data to help the Models team debug issues.

## Installation

Because this extension is **unsigned** and **privileged**, you must first set 2 prefs in `about:config`:
1. `extensions.experiments.enabled` to `true` -> Enables experiments so the extension can define its own API outside the normal WebExtension APIs
2. `xpinstall.signatures.required` to `false` -> Disables requiring extensions to be signed

Next, download the latest extension from the GitHub releases. It will be a `zip` file.

Open Nightly, and from the hamburger menu on the far right, choose "Extensions and themes".

On the next page, make sure you're on the "Extensions" page. If not, click "Extensions" on the left side. Click the gear next to "Manage Your Extensions", and choose "Install Add-on From File...". Pick the `zip` you just downloaded.

Nightly will say the extension is unverified. This is because it's not signed. Click "Add". You should see the extension in your installed list.

## Usage

`smart-window-models-devtools` creates a blue button at the top right of the SmartWindow new tab page and sidebar that says "Export Conversation". At any point, you can click this button to create a model context dump file.

When you click on the button, a pop up will overlay the screen with the following fields:

1. Bugzilla URLs: 1 or more URLs to Bugzillas associated with the dump file. Click the `+` to add more or the `x` to remove ones you don't want anymore. You can leave this blank.
2. Browsing History Date Range: **Optionally** include browsing history. Not every dump will need this. You must at least include a start datetime. If you do not include an end datetime, it fill be assumed to be the current datetime. Leaving both empty will skip this.
3. Notes: A freeform field for you to include whatever information you want to leave

Ctrl+Shift+E on Windows and Cmd+Shift+E on Mac will also open the same pop up.

Click save and choose a location and file name for your dump file. Hand this to the Models team.