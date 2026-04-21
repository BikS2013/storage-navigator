---
name: Electron macOS branding requires folder rename
description: On macOS, renaming an unpackaged Electron app in dock/Cmd+Tab requires renaming the Electron.app folder itself — plist patching alone does not work.
type: feedback
---

To brand an unpackaged Electron app on macOS (dock tooltip, Cmd+Tab, Activity Monitor), you MUST rename the `Electron.app` folder to `Your App Name.app` before launching. Restore the original name on exit.

**Why:** macOS derives the dock tooltip and app switcher name from the `.app` bundle folder name. `app.name`, `CFBundleDisplayName`, `CFBundleName`, localized `InfoPlist.strings`, and `lsregister` cache flushing are all insufficient on their own — the folder name always wins.

**How to apply:** When setting up any Electron app's launch script, always rename the `.app` folder. See the skill at `.claude/skills/electron-app-branding.md` for the full checklist and code. Do not waste time trying plist-only approaches first.
