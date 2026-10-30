# 1.1.2

- Restore the source, tests, scripts, documentation, and workflows to their intended repository directories.
- Build and publish matching releases automatically, attaching main.js, manifest.json, and styles.css directly before publication.
- Include the version in release titles and verify the published required assets.
- Resolve blocking official ESLint findings without changing connection IDs or stored credentials.

# 1.1.1

- Replace unsupported punctuation in the public display name with an allowed hyphen: GitHub Sync - Zev.
- Keep the plugin ID, author, device database, and token keys unchanged for existing installations.
- Validate manifest display-name characters and plugin ID rules during packaging to catch directory naming errors before release.
- Update release metadata and publishing instructions for the corrected name.

# 1.1.0

- Save an independent, versioned snapshot of the entire vault's supported notes and attachments in `Obsidian-Vaults/`.
- Preserve original wiki-links, aliases, embeds, headings, block IDs, and relative folder paths in the standalone vault.
- Generate fresh core settings enabling Backlinks, Outgoing links, and Graph without copying private plugin settings or workspace history.
- Add a separate GitHub reading copy with clickable links, image references, heading/block links, outgoing navigation, per-note backlinks, and a complete link graph.
- Require a full-vault preview and explicit destination review before export. Keep exports separate from normal sync and future snapshots.
- Batch text into Git tree requests, deduplicate binary uploads, pace export writes, retain publication journals, and recover uncertain outcomes without duplicate uploads.
- Redesign GitHub workspaces as a cyan/violet console with status lights, counters, route badges, an archive panel, light-theme styling, and reduced-motion support.
- Add a masked token setup dialog to the connection flow and clear tokens accidentally pasted into the repository URL field.

# 1.0.0

- Connect existing GitHub folders and branches to native Obsidian vault folders.
- Preview connections and support branch names containing slashes.
- Edit supported Markdown/text files and attachments offline without a Git installation.
- Download updates and optionally publish automatic batched commits.
- Add three-way text merge, conflict review, read-only access, and per-workspace pause controls.
- Require review for remote deletions and preserve remote deletions in local trash.
- Recover lost upload responses using a durable device journal and commit ancestry.
- Store tokens through Obsidian SecretStorage and private runtime state in device IndexedDB.
- Include privacy-safe diagnostics, English/Cantonese documentation, release workflows, source archives, and checksums.

This release has automated contract, engine, persistence, vault, and simulated-host UI tests. Actual Obsidian desktop/mobile and live GitHub acceptance checks must be completed using `docs/TESTING.md` before distribution to the community directory.
