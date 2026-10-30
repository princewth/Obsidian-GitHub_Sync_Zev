# Validation and release acceptance

## Automated validation

`npm run package` runs TypeScript checks, Vitest tests, the browser-targeted build, and the public-file privacy scanner. Test suites cover:

- Initial hydration, local-only notes, first-connect conflicts, and no implicit first-pass upload.
- Common-baseline text merge, binary conflicts, delete/edit conflicts, and stale conflict resolutions.
- Batch upload, atomic Git rename representation, exact deletion approval, missing roots, and read-only operation.
- Offline edits across restart, ambiguous upload recovery and ancestry, racing branch heads, edits during upload, and local changes during download.
- Durability failures, pause/unload behavior, scope/path checks, case/Unicode collisions, and safe errors.
- GitHub request structure, pagination, immutable blobs, size checks, truncated tree fallback, generic commit identity, and non-force ref updates.
- IndexedDB persistence/isolation, private-data-free diagnostics, native editor protection, local trash, simulated-host setup, connection preview, and token handling.
- Whole-vault configuration/archive exclusions, metadata resolution and stale-index checks, original-byte fidelity, aliases/images/headings/block links, safe labels, backlink/graph counts, inline text batching, binary deduplication, export journals, and explicit full-vault review.

Tests use in-memory repositories and a simulated Obsidian host. They do not access a real GitHub account or verify platform-specific WebView behavior. Do not describe these results as live device testing.

## Desktop acceptance checklist

Use a disposable vault and repository with dummy notes and images. Record the Obsidian version and operating system with your release notes.

- [ ] Install the ZIP and enable the plugin on Obsidian 1.11.4 or newer.
- [ ] Confirm the GitHub ribbon, command palette entries, settings, and browser pane work in light/dark themes.
- [ ] Store a fine-grained token; verify it is masked, absent from plugin files, and removable.
- [ ] Connect a private repo subfolder, a public read-only repo, and a branch with `/` in its name.
- [ ] Check a connection preview with existing local files, including differing same-path notes.
- [ ] Open downloaded notes in the native editor; verify backlinks, search, Graph, links, and image embeds after indexing.
- [ ] Create, edit, rename, move, and delete a note. Confirm changes outside the selected subtree are preserved.
- [ ] Enable automatic upload, wait for a batch, and verify the generic author/committer and commit message on GitHub.
- [ ] Go offline, edit, restart, reconnect, and verify changes survive and upload.
- [ ] Edit separate lines on two devices and confirm a clean merge. Edit the same line and confirm conflict review.
- [ ] Edit an image on both devices and confirm neither version is silently selected.
- [ ] Delete locally; confirm remote deletion requires the exact review list. Restore a remote deletion from local trash.
- [ ] Remove the local root or remote folder and confirm sync stops without deleting the opposite side.
- [ ] Test a read-only token and a protected branch; ensure errors are actionable and local edits survive.
- [ ] Pause, disable/re-enable the plugin, and disconnect; confirm native note tabs and files remain.
- [ ] Inspect safe diagnostics; verify no accounts, paths, note text, timestamps, or secrets appear.
- [ ] Verify the checksum of the exact ZIP being released.
- [ ] Preview and save a full-vault snapshot to a disposable repo. Confirm it includes notes outside the ordinary synced folder and that the review step makes this scope clear.
- [ ] Download the snapshot and open its `vault` folder as a separate vault. Confirm the generated core settings enable Backlinks, Outgoing links, and Graph after indexing, without copying credentials, original settings, or workspace history.
- [ ] Open `browse/` on GitHub and check aliases, nested paths, images, headings, block links, outgoing navigation, and backlinks. Confirm code examples remain untouched.
- [ ] Save another snapshot and verify the previous archive and unrelated repository files remain unchanged. Confirm ordinary sync and further exports exclude `Obsidian-Vaults`.
- [ ] Interrupt an export after commit creation/ref publication, reopen the archive panel, and verify publication status without uploading a duplicate snapshot.
- [ ] Check the console in light/dark themes, narrow sidebars, keyboard navigation, and reduced-motion mode. Paste a dummy token into the URL field and confirm it clears immediately and points to the masked token dialog.

## Mobile acceptance checklist

- [ ] Install on the intended iOS/Android versions with Obsidian 1.11.4 or newer.
- [ ] Test SecretStorage and IndexedDB retention across app restart and normal OS app suspension.
- [ ] Connect, download, open/edit Markdown, load images, and sync from the foreground.
- [ ] Verify small-screen settings, preview, conflict comparison, and deletion review remain usable.
- [ ] Suspend the app while offline; resume and confirm queued edits survive. Do not expect continuous OS background execution.
- [ ] Test storage-full behavior using disposable data; publishing must stop when the journal cannot save.

## Known concurrency limits

Native Markdown writes use `Vault.process` and check unsaved editor content. Binary writes and deletions are checked immediately before the native API call, but the public API offers no atomic compare-and-swap for those operations. Avoid concurrent external writes during those operations. The plugin never force-updates a branch ref; a maintainer can still rewrite history outside the plugin, which requires manual comparison.
