# Standalone vault snapshots

Use **GitHub workspaces → Save full vault**, or the command **Save standalone vault to GitHub**. Select a writable connected repository, preview the full vault, review the complete source list and destination, then save. This is an independent manual snapshot of supported notes and attachments from the entire vault; it is not limited to the selected connection's local folder.

Each save creates a new directory:

```text
Obsidian-Vaults/
└── snapshot-<random-id>/
    ├── README.md                 # restore instructions and note index
    ├── link-map.json             # resolved forward/backward link graph
    ├── vault/                    # original relative paths and bytes
    │   ├── .obsidian/
    │   │   ├── app.json          # freshly generated core preferences
    │   │   ├── core-plugins.json # Backlinks, Outgoing links, Graph, etc.
    │   │   └── graph.json        # freshly generated graph preferences
    │   ├── notes/
    │   └── attachments/
    └── browse/                   # GitHub-readable copies of Markdown notes
```

Existing snapshots are never overwritten. Files elsewhere in the repository are preserved. The reserved `Obsidian-Vaults` directory is excluded from normal synchronization and future vault captures, preventing backups from recursively including themselves.

## Restore native Obsidian links

Download the repository ZIP or clone it. Extract it and use Obsidian's **Open folder as vault** to open the chosen snapshot's `vault` directory. Retain the `.obsidian` directory inside it. Wait for Obsidian to index the notes, then use its Backlinks, Outgoing links, and Graph panes/commands.

Original note bytes and relative paths are preserved, including `[[wiki-links]]`, aliases, image/note embeds, frontmatter, heading references, and block IDs. Obsidian's own metadata index is rebuilt; it is not copied from a device. The generated core-plugin configuration enables the native link/graph features. Third-party plugin functionality may require installing its original plugin separately.

The three `.obsidian` files are generated from fixed public defaults. Original app settings, community plugin code/settings, credentials, workspace/tab history, caches, and this plugin's device database are not copied. Notes themselves are not automatically redacted.

## Browse links on GitHub

Open the snapshot README or `browse/`. Cached Obsidian references are resolved against their original source paths, then converted into relative Markdown links. Every reading copy includes outgoing links and backlinks. Images/attachments link to the original files under `vault/`, and `link-map.json` contains the full resolved graph.

Aliases, nested paths, Unicode filenames, common heading anchors, block links, image embeds, and same-note links are supported. Code examples are left alone because conversion uses native metadata positions instead of replacing every `[[...]]` string. Frontmatter link references contribute to the graph; their YAML values are preserved rather than rewritten. Missing or excluded targets stay unresolved and their count is shown during preview.

GitHub has no native Obsidian runtime. Note embeds become navigable references rather than live transclusions. The interactive Graph requires opening the restored vault in Obsidian. Complex/duplicate heading anchors can differ between GitHub and Obsidian. The GitHub reading copy is a snapshot and does not update until another export.

## Limits, review, and recovery

- The existing supported-file filter applies to the whole vault. Hidden paths, sensitive filenames, scripts/private keys, unsupported extensions, custom configuration directories, and prior snapshots are excluded.
- Source content is limited to 100 MB and 20,000 files; the configured per-file limit also applies. Original and generated reading copies together have a bounded export limit. Exceeding a limit stops export instead of silently omitting a supported file.
- Preview captures the reviewed content; later edits need a fresh preview. Edits/index updates detected during capture stop it conservatively.
- Text is batched into Git tree requests; identical binary uploads are deduplicated. Export writes are paced to reduce GitHub's secondary rate limiting. GitHub account/repository limits still apply.
- Folder synchronization pauses while a vault export is running. The branch ref is updated once, without force-pushing. A racing branch is fetched again, up to three attempts.
- A device-only publication journal is saved before updating the branch. If a response is lost, **Check publication status** verifies ancestry without uploading the snapshot again. Published links are pinned to the confirmed commit.
- Full-vault exports can include notes outside your ordinary connected folder. The review step makes this scope explicit. A public repository makes the exported notes, link graph, paths, and Git history public.

## Upgrade

Install the 1.1.1 release over the same `github-sync-zev` plugin directory. Existing 1.0 connection records, SecretStorage tokens, baselines, and conflicts keep their existing device keys and schema. No reset or reconnect is required for a normal upgrade. Keep a copy of important notes and unresolved alternate conflict versions before any application upgrade.
