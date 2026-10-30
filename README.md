# GitHub Sync _ Zev

Open a GitHub repository folder inside Obsidian, edit Markdown with the native editor, and synchronize changes without installing Git.

**Author:** Zev · **License:** MIT · **Minimum Obsidian:** 1.11.4

[廣東話／繁體中文](README.zh-HK.md) · [Privacy](PRIVACY.md) · [Publishing](docs/PUBLISHING.md)

## What it does

- Connect an existing GitHub repository, branch, and subfolder to a new or existing vault folder.
- Preview remote files before connecting. Branch names containing slashes are supported.
- Edit notes in Obsidian's native Markdown editor. Native links, backlinks, search, and graph indexing work on downloaded files.
- Keep the selected subtree's supported notes and attachments available offline.
- Download updates automatically while Obsidian is active. Upload manually or enable automatic batched commits.
- Merge non-overlapping text changes using a common baseline. Review overlapping changes, binary conflicts, and delete-versus-edit conflicts without inserting markers into notes.
- Review remote deletions before publishing. Renames are committed as one add/delete batch.
- Recover ambiguous uploads after network failure or restart, including when GitHub accepted a commit but the response was lost.
- Connect multiple separate folders, use read-only connections, and pause individual workspaces.
- Save independent full-vault snapshots with preserved wiki-links, generated native Backlinks/Outgoing links/Graph settings, and a separate GitHub reading view with forward/backward navigation.
- Use a cyan/violet workspace console with status lights, pending/conflict counters, light/dark styling, and reduced-motion support.

## Save a standalone vault

In **GitHub workspaces**, click **Save full vault**. Choose a writable repository, preview the supported files across the entire vault, review the destination, and save. Each snapshot lives in a new `Obsidian-Vaults/snapshot-<id>/` directory and keeps:

- `vault/`: original notes and attachments, unchanged relative paths and wiki-links, plus three freshly generated core `.obsidian` files that enable Backlinks, Outgoing links, and Graph.
- `browse/`: GitHub-readable Markdown copies with clickable resolved links, image references, outgoing links, and backlink lists.
- `README.md` and `link-map.json`: restore instructions, a note index, and the resolved link graph.

To restore, download/extract the repository and use **Open folder as vault** on the snapshot's `vault/` directory, keeping its generated `.obsidian` directory. Obsidian rebuilds native backlinks and Graph after indexing. GitHub's reading view provides clickable navigation; live note transclusion and the interactive Obsidian graph require Obsidian.

Original plugin settings, tokens, workspace history, caches, and app preferences are not copied. The reserved `Obsidian-Vaults` folder is excluded from ordinary sync and future captures. Snapshots include supported notes beyond the connected folder, so review the full file list before saving to a public repository. See [the snapshot guide](docs/VAULT-SNAPSHOTS.md) for limits and recovery.

## Install

Until this plugin has been accepted into the Obsidian community directory, install a release manually:

1. Use Obsidian 1.11.4 or newer.
2. Download `github-sync-zev-1.1.0.zip` from this repository's Releases page.
3. Extract its `github-sync-zev` folder into `<vault>/.obsidian/plugins/`. If you use a custom configuration directory, use that directory instead of `.obsidian`.
4. Reload Obsidian, open **Settings → Community plugins**, and enable **GitHub Sync _ Zev**.

Alternatively, put `main.js`, `manifest.json`, and `styles.css` from the same release in that plugin folder. Keep the accompanying license and third-party notices when redistributing it. This project is independent of Obsidian and GitHub.

## Connect a folder

