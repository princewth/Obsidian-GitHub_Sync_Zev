# Security policy

This project handles repository credentials and private note contents. Report suspected credential exposure, scope escapes, unsafe overwrites, or unauthorized network destinations privately through this repository's GitHub **Security → Report a vulnerability** feature when the maintainer has enabled it. Do not open a public issue containing credentials or private notes.

If private reporting has not been enabled, open a content-free issue asking the maintainer to enable it. Do not include exploit details or sensitive attachments until a private channel exists.

## Maintainer expectations

- Support the latest released version. Review fixes before tagging a new release.
- Keep token handling in Obsidian SecretStorage and API requests restricted to `api.github.com`.
- Never include tokens, note contents, repository identifiers, or device paths in diagnostic reports or logs.
- Preserve explicit remote-deletion review, conflict retention, durable upload recovery, and non-force ref updates.
- Treat truncated remote trees, missing roots, malformed state, unsupported file objects, and storage failures as stop conditions.
- Review scope/path normalization on every platform. Do not add arbitrary remote hosts or remote executable configuration without a deliberate design review.
- Keep release archives allowlisted. Run `npm run package` before publishing.

The plugin's API-level content checks reduce concurrent update risks. The public Obsidian API does not offer atomic binary replacement or deletion, so external concurrent writes remain a documented limitation. This is not a filesystem isolation boundary against other trusted Obsidian plugins.
