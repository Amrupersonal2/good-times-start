# Fix: live site and editor preview showing different versions

## What I found

- **The live site is serving the latest version.** I opened good-times-start.lovable.app fresh, and its files contain the newest wording and the new Summary screen.
- **Your Chrome tab is running an old copy.** In your screenshots, the left menu shows "Cash Counter" and "Business". The live site stopped using that "Cash Counter" label at 15:23 UTC today, so your tab loaded a copy from before then.
- **That copy is too old to update itself.** Automatic updating was added at 16:03 UTC, after your tab's copy was made. It keeps running the old version until it is fully reloaded.
- **The offline copy can bring an old version back.** To keep working offline, the browser saves a copy of each page. If the site takes more than 3 seconds to load, it opens that saved copy. On slow counter Wi-Fi, this can reopen an old version even after a publish.
- **Bill links open an empty "Choose a table" screen.** Links like `/?bill=…` for D1 and Room 10A do this when the bill hasn't reached that device yet. Newer versions handle more of these cases. A device without its own copy of the bill still shows nothing.
- **KOT history order differs.** Your tab lists oldest first; the latest version lists newest first. The old copy explains this too.

## Fix right now (one time, on each counter)

Close every Restro POS tab and installed window, then reopen the site. Or press Ctrl+Shift+R (Cmd+Shift+R on Mac). Do this once; after that, the automatic updating keeps the counter current.

## What I will build

1. **Version label you can check.** A small version label in the header menu and in Settings, for example "Version 68260b4 · Latest" or "Update available". You can tell at a glance whether any counter matches the editor.
2. **Saved copies only when offline.** The browser will use its saved copy only when there is no internet, not just slow internet. Slow Wi-Fi will then load the current version, and offline billing keeps working.
3. **Old versions refresh themselves at startup.** When a page opens, it checks with the live site. If its version is older, it reloads once onto the new one, before staff start working. Saved bills on the device are kept.
4. **Clear out old saved copies.** Restro POS will delete the saved copies from older versions, so no browser can fall back to them.
5. **Bill links that work everywhere.** When a `?bill=` link opens on a device that doesn't have the bill yet, Restro POS fetches it from the cloud first. If it belongs to a table, it opens that table. It shows "Choose a table" only if the bill truly doesn't exist.
6. **Publish and check the live site.** After publishing, I'll open the live site in a fresh browser and check:
   - the version label matches the editor;
   - the menu shows Summary;
   - KOT history lists newest first;
   - the D1 and Room 10A bill links open their bills.

## Technical details

- The build id comes from the hashed main file name, exposed by a tiny `/build-id` server route and in the page. `AppUpdateWatcher` and the version label compare against it.
- In `public/sw.js`, bump the saved-copy version to v14 and remove the 3-second slow-network fallback. Pages use the saved copy only on a network error or when the browser is offline. Keep the 15-second timeout. Old saved copies are still deleted when the new version takes over.
- Run an early startup check in the root route: fetch the current page with `app-update-check`, compare its file names with the ones this page loaded, and if they differ, reload once (guarded in sessionStorage so it cannot loop).
- The `?bill=` route waits for a single-bill cloud pull by uid (signed-in member, existing sync helpers) before its "not on this device" state. A table bill then redirects to `?table=`.
- Tests: version comparison, the no-loop reload guard, and the bill-link fallback. Keep `e2e-workflow.test.ts` passing.
