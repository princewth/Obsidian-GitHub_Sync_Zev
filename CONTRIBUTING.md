# Contributing

Use Node.js 22 or newer, run `npm ci`, and use `npm run dev` for a watch build. Test in a disposable vault and GitHub repository. Do not place real tokens, private notes, or device exports in this source tree.

Run `npm run package` before proposing a change. This performs type checks, regression tests, build validation, and public-file checks. Add meaningful coverage when changing synchronization, recovery, path boundaries, or credential handling. The test host in `tests/obsidian.mock.ts` models API behavior; it is not a substitute for installing the plugin on real Obsidian devices.

Keep user-facing data in ordinary vault files, token values in SecretStorage, and private synchronization state in device IndexedDB. Do not add `saveData`, plaintext token storage, arbitrary API origins, or console logging of runtime data. Diagnostic fields must be explicitly allowlisted.

When changing a release version, update `package.json`, `package-lock.json`, `manifest.json`, `versions.json`, and `CHANGELOG.md` together. Update third-party notices when bundled dependencies change. Publish using a public alias and a GitHub noreply email if you want to keep personal commit identity private.

Bug reports should include reproducible steps using dummy content and the plugin's safe diagnostic report. Follow `SECURITY.md` for vulnerabilities.