1. For private repositories or uploading, use **Set GitHub token** in the connection dialog (or the plugin's settings) to store a GitHub fine-grained personal access token. Limit it to the repositories you intend to connect. Grant **Contents: Read and write**, or **Read** for read-only connections. Metadata read permission is included by GitHub. Organization approval may also be required.
2. Click the GitHub ribbon icon, then **Connect folder**.
3. Paste a repository URL or a folder URL, such as `https://github.com/example/notes/tree/main/docs`.
4. Load the repository, select the branch and remote folder, and choose a local vault folder.
5. Preview the connection. Review existing local files and same-path differences.
6. Click **Connect and download**. The first pass downloads; it does not upload existing local-only files.
7. Review your notes, then click **Sync**. Optionally enable automatic uploads in the connection settings.

Public repositories can be read without a token, subject to GitHub's much smaller anonymous API rate limit. A token is recommended for ongoing use. Repositories must already be initialized with at least one commit, for example a README.

Automatic uploads are off by default. Remote refresh defaults to 60 seconds; automatic uploads, when enabled, wait 15 seconds after edits settle. Settings are device-specific: connect each device separately to the same GitHub folder.

## How the workspace behaves

The plugin does not mount a virtual filesystem or clone the entire repository. It lists a selected remote subtree and materializes its supported files in an ordinary vault folder. The native editor, other plugins, and offline use operate on these local files. Files become searchable as they download; full-folder indexing requires the download to complete.

Create, move, rename, and delete notes with Obsidian's normal file explorer. Use **New note** in the GitHub workspace browser as a shortcut. Internal links follow Obsidian's normal behavior; references outside the connected subtree are not downloaded automatically. Duplicate wiki-link names across repositories follow the vault's usual link resolution rules.

Supported text: `.md`, `.markdown`, `.txt`, `.csv`, `.canvas`, `.base`. Text must be UTF-8. Supported attachments: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.bmp`, `.svg`, `.pdf`, `.mp3`, `.mp4`, `.wav`, `.ogg`, `.webm`, `.m4a`.

Hidden paths, reserved filenames, common credential/secret filenames, scripts, private keys, unlisted file types, and the reserved `Obsidian-Vaults` archive directory are excluded from ordinary synchronization/capture. Original `.obsidian`, `.git`, `.env`, and token/settings files are never copied. Standalone exports create exactly three fixed core `.obsidian` files rather than copying device configuration. This is a fixed safety filter, not a full `.gitignore` implementation. It cannot identify every secret someone writes inside an ordinary note.

The default size limit is 10 MB per file, adjustable from 1–25 MB. Oversized supported files stop sync instead of appearing as deletions. Each connection allows up to 100 MB of supported content and 20,000 supported files; smaller subfolders provide a better experience. Symbolic links, submodules with supported-file names, and case/Unicode filename collisions are rejected. Empty folders are not represented in Git.

## Conflicts and deletions

The engine compares the last common content with local and remote content. Initial same-path differences need review because no common baseline exists. Non-overlapping text edits can merge automatically; overlapping edits keep both versions in a device-only conflict record. The conflict dialog offers local, remote, or an edited merged result. Changes made after opening the dialog cause a stale resolution to be rejected.

Uploads for a workspace wait while any conflict remains. Other workspaces can still sync. Resolving a conflict saves the chosen result locally; sync again to upload it. The dialog's local/GitHub buttons can also accept a deletion. Copy any alternate version you want to retain before resolving.

Local deletions always need a remote deletion review. Approval is tied to the exact deleted paths and their remote blob versions. A changed remote file must be reviewed again. Remote deletions of unchanged local files go to Obsidian's local trash. A missing entire local root or remote subfolder stops sync; it is not treated as deleting every note.

Disconnecting keeps files on both sides but removes that connection's device-only baseline and conflict records. Resolve or copy important conflicts first. Reconnecting starts with a fresh comparison.

## Privacy

Tokens use Obsidian SecretStorage. This plugin never serializes tokens into its settings, database, diagnostics, or release packages. The token field is masked and is never populated with a saved token.

Connection details, baselines, conflicts, and upload journals live in device-local IndexedDB, outside the vault's note tree. There is no plugin `data.json`. Ordinary note files are still in the vault and remain accessible to Obsidian and other installed plugins. SecretStorage protection and application/profile backups are controlled by Obsidian and your operating system.

Requests go only to `https://api.github.com`. There is no developer server, analytics, or telemetry. Generic commit author/committer metadata and commit messages avoid including your computer name, OS username, or private email. GitHub itself still knows the account associated with your token and records its activity. Public repository contents and history are public.

Use **Show private-data-free diagnostics** for bug reports; it contains only versions and counts. See [PRIVACY.md](PRIVACY.md) for the full data inventory.

## Limits and recovery

- This is periodic synchronization, not simultaneous character-by-character collaboration. Mobile background execution depends on the operating system. Return to Obsidian or use manual sync to refresh.
- A protected branch requiring pull requests must be accessed read-only or replaced with a writable branch. This version does not create pull requests or branches.
- Avoid having another synchronization service manage the same connected folder concurrently.
- Text replacement uses Obsidian's atomic `Vault.process` with an editor/content check. Obsidian's public API does not provide atomic binary replacement or deletion; those operations check contents immediately before writing, so simultaneous external binary writes should be avoided.
- Local changes persist as ordinary files. A durable journal records a prepared commit before its branch update and checks ancestry after a lost response. The plugin never force-pushes. If a branch is force-rewritten outside the plugin, review the resulting comparison before uploading.
- Clearing app storage removes baselines and conflict history. It does not delete local notes or GitHub files. Reconnect and review initial differences; do not clear storage as a routine troubleshooting step.

## Develop and release

Use Node.js 22 or newer:

```sh
npm ci
npm run dev
```

For validation and redistributable archives:

```sh
npm run package
```

The package command type-checks, runs tests, builds the plugin, checks the public-file allowlist for sensitive material, and creates installable/source ZIPs and SHA-256 checksums in `dist/`. Source maps, vault files, device state, credentials, and developer dependencies are excluded.

Tests cover engine recovery and races, GitHub request contracts, path boundaries, IndexedDB persistence, native editor protection, full-vault capture/export, link conversion and graph construction, publication recovery, and UI/lifecycle integration using a simulated Obsidian host. Actual desktop/mobile installation checks remain necessary before a public release; see [the release checklist](docs/TESTING.md).

The implementation is independent. [Kevin Chin's GitHub Sync](https://github.com/kevinmkchin/Obsidian-GitHub-Sync) was a behavior reference; its source is not included. The bundled three-way merge dependency is credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
