# Architecture

## Components

- `main.ts`: plugin lifecycle, commands, events, foreground polling, upload debounce, and connection-scope validation.
- `ui.ts`: connection preview, workspace file browser, native note opening, settings, conflict resolution, deletion review, and diagnostics.
- `github.ts`: fixed-origin GitHub REST transport, immutable tree/blob reads, truncated-tree recovery, one-commit batch publication, and ancestry checks.
- `vault.ts`: scoped native file operations, supported-file selection, size limits, editor flush/checks, atomic Markdown updates, and local trash.
- `sync.ts`: baseline comparison, conservative initialization, three-way merge, upload review, durable publication recovery, and per-connection exclusion.
- `storage.ts`: transactional device-local IndexedDB persistence; no vault-backed plugin settings.
- `paths.ts`, `bytes.ts`, `merge.ts`, `privacy.ts`: reusable boundary, byte, merge, and diagnostic helpers.
- `vault-export.ts`: byte-preserving standalone package, fixed generated core settings, metadata-position link conversion, backlink navigation, and graph construction.
- `export-service.ts`, `export-ui.ts`: explicit full-vault preview/review, independent versioned publication, durable status checks, and commit-pinned restore/read links.

## Standalone archives

`VaultBridge.captureVault` reads the whole supported vault after flushing editors, excludes hidden/sensitive/configuration/archive files, collects links from native metadata, resolves them against original source paths, and rechecks file stamps/editor data. A stale link index or concurrent edit aborts the preview.

The builder leaves original bytes under `vault/`, creates only three fixed core `.obsidian` files, and adds Markdown reading copies under `browse/`. Native cache spans keep examples in code blocks untouched. A source/target adjacency index builds per-note forward/backward navigation and a complete `link-map.json` without repeatedly scanning the whole graph per note.

Publication targets a new `Obsidian-Vaults/snapshot-<id>/` namespace verified absent from the pinned root tree. Text is inserted inline in bounded Git tree batches; binary blobs are hash-verified and deduplicated. Export writes are paced, the final ref update is non-force, and other repository files are preserved. A durable commit journal supports ancestry verification after lost responses. Ordinary synchronization pauses during an export. The archive folder is excluded from synchronization/capture to prevent feedback loops.

## Data flow

```text
GitHub tree/blob API → selected subtree → native vault files → native editor/index
                                               ↓
                                       local content scan
                                               ↓
                  IndexedDB baseline → three-way comparison ← remote snapshot
                                               ↓
                         conflicts / deletion review / one prepared commit
                                               ↓
                                  durable in-flight journal
                                               ↓
                                    non-force branch update
```

Remote reads are pinned to immutable blob SHAs from a selected commit. A full root-tree SHA is retained so outgoing changes only replace the selected paths while preserving unrelated repository content. Branches are selected explicitly and never created implicitly.

## Comparison rules

Absent content is `null`; an empty file is a non-null empty base64 string. For each supported relative path:

1. Equal local/remote bytes establish a shared baseline.
2. Without a baseline, remote-only files download, local-only files remain pending, and differing same-path files conflict.
3. A local version equal to baseline accepts remote changes; a remote version equal to baseline leaves local changes pending for upload.
4. Both changed versions attempt a three-way text merge. Binary conflicts and edit/delete conflicts require review.
5. Any unresolved conflict stops that workspace's upload batch. Deletions need an approval fingerprint containing the exact paths and remote blob versions.

Native files are the durable local working copy. Baseline checkpoints avoid rewriting a growing database once per downloaded file. Interrupted initial downloads can recover by byte equality; if a missing checkpoint prevents proving a shared ancestor, the next comparison conservatively asks for conflict review. All pending publication state is saved before a remote ref update.

## Publication recovery

Create immutable blobs, a tree based on the remote root tree, and a commit parented to the fetched HEAD. Persist the prepared commit and exact outgoing bytes before updating the branch. Before publication, confirm the branch still points to the commit's parent; use `force: false` for the ref update. Retry concurrent branch advances up to three times by comparing again.

After an uncertain outcome, fetch the branch and check whether the prepared commit is its ancestor. If so, promote the journaled bytes to the baseline without a duplicate upload. Local edits made during upload remain different from that baseline and are pending for the next pass. A protected branch or authorization failure never causes a force push.

## Boundaries

Connections cannot overlap locally or within the same remote branch. Paths are relative, portable, normalized for collision checks, and exclude hidden/sensitive files. Only regular Git blobs with supported extensions are materialized. Truncation, unsupported objects, missing roots, invalid UTF-8, file limits, and storage failures stop operations conservatively.

Each file is limited to 1–25 MB, with 10 MB the default. A workspace is limited to 100 MB of supported content and 20,000 supported files. Complete scans prioritize correctness; remote blobs matching known baseline SHAs are not downloaded again.

Credentials are resolved at request time from SecretStorage and used only with the fixed GitHub API origin. Baselines, conflicts, and settings are private device state. Diagnostic exports use an explicit aggregate-field allowlist rather than redacting a serialized runtime state.
