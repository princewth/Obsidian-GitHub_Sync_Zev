# Publish GitHub Sync - Zev

The public name is **GitHub Sync - Zev**, author **Zev**, plugin ID **github-sync-zev**. No personal GitHub account, private repository URL, device path, or token is embedded. Replace the repository placeholders below with the public repository you own; do not put credentials into its URL.

The [manifest naming rules](https://docs.obsidian.md/Reference/Manifest#name) permit Basic Latin characters and only hyphens, plus signs, and parentheses as punctuation. Underscores are not permitted in the display name. Version 1.1.1 corrects the name while keeping the plugin ID stable. Commit the corrected root manifest on the default branch and publish the matching 1.1.1 release before submitting again.

## Prepare the public repository

1. Create a public GitHub repository for this plugin using your chosen public account/alias, for example a repository named `github-sync-zev`.
2. Extract the source archive and upload its project contents, or push the source tree. The repository's default branch must have `README.md`, `LICENSE`, and `manifest.json` directly at its root, alongside `src/`, package/build files, and the other project files. The source ZIP contains only allowlisted project files. Do not upload a vault or an Obsidian profile.
3. Use a public Git author alias and GitHub noreply email for your own source commits if you want to keep personal identity private. GitHub account association and previous commits are controlled by GitHub.
4. Check the actual repository files and history before making an existing private repository public. The provided package check inspects this source/release allowlist, not an arbitrary repository's entire Git history.
5. Enable private vulnerability reporting under the repository's security settings if available. No private contact address is hard-coded.

## Validate the release

```sh
npm ci
npm run package
```

Inspect `dist/`:

- `main.js`, `manifest.json`, `styles.css`: the Obsidian release assets.
- `LICENSE`, `THIRD_PARTY_NOTICES.md`: redistribution notices.
- `github-sync-zev-1.1.1.zip`: installable plugin folder.
- `github-sync-zev-1.1.1-source.zip`: allowlisted source project.
- `SHA256SUMS`: checksums for the distributed assets.

No `data.json`, `.env`, `.npmrc`, private key, source map, developer dependency tree, device database, or vault cache is packaged. The public-file scanner detects common credential formats and private absolute path formats; it is not a promise that arbitrary future edits contain no sensitive text. Inspect changes before publishing.

Complete [TESTING.md](TESTING.md) on your actual Obsidian installations and a disposable GitHub repository. Keep the distinction between automated mocked-host results and live device validation in your release notes.

## GitHub release

The included GitHub Actions workflow publishes when you push a plain version tag matching the manifest, for example `1.1.1` (without `v`). It runs the package checks and uploads the required Obsidian assets, both ZIPs, licenses, and checksums.

Alternatively, create a GitHub Release manually with tag `1.1.1` and attach the files listed above. The three Obsidian assets must be directly attached to the release, not only nested inside a ZIP. No personal access token needs to be committed; the workflow uses GitHub's built-in short-lived repository token.

For the manual GitHub interface: open your plugin repository, go to **Releases → Draft a new release**, create tag **1.1.1** on the default branch, and attach `main.js`, `manifest.json`, and `styles.css` from the installable ZIP as individual files. Include the licenses/notices as additional assets, then publish the release. The tag exactly matches the current root manifest's version.

## Submit to the Obsidian community directory

The current official submission flow uses the [Obsidian Community directory](https://community.obsidian.md). The earlier pull-request instructions for editing `community-plugins.json` have been replaced in this guide. Refer to the official [submission walkthrough](https://docs.obsidian.md/plugins/releasing/submit-plugin), [account/profile setup](https://docs.obsidian.md/community-directory/set-up-and-claim), [developer policies](https://docs.obsidian.md/community-directory/developer-policies), and [plugin submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins).

1. Finish the public source repository, matching GitHub release, and real-device acceptance checks above.
2. Go to **community.obsidian.md → Sign in** and use an Obsidian account. Create an Obsidian account if needed.
3. In **Community profile → GitHub → Connect**, authorize the official GitHub connection. It verifies repository ownership using read-only public-profile access. The plugin's synchronization token stays in Obsidian and is not needed in the submission form.
4. Set your intended public profile name, such as **Zev**, and review which profile details you want to publish.
5. Open **Plugins → New plugin**. Set **GitHub repository URL** to your public plugin source repository, for example `https://github.com/YOUR_PUBLIC_GITHUB_USERNAME/github-sync-zev`. Choose yourself or an appropriate organization as **Owner**.
6. Review and agree to the developer policies and confirm that you will maintain the entry, then select **Submit**. The directory reads `manifest.json` from the HEAD of the repository's default branch. Its ID must be unique across published plugins and must not contain `obsidian`; this project's ID is `github-sync-zev`.
7. Review the automated feedback shown in the directory. Fix any reported problems, increment the plugin version consistently, and publish a matching new GitHub release when needed.
8. Edit the listing description and use **Publish** as directed by the directory. The entry becomes installable within Obsidian only after automated review errors have been resolved and the publishing requirements have been met. Preparing a source ZIP or passing this project's tests does not itself approve the plugin.

Only the initial listing needs this submission. Keep the plugin ID stable for future updates; users obtain subsequent releases from GitHub through Obsidian. No submission or repository publication has been performed by preparing these local artifacts.

For subsequent versions, update all version metadata and the changelog, rerun checks, complete relevant device tests, and tag the matching version. Review privacy and third-party notices when adding dependencies or new network features.
