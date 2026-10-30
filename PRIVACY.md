# Privacy and data handling

GitHub Sync - Zev is authored by Zev. The public distribution contains plugin code and documentation, not a user's connections, notes, or credentials.

## Data inventory

| Data | Location | Sent to |
| --- | --- | --- |
| GitHub personal access token | Obsidian SecretStorage | GitHub API in the Authorization header |
| Random vault/device key | Obsidian vault-specific local storage | Nobody |
| Repository, branch, remote/local path, connection settings | Device-local IndexedDB | GitHub as needed to address requests |
| Baseline file contents, conflict versions, prepared upload journal | Device-local IndexedDB | Relevant file contents go to the selected GitHub repository during upload |
| Downloaded and edited notes/attachments | Chosen ordinary vault folder | Selected GitHub repository when uploaded; other installed apps/plugins/services may access the vault |
| Safe diagnostic report | Generated in a local dialog | Nobody automatically; the user may copy it |
| Standalone snapshot files and generated link graph | Constructed from a reviewed full-vault preview | The selected repository, after the explicit save action |
| Snapshot destination, counts, and publication commit/status | Device-local IndexedDB | GitHub for publication verification; not included in diagnostics |

The plugin does not write a `data.json`, token file, or note cache into its own plugin folder. Its IndexedDB database is named `github-sync-zev-device-v1`. Each vault uses a separate randomly keyed record. Connection metadata is intentionally not synchronized across devices.

Obsidian controls SecretStorage, its encryption/access behavior, and app/profile backup behavior. This plugin does not claim that all local device storage is encrypted, nor can it isolate secrets from other trusted plugins running in the same application. IndexedDB contains real note versions and should be treated as private application data.

## Network behavior

All plugin requests target `https://api.github.com` using Obsidian's native `requestUrl`. Calls read repository/branch metadata, immutable Git trees and blobs, create blobs/trees/commits, compare ancestry, and update the selected branch ref. Tokens are attached only to this fixed API host. User-provided credential-bearing URLs and alternative API hosts are rejected.

There is no developer-operated service, telemetry, analytics, advertising, remote code loading, or automatic bug-report upload. Opening GitHub yourself remains subject to GitHub's privacy policy. GitHub knows the token's account and can record its API activity even though commit metadata uses a generic name and noreply email.

## Public commits and sensitive content

Generated commits use the generic name `GitHub Sync`, email `github-sync@users.noreply.github.com`, and message `Update connected notes` or `Save standalone Obsidian vault`. The plugin does not read the system hostname, OS username, personal Git configuration, or private email. It does not modify an existing repository's Git configuration.

Full-vault export includes supported notes and attachments beyond a connected folder. Its preview and review step disclose that scope before publication. It preserves note contents without redaction and generates a relative-path link graph and readable backlink copies. Snapshots are stored under `Obsidian-Vaults/` and are public if the selected repository is public. The original application/plugin configuration is never copied; only three fixed, freshly generated core `.obsidian` settings files are added to enable native link features in a restored vault.

Files intentionally uploaded to a public repository, including their paths and history, become public. The plugin excludes hidden paths, common credential/secret filenames, private keys, scripts, and unlisted extensions. It does not redact ordinary note contents or scan every note for secrets. Choose the connected folder accordingly. Deleting a file later does not remove its prior Git history.

## Diagnostics and errors

The safe report contains plugin/version/schema information and aggregate counts only. It excludes account names, repositories, paths, tokens, commit IDs, note contents, device identifiers, and timestamps. Runtime error messages are constructed locally; raw GitHub response bodies and transport errors are not displayed or logged by the plugin. No runtime console logger is included.

## Retention and removal

Baselines persist for connected files. A conflict stores common, local, and remote versions until resolution or disconnection. Before a branch update, an upload journal persists the exact prepared commit and changes; after confirmation it is cleared. Remote deletions of unchanged local files use Obsidian's local trash.

Disconnecting removes one connection's baseline, conflict records, and ordinary sync journal; it keeps local files and GitHub history. Snapshot publication records remain device-local so an ambiguous export can still be checked. No full snapshot content is stored in those records. The latest 20 published snapshot records are retained along with unfinished/unpublished records; repository snapshots are not automatically deleted. The token remains available for other connections until **Remove token** is used. Removing the token writes an empty value to that plugin secret ID; Obsidian controls the underlying SecretStorage record lifecycle.

Uninstalling or disabling the plugin does not erase vault notes, GitHub files, or necessarily application-profile data. To remove all private state, first resolve/copy needed conflicts, disconnect each workspace, remove the token in settings, and remove the plugin. Any remaining application-profile backups or browser storage are managed by Obsidian and the operating system. Clearing storage destroys device-only conflict versions, so it is not a routine recovery step.
