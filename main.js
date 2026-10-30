/* GitHub Sync _ Zev | MIT | Third-party notices: THIRD_PARTY_NOTICES.md */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => GitHubSyncZev
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/bytes.ts
function encode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
function decode(base64) {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}
function fromText(text) {
  return encode(new TextEncoder().encode(text));
}
function toText(base64) {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(decode(base64));
}
function asBuffer(bytes) {
  return bytes.slice().buffer;
}
async function blobSha(base64) {
  const bytes = decode(base64);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const data = new Uint8Array(header.length + bytes.length);
  data.set(header);
  data.set(bytes, header.length);
  const hash = await crypto.subtle.digest("SHA-1", asBuffer(data));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// src/types.ts
var MAX_WORKSPACE_BYTES = 100 * 1024 * 1024;
var DEFAULT_SETTINGS = {
  pollSeconds: 60,
  uploadDelaySeconds: 15,
  maxFileMB: 10
};
function emptyState() {
  return { schema: 1, settings: { ...DEFAULT_SETTINGS }, mounts: {} };
}
var UserError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "UserError";
  }
};
var ConcurrentUpdate = class extends UserError {
  constructor() {
    super("The branch changed during upload. Refresh and retry.");
  }
};
var LocalChanged = class extends UserError {
  constructor() {
    super("A local file changed during sync. Your edits were kept; sync again.");
  }
};

// src/paths.ts
var VAULT_ARCHIVE_ROOT = "Obsidian-Vaults";
var TEXT = /* @__PURE__ */ new Set(["md", "markdown", "txt", "csv", "canvas", "base"]);
var ASSETS = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "pdf", "mp3", "mp4", "wav", "ogg", "webm", "m4a"]);
var RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;
var SENSITIVE = /^(?:credentials?|secrets?|id_rsa|id_ed25519|service[-_]account)(?:\.|$)/i;
function safePath(value, allowEmpty = false) {
  const path = value.replace(/\/$/, "");
  if (!path && allowEmpty) return "";
  if (!path || path.length > 1e3 || /[\\\u0000-\u001f\u007f]/.test(path)) throw new UserError("Use a relative folder or file path.");
  for (const part of path.split("/")) {
    if (!part || part === "." || part === ".." || part.startsWith(".") || /[<>:"|?*]/.test(part) || /[. ]$/.test(part) || RESERVED.test(part)) {
      throw new UserError("Hidden, reserved, absolute, or unsafe paths cannot be connected.");
    }
  }
  return path;
}
function extension(path) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}
function isText(path) {
  return TEXT.has(extension(path));
}
function supported(path) {
  try {
    safePath(path);
  } catch {
    return false;
  }
  if (path.split("/").some((part) => part.toLowerCase() === VAULT_ARCHIVE_ROOT.toLowerCase())) return false;
  if (path.split("/").some((part) => SENSITIVE.test(part))) return false;
  return TEXT.has(extension(path)) || ASSETS.has(extension(path));
}
function inFolder(path, root) {
  return path === root || path.startsWith(`${root}/`);
}
function join(root, path) {
  return root ? `${root}/${path}` : path;
}
function checkCollisions(paths) {
  const seen = /* @__PURE__ */ new Set();
  const files = new Set(paths.map((path) => path.normalize("NFC").toLowerCase()));
  for (const path of paths) {
    safePath(path);
    const canonical = path.normalize("NFC").toLowerCase();
    if (seen.has(canonical)) throw new UserError("Case or Unicode filename collisions must be resolved before sync.");
    seen.add(canonical);
    const parts = canonical.split("/");
    parts.pop();
    while (parts.length) {
      if (files.has(parts.join("/"))) throw new UserError("A file and a folder use the same path. Resolve the collision before sync.");
      parts.pop();
    }
  }
}
function validateIdentity(owner, repo) {
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo) || repo === "." || repo === "..") {
    throw new UserError("Enter a valid GitHub owner and repository.");
  }
}
function validateBranch(branch) {
  if (!branch || branch.length > 255 || /[\s~^:?*\[\\\u0000-\u001f\u007f]/.test(branch) || branch.includes("..") || branch.includes("@{") || branch.startsWith("/") || branch.endsWith("/") || branch.endsWith(".") || branch.split("/").some((p) => !p || p.startsWith(".") || p.endsWith(".lock"))) {
    throw new UserError("Enter a valid branch name.");
  }
}
function parseRepoURL(input) {
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new UserError("Paste an HTTPS github.com repository or folder URL.");
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash) {
    throw new UserError("Use an HTTPS github.com URL without credentials, query parameters, or fragments.");
  }
  let parts;
  try {
    parts = url.pathname.replace(/\/$/, "").split("/").slice(1).map(decodeURIComponent);
  } catch {
    throw new UserError("The GitHub URL contains invalid encoding.");
  }
  const [owner = "", rawRepo = "", kind, ...tail] = parts;
  const repo = rawRepo.replace(/\.git$/, "");
  validateIdentity(owner, repo);
  if (kind && kind !== "tree") throw new UserError("Use a repository URL or a /tree/ branch folder URL.");
  if (kind === "tree" && !tail.length) throw new UserError("The folder URL is missing its branch.");
  return { owner, repo, treeTail: tail };
}
function resolveTreeURL(tail, branches, defaultBranch) {
  if (!tail.length) return { branch: defaultBranch, remotePath: "" };
  const full = tail.join("/");
  const branch = [...branches].sort((a, b) => b.length - a.length).find((b) => full === b || full.startsWith(`${b}/`));
  if (!branch) throw new UserError("The folder URL does not match a repository branch. Select the branch explicitly.");
  return { branch, remotePath: safePath(full.slice(branch.length).replace(/^\//, ""), true) };
}

// src/vault-export.ts
var EXPORT_ROOT = VAULT_ARCHIVE_ROOT;
var CORE_VAULT_FILES = Object.freeze({
  "vault/.obsidian/app.json": fromText(JSON.stringify({ useMarkdownLinks: false, newLinkFormat: "relative", alwaysUpdateLinks: true }, null, 2)),
  "vault/.obsidian/core-plugins.json": fromText(JSON.stringify(["file-explorer", "global-search", "switcher", "graph", "backlink", "outgoing-link", "tag-pane", "page-preview", "properties"], null, 2)),
  "vault/.obsidian/graph.json": fromText(JSON.stringify({ showAttachments: true, showOrphans: true }, null, 2))
});
function isMarkdown(path) {
  return ["md", "markdown"].includes(extension(path));
}
function markdownLabel(text) {
  return text.replace(/[\r\n]/g, " ").replace(/\\/g, "\\\\").replace(/[\[\]*_`]/g, "\\$&").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function relativeURL(source, target) {
  const from = source.split("/");
  from.pop();
  const to = target.split("/");
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => ".."), ...to].map((part) => part === ".." ? part : encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/") || "./";
}
function fragment(subpath) {
  if (!subpath) return "";
  if (subpath.startsWith("#^")) return `#block-${encodeURIComponent(subpath.slice(2))}`;
  const heading = subpath.split("#").filter(Boolean).pop() ?? "";
  return `#${encodeURIComponent(heading.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "").replace(/\s/g, "-"))}`;
}
function destination(path) {
  return `${isMarkdown(path) ? "browse" : "vault"}/${path}`;
}
function renderNote(path, capture, outgoingLinks, incomingPaths) {
  const original = toText(capture.files[path]);
  const source = `browse/${path}`;
  const operations = [];
  const seenSpans = /* @__PURE__ */ new Set();
  for (const link of outgoingLinks) {
    if (link.start === void 0 || link.end === void 0 || !link.target) continue;
    const key = `${link.start}:${link.end}`;
    if (seenSpans.has(key)) continue;
    seenSpans.add(key);
    if (link.start < 0 || link.end > original.length || link.start >= link.end || !link.original || original.slice(link.start, link.end) !== link.original) {
      throw new UserError("The link index is updating. Wait briefly and preview the vault again.");
    }
    const href = relativeURL(source, destination(link.target)) + fragment(link.subpath);
    const image = link.embed && ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"].includes(extension(link.target));
    const label = link.embed && isMarkdown(link.target) ? `Embedded note: ${link.label}` : link.label;
    operations.push({ start: link.start, end: link.end, replacement: `${image ? "!" : ""}[${markdownLabel(label)}](${href})` });
  }
  for (const block of capture.blocks[path] ?? []) {
    if (!/^[A-Za-z0-9-]+$/.test(block.id) || block.offset < 0 || block.offset > original.length) throw new UserError("The block index is updating. Preview the vault again.");
    operations.push({ start: block.offset, end: block.offset, replacement: `<a name="block-${block.id}"></a>
` });
  }
  operations.sort((a, b) => b.start - a.start || b.end - a.end);
  let content = original, boundary = original.length;
  for (const operation of operations) {
    if (operation.end > boundary) throw new UserError("The link index contains overlapping ranges. Preview again after indexing finishes.");
    content = content.slice(0, operation.start) + operation.replacement + content.slice(operation.end);
    boundary = operation.start;
  }
  const outgoing = [...new Set(outgoingLinks.filter((link) => link.target).map((link) => link.target))].sort();
  const incoming = [...new Set(incomingPaths)].sort();
  const list = (paths) => paths.length ? paths.map((target) => `- [${markdownLabel(target)}](${relativeURL(source, destination(target))})`).join("\n") : "_None._";
  return `${content}

---

## Linked notes

### Outgoing links

${list(outgoing)}

### Backlinks

${list(incoming)}

[Snapshot index](${relativeURL(source, "README.md")}) \xB7 [Original Obsidian note](${relativeURL(source, `vault/${path}`)})
`;
}
function buildVaultExport(capture, maxFileBytes, id = `snapshot-${crypto.randomUUID()}`) {
  if (!/^snapshot-[a-z0-9-]{8,80}$/.test(id)) throw new UserError("Invalid vault snapshot identifier.");
  const sourcePaths = Object.keys(capture.files).sort();
  if (!sourcePaths.length) throw new UserError("This vault has no supported notes or attachments to export.");
  if (sourcePaths.length > 2e4) throw new UserError("A vault export supports up to 20,000 source files.");
  checkCollisions(sourcePaths);
  let sourceBytes = 0;
  const files = { ...CORE_VAULT_FILES };
  for (const path of sourcePaths) {
    if (!supported(path)) throw new UserError("An excluded source file cannot be included in a vault snapshot.");
    const content = capture.files[path];
    const size = decode(content).length;
    if (size > maxFileBytes) throw new UserError("A source file exceeds the configured file size limit.");
    sourceBytes += size;
    if (isText(path)) {
      try {
        toText(content);
      } catch {
        throw new UserError("A vault text file contains invalid UTF-8.");
      }
    }
    files[`vault/${path}`] = content;
  }
  if (sourceBytes > MAX_WORKSPACE_BYTES) throw new UserError("The vault exceeds the 100 MB source-content limit.");
  const validPaths = new Set(sourcePaths);
  const links = capture.links.filter((link) => validPaths.has(link.source)).map((link) => ({ ...link, target: link.target && validPaths.has(link.target) ? link.target : null }));
  const resolved = links.filter((link) => link.target !== null);
  const notes = sourcePaths.filter(isMarkdown);
  const outgoing = /* @__PURE__ */ new Map(), incoming = /* @__PURE__ */ new Map();
  for (const link of resolved) {
    const from = outgoing.get(link.source) ?? [];
    from.push(link);
    outgoing.set(link.source, from);
    const to = incoming.get(link.target) ?? [];
    to.push(link.source);
    incoming.set(link.target, to);
  }
  for (const path of notes) files[`browse/${path}`] = fromText(renderNote(path, capture, outgoing.get(path) ?? [], incoming.get(path) ?? []));
  const edges = /* @__PURE__ */ new Map();
  for (const link of resolved) {
    const key = JSON.stringify([link.source, link.target]);
    const previous = edges.get(key);
    if (previous) previous.count++;
    else edges.set(key, { source: link.source, target: link.target, count: 1 });
  }
  files["link-map.json"] = fromText(JSON.stringify({ format: "github-sync-zev-vault-v1", nodes: sourcePaths, edges: [...edges.values()], unresolvedLinks: links.length - resolved.length }, null, 2));
  const index = notes.slice(0, 1e3).map((path) => `- [${markdownLabel(path)}](${relativeURL("README.md", `browse/${path}`)})`).join("\n");
  files["README.md"] = fromText(`# Obsidian vault snapshot

${notes.length} notes \xB7 ${sourcePaths.length} source files \xB7 ${resolved.length} resolved links.

## Open in Obsidian

Download this repository, extract it, and use **Open folder as vault** to open this snapshot's **vault** folder. Keep the generated **.obsidian** folder inside it. Original note bytes, relative paths, wiki-links, aliases, embeds, headings, and block IDs are preserved. The generated core settings enable Backlinks, Outgoing links, and Graph. Obsidian rebuilds the link index after opening. Community plugins, credentials, workspace history, and original application settings are not included.

## Read on GitHub

Use the **browse** folder for Markdown links and per-note outgoing/backlink lists. Images and attachments link to the originals in **vault**. Note embeds open the referenced note; live transclusion and the interactive Obsidian graph require Obsidian. Heading anchors follow GitHub conventions; duplicate/complex headings can differ. Missing or excluded targets remain unresolved.

${links.length - resolved.length} unresolved or excluded link references. See **link-map.json** for the complete resolved link graph. This is an independent snapshot; later local edits require another export.

## Notes

${index}${notes.length > 1e3 ? "\n\nShowing the first 1,000 notes; browse the directory for the rest." : ""}
`);
  const plan = {
    id,
    prefix: `${EXPORT_ROOT}/${id}`,
    files,
    sourcePaths,
    fileCount: sourcePaths.length,
    noteCount: notes.length,
    linkCount: resolved.length,
    unresolvedCount: links.length - resolved.length,
    excludedCount: capture.excluded,
    sourceBytes,
    uploadBytes: 0
  };
  validateExportFiles(plan, maxFileBytes);
  plan.uploadBytes = Object.values(files).reduce((sum, content) => sum + decode(content).length, 0);
  return plan;
}
function validateExportFiles(plan, maxFileBytes) {
  if (!/^snapshot-[a-z0-9-]{8,80}$/.test(plan.id) || plan.prefix !== `${EXPORT_ROOT}/${plan.id}`) throw new UserError("Invalid vault snapshot destination.");
  let total = 0;
  for (const [path, content] of Object.entries(plan.files)) {
    const generated = CORE_VAULT_FILES[path];
    if (generated !== void 0) {
      if (generated !== content) throw new UserError("Only freshly generated core vault settings can be exported.");
    } else if (path !== "README.md" && path !== "link-map.json") {
      const [category, ...parts] = path.split("/");
      const relative = parts.join("/");
      safePath(relative);
      if (!["vault", "browse"].includes(category) || !supported(relative) || category === "browse" && !isMarkdown(relative)) throw new UserError("An excluded file cannot be exported.");
    }
    const size = decode(content).length;
    if (size > maxFileBytes) throw new UserError("An exported file or generated link index exceeds the file size limit.");
    total += size;
    if (total > MAX_WORKSPACE_BYTES * 2 + 5 * 1024 * 1024) throw new UserError("The generated snapshot exceeds the export size limit.");
  }
  if (!Object.keys(plan.files).length) throw new UserError("The vault snapshot is empty.");
}

// src/github.ts
var GitHubClient = class {
  constructor(transport, getToken, maxBytes, exportWriteSpacingMs = 800) {
    this.transport = transport;
    this.getToken = getToken;
    this.maxBytes = maxBytes;
    this.exportWriteSpacingMs = exportWriteSpacingMs;
  }
  lastExportWrite = 0;
  root(connection) {
    validateIdentity(connection.owner, connection.repo);
    return `/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}`;
  }
  async request(path, secretId, method = "GET", body) {
    if (!path.startsWith("/repos/") || /[\r\n]/.test(path)) throw new UserError("Invalid GitHub request.");
    const token = this.getToken(secretId);
    if (method !== "GET" && !token) throw new UserError("Add a repository token in settings before uploading.");
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== void 0) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await this.transport({ url: `https://api.github.com${path}`, method, headers, ...body === void 0 ? {} : { body: JSON.stringify(body) } });
    } catch {
      throw new UserError("GitHub is unreachable. Local changes are safe; retry when online.");
    }
    if (response.status < 200 || response.status >= 300) {
      if (response.status === 401) throw new UserError("GitHub authentication failed. Replace the token in settings.");
      if (response.status === 404) throw new UserError("Repository, branch, or folder was not found. Check the connection and token access.");
      if (response.status === 409) {
        if (method === "GET") throw new UserError("Initialize this GitHub repository with a README before connecting.");
        throw new ConcurrentUpdate();
      }
      const remaining = Object.entries(response.headers).find(([key]) => key.toLowerCase() === "x-ratelimit-remaining")?.[1];
      if (response.status === 429 || response.status === 403 && remaining === "0") throw new UserError("GitHub rate limit reached. Pause sync and retry later, or add a token.");
      if (response.status === 403) throw new UserError("GitHub denied access. Check token permissions and branch rules; use a writable branch.");
      if (response.status === 422 && method === "PATCH") {
        const message = response.json && typeof response.json === "object" && "message" in response.json ? String(response.json.message) : "";
        if (/protect|rule|pull request/i.test(message)) throw new UserError("This branch requires a pull request or another repository rule. Use a writable branch or read-only access.");
        throw new ConcurrentUpdate();
      }
      if (response.status === 422) throw new UserError("GitHub rejected the update. Check branch rules, file sizes, and repository settings.");
      throw new UserError(`GitHub request failed (HTTP ${response.status}). Local changes were kept.`);
    }
    return response.json;
  }
  async repoInfo(owner, repo, secretId) {
    return this.request(this.root({ owner, repo }), secretId);
  }
  async branches(owner, repo, secretId) {
    const result = [];
    for (let page = 1; page <= 100; page++) {
      const data = await this.request(`${this.root({ owner, repo })}/branches?per_page=100&page=${page}`, secretId);
      result.push(...data.map((branch) => branch.name));
      if (data.length < 100) return result;
    }
    throw new UserError("This repository has too many branches to list. Use a smaller repository.");
  }
  async head(connection) {
    validateBranch(connection.branch);
    const ref = await this.request(`${this.root(connection)}/git/ref/heads/${connection.branch.split("/").map(encodeURIComponent).join("/")}`, connection.secretId);
    return ref.object.sha;
  }
  tree(connection, sha, recursive = false) {
    this.sha(sha);
    return this.request(`${this.root(connection)}/git/trees/${sha}${recursive ? "?recursive=1" : ""}`, connection.secretId);
  }
  sha(sha) {
    if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new UserError("GitHub returned an invalid object identifier.");
  }
  async revision(connection) {
    const head = await this.head(connection);
    this.sha(head);
    const commit = await this.request(`${this.root(connection)}/git/commits/${head}`, connection.secretId);
    this.sha(commit.tree.sha);
    return { head, tree: commit.tree.sha };
  }
  async snapshot(connection, allowMissingFolder = false) {
    const revision = await this.revision(connection);
    const { head } = revision;
    let folderTree = revision.tree;
    const path = safePath(connection.remotePath, true);
    for (const part of path ? path.split("/") : []) {
      const listing = await this.tree(connection, folderTree);
      if (listing.truncated) throw new UserError("The remote folder listing is incomplete. Choose a smaller folder.");
      const entry = listing.tree.find((entry2) => entry2.path === part);
      if (entry && entry.type !== "tree") throw new UserError("A file now occupies the remote folder path. Restore the folder before syncing.");
      if (!entry) {
        if (allowMissingFolder) return { head, tree: revision.tree, files: {}, folderMissing: true };
        throw new UserError("The connected remote folder no longer exists. Restore it or disconnect this workspace.");
      }
      folderTree = entry.sha;
    }
    let entries = await this.tree(connection, folderTree, true);
    if (entries.truncated) {
      const complete = [];
      const queue = [{ sha: folderTree, prefix: "" }];
      let traversed = 0;
      while (queue.length) {
        if (++traversed > 2e3) throw new UserError("The remote tree is too large. Connect a smaller folder.");
        const current = queue.shift();
        const listing = await this.tree(connection, current.sha);
        if (listing.truncated) throw new UserError("GitHub returned an incomplete directory. Sync stopped before changing files.");
        for (const entry of listing.tree) {
          const full = join(current.prefix, entry.path);
          if (entry.type === "tree") {
            try {
              safePath(full);
              queue.push({ sha: entry.sha, prefix: full });
            } catch {
            }
          } else complete.push({ ...entry, path: full });
        }
      }
      entries = { tree: complete };
    }
    const files = {};
    let totalBytes = 0;
    for (const entry of entries.tree) {
      if (!supported(entry.path)) continue;
      if (entry.type !== "blob" || entry.mode !== "100644" && entry.mode !== "100755") throw new UserError("A connected file is a symbolic link or unsupported Git object. Remove it from the selected folder.");
      if (!Number.isFinite(entry.size) || entry.size < 0 || entry.size > this.maxBytes()) throw new UserError("A remote file exceeds the configured size limit. Increase the limit or choose a smaller folder.");
      this.sha(entry.sha);
      totalBytes += entry.size;
      if (totalBytes > MAX_WORKSPACE_BYTES) throw new UserError("The selected files exceed the 100 MB workspace limit. Connect a smaller folder.");
      files[entry.path] = { sha: entry.sha, size: entry.size, mode: entry.mode };
    }
    if (Object.keys(files).length > 2e4) throw new UserError("Connect a folder containing fewer than 20,000 supported files.");
    checkCollisions(Object.keys(files));
    return { head, tree: revision.tree, files };
  }
  async read(connection, sha) {
    this.sha(sha);
    const blob = await this.request(`${this.root(connection)}/git/blobs/${sha}`, connection.secretId);
    if (blob.encoding !== "base64" || blob.size > this.maxBytes()) throw new UserError("The remote file cannot be downloaded within the size limit.");
    const content = blob.content.replace(/\s/g, "");
    let bytes;
    try {
      bytes = decode(content);
    } catch {
      throw new UserError("GitHub returned invalid file content.");
    }
    if (bytes.length !== blob.size || bytes.length > this.maxBytes() || await blobSha(content) !== sha) throw new UserError("Remote file verification failed. No local file was replaced.");
    return content;
  }
  async prepareCommit(connection, snapshot, changes) {
    if (!this.getToken(connection.secretId)) throw new UserError("Add a repository token in settings before uploading.");
    const tree = [];
    for (const [path, content] of Object.entries(changes)) {
      if (!supported(path)) throw new UserError("An excluded file cannot be uploaded.");
      let sha = null;
      if (content !== null) {
        if (decode(content).length > this.maxBytes()) throw new UserError("A local file exceeds the configured size limit.");
        const result = await this.request(`${this.root(connection)}/git/blobs`, connection.secretId, "POST", { content, encoding: "base64" });
        sha = result.sha;
        if (sha !== await blobSha(content)) throw new UserError("GitHub did not confirm the expected file content.");
      }
      tree.push({ path: join(connection.remotePath, safePath(path)), mode: snapshot.files[path]?.mode ?? "100644", type: "blob", sha });
    }
    return this.commitTree(connection, snapshot, tree, "Update connected notes");
  }
  async prepareVaultExport(connection, revision, plan, check = () => void 0) {
    validateExportFiles(plan, this.maxBytes());
    if (connection.access !== "read-write") throw new UserError("Choose a writable repository connection for vault export.");
    if (!this.getToken(connection.secretId)) throw new UserError("Store a GitHub token with Contents read and write access before saving a vault.");
    check();
    const root = await this.tree(connection, revision.tree);
    if (root.truncated) throw new UserError("Cannot verify the snapshot destination from an incomplete repository tree.");
    const namespace = root.tree.find((entry) => entry.path.normalize("NFC").toLowerCase() === EXPORT_ROOT.toLowerCase());
    if (namespace) {
      if (namespace.path !== EXPORT_ROOT) throw new UserError("A differently cased path uses the reserved vault archive name. Rename it before exporting.");
      if (namespace.type !== "tree") throw new UserError("A file is blocking the vault export directory.");
      const directory = await this.tree(connection, namespace.sha);
      if (directory.truncated) throw new UserError("The snapshot directory is too large to verify safely.");
      if (directory.tree.some((entry) => entry.path.toLowerCase() === plan.id.toLowerCase())) throw new UserError("This snapshot already exists. Check its publication result or create a new preview.");
    }
    const tree = [];
    const uploaded = /* @__PURE__ */ new Set();
    for (const [path, content] of Object.entries(plan.files)) {
      check();
      if (isText(path) || path.endsWith(".json")) {
        tree.push({ path: `${plan.prefix}/${path}`, mode: "100644", type: "blob", content: toText(content) });
        continue;
      }
      const sha = await blobSha(content);
      if (!uploaded.has(sha)) {
        const result = await this.exportWrite(`${this.root(connection)}/git/blobs`, connection.secretId, { content, encoding: "base64" }, check);
        if (result.sha !== sha) throw new UserError("GitHub did not confirm the expected snapshot content.");
        uploaded.add(sha);
      }
      tree.push({ path: `${plan.prefix}/${path}`, mode: "100644", type: "blob", sha });
    }
    let baseTree = revision.tree, batch = [], batchBytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      const next = await this.exportWrite(`${this.root(connection)}/git/trees`, connection.secretId, { base_tree: baseTree, tree: batch }, check);
      this.sha(next.sha);
      baseTree = next.sha;
      batch = [];
      batchBytes = 0;
    };
    for (const entry of tree) {
      const bytes = new TextEncoder().encode(JSON.stringify(entry)).length;
      if (batch.length && (batchBytes + bytes > 2 * 1024 * 1024 || batch.length >= 2e3)) await flush();
      batch.push(entry);
      batchBytes += bytes;
    }
    await flush();
    const identity = { name: "GitHub Sync", email: "github-sync@users.noreply.github.com" };
    const commit = await this.exportWrite(`${this.root(connection)}/git/commits`, connection.secretId, {
      message: "Save standalone Obsidian vault",
      tree: baseTree,
      parents: [revision.head],
      author: identity,
      committer: identity
    }, check);
    this.sha(commit.sha);
    return commit.sha;
  }
  async exportWrite(path, secretId, body, check) {
    check();
    const wait = this.lastExportWrite + this.exportWriteSpacingMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    check();
    this.lastExportWrite = Date.now();
    return this.request(path, secretId, "POST", body);
  }
  async commitTree(connection, revision, tree, message) {
    const nextTree = await this.request(`${this.root(connection)}/git/trees`, connection.secretId, "POST", { base_tree: revision.tree, tree });
    const identity = { name: "GitHub Sync", email: "github-sync@users.noreply.github.com" };
    const commit = await this.request(`${this.root(connection)}/git/commits`, connection.secretId, "POST", {
      message,
      tree: nextTree.sha,
      parents: [revision.head],
      author: identity,
      committer: identity
    });
    this.sha(commit.sha);
    return commit.sha;
  }
  async publish(connection, commit) {
    this.sha(commit);
    const prepared = await this.request(`${this.root(connection)}/git/commits/${commit}`, connection.secretId);
    const current = await this.head(connection);
    if (current === commit) return;
    if (prepared.parents.length !== 1 || prepared.parents[0]?.sha !== current) throw new ConcurrentUpdate();
    await this.request(`${this.root(connection)}/git/refs/heads/${connection.branch.split("/").map(encodeURIComponent).join("/")}`, connection.secretId, "PATCH", { sha: commit, force: false });
  }
  async containsCommit(connection, ancestor, head) {
    if (ancestor === head) return true;
    this.sha(ancestor);
    this.sha(head);
    const comparison = await this.request(`${this.root(connection)}/compare/${ancestor}...${head}`, connection.secretId);
    return comparison.status === "ahead" || comparison.status === "identical";
  }
};

// src/storage.ts
function validateState(value) {
  if (!value || typeof value !== "object") throw new UserError("Device storage is unreadable. Sync is stopped to protect your files.");
  const state = value;
  if (state.schema !== 1 || !state.settings || !state.mounts || Array.isArray(state.mounts)) {
    throw new UserError("This device has an unsupported workspace database. Keep it intact and use a compatible plugin version.");
  }
  const { pollSeconds, uploadDelaySeconds, maxFileMB } = state.settings;
  if (![pollSeconds, uploadDelaySeconds, maxFileMB].every(Number.isFinite) || pollSeconds < 30 || pollSeconds > 3600 || uploadDelaySeconds < 5 || uploadDelaySeconds > 300 || maxFileMB < 1 || maxFileMB > 25) {
    throw new UserError("Device settings are invalid. Sync is stopped.");
  }
  for (const [id, mount] of Object.entries(state.mounts)) {
    if (!mount || !mount.connection || mount.connection.id !== id || !mount.baseline || !mount.conflicts) throw new UserError("A workspace record is unreadable. Sync is stopped.");
    const connection = mount.connection;
    validateIdentity(connection.owner, connection.repo);
    validateBranch(connection.branch);
    safePath(connection.localPath);
    safePath(connection.remotePath, true);
    if (!["read-only", "read-write"].includes(connection.access) || !/^[a-z0-9-]+$/.test(connection.secretId)) throw new UserError("A workspace record is invalid.");
    for (const path of Object.keys(mount.baseline)) safePath(path);
    for (const path of Object.keys(mount.conflicts)) safePath(path);
  }
  if (state.vaultExports !== void 0) {
    if (!state.vaultExports || typeof state.vaultExports !== "object" || Array.isArray(state.vaultExports)) throw new UserError("Vault export history is unreadable.");
    for (const [id, record] of Object.entries(state.vaultExports)) {
      if (!record || record.id !== id || !/^snapshot-[a-z0-9-]{8,80}$/.test(id) || record.prefix !== `${EXPORT_ROOT}/${id}` || !["preparing", "pending", "published", "not-published"].includes(record.status)) throw new UserError("A vault export record is invalid.");
      validateIdentity(record.target.owner, record.target.repo);
      validateBranch(record.target.branch);
      if (!/^[a-z0-9-]+$/.test(record.target.secretId) || record.commit !== null && !/^[0-9a-f]{40,64}$/.test(record.commit)) throw new UserError("A vault export record is invalid.");
    }
  }
  return state;
}
var DeviceStore = class {
  constructor(key, databaseName = "github-sync-zev-device-v1") {
    this.key = key;
    this.databaseName = databaseName;
  }
  data = emptyState();
  db = null;
  writes = Promise.resolve();
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("workspaces");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new UserError("Device database is unavailable. No sync was started."));
      request.onblocked = () => reject(new UserError("Close other Obsidian windows using this workspace and retry."));
    });
    this.db.onversionchange = () => this.close();
    const stored = await new Promise((resolve, reject) => {
      const request = this.db.transaction("workspaces").objectStore("workspaces").get(this.key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new UserError("Cannot read the device database."));
    });
    if (stored !== void 0) this.data = validateState(stored);
    else await this.save();
  }
  save() {
    const snapshot = structuredClone(this.data);
    const operation = this.writes.catch(() => void 0).then(() => new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new UserError("Device storage is closed. Sync is stopped."));
        return;
      }
      const transaction = this.db.transaction("workspaces", "readwrite");
      transaction.objectStore("workspaces").put(snapshot, this.key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new UserError("Cannot save the device journal. Check free storage; sync was stopped."));
    }));
    this.writes = operation;
    return operation;
  }
  async flush() {
    await this.writes;
  }
  close() {
    this.db?.close();
    this.db = null;
  }
};

// node_modules/node-diff3/dist/diff3.mjs
function LCS(buffer1, buffer2) {
  let equivalenceClasses = /* @__PURE__ */ Object.create(null);
  for (let j = 0; j < buffer2.length; j++) {
    const item = buffer2[j];
    if (equivalenceClasses[item]) {
      equivalenceClasses[item].push(j);
    } else {
      equivalenceClasses[item] = [j];
    }
  }
  const NULLRESULT = { buffer1index: -1, buffer2index: -1, chain: null };
  let candidates = [NULLRESULT];
  for (let i = 0; i < buffer1.length; i++) {
    const item = buffer1[i];
    const buffer2indices = equivalenceClasses[item] || [];
    let r = 0;
    let c = candidates[0];
    for (const j of buffer2indices) {
      let s;
      for (s = r; s < candidates.length; s++) {
        if (candidates[s].buffer2index < j && (s === candidates.length - 1 || candidates[s + 1].buffer2index > j)) {
          break;
        }
      }
      if (s < candidates.length) {
        const newCandidate = { buffer1index: i, buffer2index: j, chain: candidates[s] };
        if (r === candidates.length) {
          candidates.push(c);
        } else {
          candidates[r] = c;
        }
        r = s + 1;
        c = newCandidate;
        if (r === candidates.length) {
          break;
        }
      }
    }
    candidates[r] = c;
  }
  return candidates[candidates.length - 1];
}
function diffIndices(buffer1, buffer2) {
  const lcs = LCS(buffer1, buffer2);
  let result = [];
  let tail1 = buffer1.length;
  let tail2 = buffer2.length;
  for (let candidate = lcs; candidate !== null; candidate = candidate.chain) {
    const mismatchLength1 = tail1 - candidate.buffer1index - 1;
    const mismatchLength2 = tail2 - candidate.buffer2index - 1;
    tail1 = candidate.buffer1index;
    tail2 = candidate.buffer2index;
    if (mismatchLength1 || mismatchLength2) {
      result.push({
        buffer1: [tail1 + 1, mismatchLength1],
        buffer1Content: buffer1.slice(tail1 + 1, tail1 + 1 + mismatchLength1),
        buffer2: [tail2 + 1, mismatchLength2],
        buffer2Content: buffer2.slice(tail2 + 1, tail2 + 1 + mismatchLength2)
      });
    }
  }
  result.reverse();
  return result;
}
function diff3MergeRegions(a, o, b) {
  let hunks = [];
  function addHunk(h, ab) {
    hunks.push({
      ab,
      oStart: h.buffer1[0],
      oLength: h.buffer1[1],
      abStart: h.buffer2[0],
      abLength: h.buffer2[1]
    });
  }
  diffIndices(o, a).forEach((item) => addHunk(item, "a"));
  diffIndices(o, b).forEach((item) => addHunk(item, "b"));
  hunks.sort((x, y) => x.oStart - y.oStart);
  let results = [];
  let currOffset = 0;
  function advanceTo(endOffset) {
    if (endOffset > currOffset) {
      results.push({
        stable: true,
        buffer: "o",
        bufferStart: currOffset,
        bufferLength: endOffset - currOffset,
        bufferContent: o.slice(currOffset, endOffset)
      });
      currOffset = endOffset;
    }
  }
  while (hunks.length) {
    let hunk = hunks.shift();
    let regionStart = hunk.oStart;
    let regionEnd = hunk.oStart + hunk.oLength;
    let regionHunks = [hunk];
    advanceTo(regionStart);
    while (hunks.length) {
      const nextHunk = hunks[0];
      const nextHunkStart = nextHunk.oStart;
      if (nextHunkStart > regionEnd)
        break;
      regionEnd = Math.max(regionEnd, nextHunkStart + nextHunk.oLength);
      regionHunks.push(hunks.shift());
    }
    if (regionHunks.length === 1) {
      if (hunk.abLength > 0) {
        const buffer = hunk.ab === "a" ? a : b;
        results.push({
          stable: true,
          buffer: hunk.ab,
          bufferStart: hunk.abStart,
          bufferLength: hunk.abLength,
          bufferContent: buffer.slice(hunk.abStart, hunk.abStart + hunk.abLength)
        });
      }
    } else {
      let bounds = {
        a: [a.length, -1, o.length, -1],
        b: [b.length, -1, o.length, -1]
      };
      while (regionHunks.length) {
        hunk = regionHunks.shift();
        const oStart = hunk.oStart;
        const oEnd = oStart + hunk.oLength;
        const abStart = hunk.abStart;
        const abEnd = abStart + hunk.abLength;
        let b2 = bounds[hunk.ab];
        b2[0] = Math.min(abStart, b2[0]);
        b2[1] = Math.max(abEnd, b2[1]);
        b2[2] = Math.min(oStart, b2[2]);
        b2[3] = Math.max(oEnd, b2[3]);
      }
      const aStart = bounds.a[0] + (regionStart - bounds.a[2]);
      const aEnd = bounds.a[1] + (regionEnd - bounds.a[3]);
      const bStart = bounds.b[0] + (regionStart - bounds.b[2]);
      const bEnd = bounds.b[1] + (regionEnd - bounds.b[3]);
      let result = {
        stable: false,
        aStart,
        aLength: aEnd - aStart,
        aContent: a.slice(aStart, aEnd),
        oStart: regionStart,
        oLength: regionEnd - regionStart,
        oContent: o.slice(regionStart, regionEnd),
        bStart,
        bLength: bEnd - bStart,
        bContent: b.slice(bStart, bEnd)
      };
      results.push(result);
    }
    currOffset = regionEnd;
  }
  advanceTo(o.length);
  return results;
}
function diff3Merge(a, o, b, options) {
  let defaults = {
    excludeFalseConflicts: true,
    stringSeparator: /\s+/
  };
  options = Object.assign(defaults, options);
  if (typeof a === "string")
    a = a.split(options.stringSeparator);
  if (typeof o === "string")
    o = o.split(options.stringSeparator);
  if (typeof b === "string")
    b = b.split(options.stringSeparator);
  let results = [];
  const regions = diff3MergeRegions(a, o, b);
  let okBuffer = [];
  function flushOk() {
    if (okBuffer.length) {
      results.push({ ok: okBuffer });
    }
    okBuffer = [];
  }
  function isFalseConflict(a2, b2) {
    if (a2.length !== b2.length)
      return false;
    for (let i = 0; i < a2.length; i++) {
      if (a2[i] !== b2[i])
        return false;
    }
    return true;
  }
  regions.forEach((region) => {
    if (region.stable) {
      okBuffer.push(...region.bufferContent);
    } else {
      if (options.excludeFalseConflicts && isFalseConflict(region.aContent, region.bContent)) {
        okBuffer.push(...region.aContent);
      } else {
        flushOk();
        results.push({
          conflict: {
            a: region.aContent,
            aIndex: region.aStart,
            o: region.oContent,
            oIndex: region.oStart,
            b: region.bContent,
            bIndex: region.bStart
          }
        });
      }
    }
  });
  flushOk();
  return results;
}

// src/merge.ts
function mergeText(local, base, remote) {
  try {
    const lines = (content) => toText(content).match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const blocks = diff3Merge(lines(local), lines(base), lines(remote));
    let merged = "";
    for (const block of blocks) {
      if (block.conflict || !block.ok) return null;
      merged += block.ok.join("");
    }
    return fromText(merged);
  } catch {
    return null;
  }
}

// src/sync.ts
var SyncEngine = class {
  constructor(store, local, remote, changed = () => void 0) {
    this.store = store;
    this.local = local;
    this.remote = remote;
    this.changed = changed;
  }
  running = /* @__PURE__ */ new Set();
  stopped = false;
  statuses = /* @__PURE__ */ new Map();
  stop() {
    this.stopped = true;
  }
  isRunning(id) {
    return this.running.has(id);
  }
  isStopped() {
    return this.stopped;
  }
  check() {
    if (this.stopped) throw new UserError("Plugin is unloading. Your local changes are safe.");
  }
  status(id) {
    const mount = this.store.data.mounts[id];
    if (mount?.connection.paused) return { phase: "paused", message: "Paused" };
    const current = this.statuses.get(id);
    if (current && ["syncing", "error", "review"].includes(current.phase)) return current;
    const conflicts = Object.keys(mount?.conflicts ?? {}).length;
    if (conflicts) return { phase: "conflict", message: `${conflicts} conflict(s) need review. Uploads are paused.` };
    if (mount?.pending) return { phase: "pending", message: mount.connection.access === "read-only" ? `${mount.pending} local change(s) kept. This connection is read-only.` : `${mount.pending} change(s) waiting to upload.` };
    return current ?? { phase: "idle", message: "Ready" };
  }
  setStatus(id, phase, message) {
    this.statuses.set(id, { phase, message });
    this.changed();
  }
  async sync(id, upload = true, deletionApproval) {
    const mount = this.store.data.mounts[id];
    if (!mount || mount.connection.paused || this.running.has(id) || this.stopped) return;
    this.running.add(id);
    this.setStatus(id, "syncing", "Checking connected files\u2026");
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await this.perform(mount, upload, deletionApproval);
          return;
        } catch (error) {
          if (!(error instanceof ConcurrentUpdate) || attempt === 2) throw error;
        }
      }
    } catch (error) {
      const message = error instanceof UserError ? error.message : "Sync stopped safely. Local changes were kept. Retry, or use the recovery tools.";
      this.setStatus(id, "error", message);
    } finally {
      this.running.delete(id);
      this.changed();
    }
  }
  async recover(mount, head) {
    if (!mount.inFlight) return;
    const flight = mount.inFlight;
    if (await this.remote.containsCommit(mount.connection, flight.commit, head)) {
      for (const [path, content] of Object.entries(flight.changes)) {
        if (content === null) delete mount.baseline[path];
        else mount.baseline[path] = { sha: await blobSha(content), content };
      }
      mount.allowMissingFolder = Boolean(flight.emptiesFolder);
    }
    mount.inFlight = null;
    await this.store.save();
  }
  async perform(mount, upload, deletionApproval) {
    this.check();
    const connection = mount.connection;
    if (!await this.local.exists(connection.localPath)) throw new UserError("The local workspace folder is missing. Restore it or disconnect; remote files were kept.");
    const snapshot = await this.remote.snapshot(connection, Boolean(mount.allowMissingFolder || mount.inFlight?.emptiesFolder));
    this.check();
    await this.recover(mount, snapshot.head);
    if (snapshot.folderMissing && !mount.allowMissingFolder) throw new UserError("The remote folder is missing and its deletion was not confirmed. Restore it before syncing.");
    if (Object.keys(snapshot.files).length) mount.allowMissingFolder = false;
    const localFiles = await this.local.scan(connection.localPath);
    checkCollisions([.../* @__PURE__ */ new Set([...Object.keys(localFiles), ...Object.keys(snapshot.files), ...Object.keys(mount.baseline)])]);
    const paths = [.../* @__PURE__ */ new Set([...Object.keys(mount.baseline), ...Object.keys(localFiles), ...Object.keys(snapshot.files)])].sort();
    const outgoing = {};
    const conflicts = {};
    let processed = 0;
    let lastCheckpoint = Date.now();
    const checkpoint = async () => {
      if (Date.now() - lastCheckpoint < 2e3) return;
      await this.store.save();
      lastCheckpoint = Date.now();
    };
    for (const path of paths) {
      this.check();
      if (!supported(path)) throw new UserError("A tracked file is now excluded. Disconnect and reconnect to review the workspace.");
      const base = mount.baseline[path];
      const local = localFiles[path] ?? null;
      const remoteFile = snapshot.files[path];
      const remoteContent = remoteFile ? base?.sha === remoteFile.sha ? base.content : await this.remote.read(connection, remoteFile.sha) : null;
      const rememberRemote = () => {
        if (remoteContent === null || !remoteFile) delete mount.baseline[path];
        else mount.baseline[path] = { sha: remoteFile.sha, content: remoteContent };
      };
      if (local === remoteContent) {
        rememberRemote();
      } else if (!base) {
        if (local === null) {
          this.check();
          await this.local.replace(connection.localPath, path, null, remoteContent);
          rememberRemote();
          await checkpoint();
        } else if (remoteContent === null) outgoing[path] = local;
        else conflicts[path] = this.conflict(path, null, local, remoteContent, remoteFile?.sha ?? null);
      } else if (local === base.content) {
        this.check();
        await this.local.replace(connection.localPath, path, local, remoteContent);
        rememberRemote();
        await checkpoint();
      } else if (remoteContent === base.content) {
        outgoing[path] = local;
      } else {
        const merged = local !== null && remoteContent !== null && isText(path) ? mergeText(local, base.content, remoteContent) : null;
        if (merged !== null) {
          this.check();
          await this.local.replace(connection.localPath, path, local, merged);
          rememberRemote();
          if (merged !== remoteContent) outgoing[path] = merged;
          await checkpoint();
        } else conflicts[path] = this.conflict(path, base.content, local, remoteContent, remoteFile?.sha ?? null);
      }
      if (++processed % 20 === 0) this.setStatus(connection.id, "syncing", `Checked ${processed} of ${paths.length} files\u2026`);
    }
    this.check();
    mount.conflicts = conflicts;
    mount.pending = Object.keys(outgoing).length;
    mount.lastHead = snapshot.head;
    const deletions = Object.keys(outgoing).filter((path) => outgoing[path] === null).sort();
    const fingerprint = JSON.stringify(deletions.map((path) => [path, snapshot.files[path]?.sha ?? null]));
    mount.deletionReview = deletions.length ? { fingerprint, paths: deletions } : null;
    await this.store.save();
    if (Object.keys(conflicts).length) {
      this.setStatus(connection.id, "conflict", `${Object.keys(conflicts).length} conflict(s) need review. Uploads are paused.`);
      return;
    }
    if (mount.pending && connection.access === "read-write" && upload) {
      if (deletions.length && deletionApproval !== fingerprint) {
        this.setStatus(connection.id, "review", `${deletions.length} remote deletion(s) need your review.`);
        return;
      }
      this.setStatus(connection.id, "syncing", `Uploading ${mount.pending} change(s)\u2026`);
      this.check();
      const commit = await this.remote.prepareCommit(connection, snapshot, outgoing);
      this.check();
      const remaining = new Set(Object.keys(snapshot.files));
      for (const [path, content] of Object.entries(outgoing)) {
        if (content === null) remaining.delete(path);
        else remaining.add(path);
      }
      const emptiesFolder = Boolean(connection.remotePath) && remaining.size === 0;
      mount.inFlight = { commit, changes: outgoing, emptiesFolder };
      await this.store.save();
      this.check();
      await this.remote.publish(connection, commit);
      for (const [path, content] of Object.entries(outgoing)) {
        if (content === null) delete mount.baseline[path];
        else mount.baseline[path] = { sha: await blobSha(content), content };
      }
      mount.inFlight = null;
      mount.allowMissingFolder = emptiesFolder;
      mount.lastHead = commit;
      mount.deletionReview = null;
      const after = await this.local.scan(connection.localPath);
      mount.pending = [.../* @__PURE__ */ new Set([...Object.keys(after), ...Object.keys(mount.baseline)])].filter((path) => (after[path] ?? null) !== (mount.baseline[path]?.content ?? null)).length;
    }
    mount.lastSync = Date.now();
    await this.store.save();
    if (mount.pending) this.setStatus(connection.id, "pending", connection.access === "read-only" ? `${mount.pending} local change(s) kept. This connection is read-only.` : `${mount.pending} change(s) waiting to upload.`);
    else this.setStatus(connection.id, "idle", "Up to date");
  }
  conflict(path, base, local, remote, remoteSha) {
    return { path, base, local, remote, remoteSha, kind: local === null || remote === null ? "delete" : isText(path) ? "text" : "binary" };
  }
  async resolve(id, path, content, expected) {
    this.check();
    if (this.running.has(id)) throw new UserError("Wait for the current sync to finish before resolving a conflict.");
    const mount = this.store.data.mounts[id];
    const conflict = mount?.conflicts[safePath(path)];
    if (!mount || !conflict || JSON.stringify(conflict) !== JSON.stringify(expected)) throw new UserError("The conflict changed. Reopen it to review the latest versions.");
    this.running.add(id);
    try {
      await this.local.replace(mount.connection.localPath, path, conflict.local, content);
      if (conflict.remote !== null && conflict.remoteSha) mount.baseline[path] = { sha: conflict.remoteSha, content: conflict.remote };
      else delete mount.baseline[path];
      delete mount.conflicts[path];
      mount.pending = Math.max(1, mount.pending);
      await this.store.save();
      this.setStatus(id, Object.keys(mount.conflicts).length ? "conflict" : "pending", "Resolution saved locally. Sync to upload.");
    } finally {
      this.running.delete(id);
    }
  }
  async disconnect(id) {
    if (this.running.has(id)) throw new UserError("Wait for sync to finish before disconnecting.");
    delete this.store.data.mounts[id];
    this.statuses.delete(id);
    await this.store.save();
    this.changed();
  }
  async add(connection) {
    if (this.store.data.mounts[connection.id]) throw new UserError("This workspace is already connected.");
    this.store.data.mounts[connection.id] = {
      connection,
      baseline: {},
      conflicts: {},
      pending: 0,
      lastSync: null,
      lastHead: null,
      allowMissingFolder: false,
      deletionReview: null,
      inFlight: null
    };
    await this.store.save();
    this.changed();
  }
};

// src/vault.ts
var import_obsidian = require("obsidian");
var VaultBridge = class {
  constructor(app, maxBytes) {
    this.app = app;
    this.maxBytes = maxBytes;
  }
  validateRoot(root) {
    safePath(root);
    const config = this.app.vault.configDir.toLowerCase();
    if (inFolder(root.toLowerCase(), config) || inFolder(config, root.toLowerCase())) throw new UserError("The Obsidian configuration folder cannot be connected.");
  }
  async exists(root) {
    this.validateRoot(root);
    return this.app.vault.getAbstractFileByPath(root) instanceof import_obsidian.TFolder;
  }
  async ensureFolder(root) {
    this.validateRoot(root);
    let current = "";
    for (const segment of root.split("/")) {
      current = join(current, segment);
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing && !(existing instanceof import_obsidian.TFolder)) throw new UserError("A file is blocking the workspace folder.");
      if (!existing) {
        try {
          await this.app.vault.createFolder(current);
        } catch {
          if (!(this.app.vault.getAbstractFileByPath(current) instanceof import_obsidian.TFolder)) throw new UserError("Cannot create the workspace folder.");
        }
      }
    }
  }
  full(root, path) {
    this.validateRoot(root);
    return join(root, safePath(path));
  }
  async scan(root) {
    this.validateRoot(root);
    const result = {};
    const folder = this.app.vault.getAbstractFileByPath(root);
    if (!(folder instanceof import_obsidian.TFolder)) throw new UserError("The workspace folder is missing.");
    const queue = [...folder.children];
    let totalBytes = 0;
    let count = 0;
    while (queue.length) {
      const item = queue.shift();
      const relative = item.path.slice(root.length + 1);
      if (item instanceof import_obsidian.TFolder) {
        try {
          safePath(relative);
          queue.push(...item.children);
        } catch {
        }
      } else if (item instanceof import_obsidian.TFile && supported(relative)) {
        if (item.stat.size > this.maxBytes()) throw new UserError("A local file exceeds the configured size limit. Increase the limit or move it outside this workspace.");
        result[relative] = await this.readFile(item);
        totalBytes += decode(result[relative]).length;
        if (totalBytes > MAX_WORKSPACE_BYTES) throw new UserError("The selected files exceed the 100 MB workspace limit. Connect a smaller folder.");
        if (++count > 2e4) throw new UserError("Connect a folder containing fewer than 20,000 supported files.");
      }
    }
    checkCollisions(Object.keys(result));
    return result;
  }
  async readFile(file) {
    const bytes = new Uint8Array(await this.app.vault.readBinary(file));
    if (bytes.length > this.maxBytes()) throw new UserError("A local file exceeds the configured size limit.");
    return encode(bytes);
  }
  async read(root, path) {
    const file = this.app.vault.getAbstractFileByPath(this.full(root, path));
    if (!file) return null;
    if (!(file instanceof import_obsidian.TFile)) throw new UserError("A folder is blocking a connected file.");
    return this.readFile(file);
  }
  checkEditors(file, expected) {
    if (!isText(file.path) || expected === null) return;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof import_obsidian.MarkdownView && view.file?.path === file.path && fromText(view.getViewData()) !== expected) throw new LocalChanged();
    }
  }
  async flushEditors(root) {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof import_obsidian.MarkdownView && leaf.view.file && (!root || inFolder(leaf.view.file.path, root))) await leaf.view.save();
    }
  }
  async captureVault() {
    await this.flushEditors();
    const allFiles = this.app.vault.getFiles();
    const configRoot = this.app.vault.configDir.normalize("NFC").toLowerCase();
    const selected = allFiles.filter((file) => supported(file.path) && !inFolder(file.path.normalize("NFC").toLowerCase(), configRoot));
    if (selected.length > 2e4) throw new UserError("A vault export supports up to 20,000 source files.");
    checkCollisions(selected.map((file) => file.path));
    const capture = { files: {}, links: [], blocks: {}, excluded: allFiles.length - selected.length };
    const stamps = new Map(selected.map((file) => [file.path, `${file.stat.mtime}:${file.stat.size}`]));
    let totalBytes = 0;
    for (const file of selected) {
      if (file.stat.size > this.maxBytes()) throw new UserError("A vault file exceeds the configured size limit.");
      const content = await this.readFile(file);
      totalBytes += decode(content).length;
      if (totalBytes > MAX_WORKSPACE_BYTES) throw new UserError("The vault exceeds the 100 MB source-content limit.");
      this.checkEditors(file, content);
      capture.files[file.path] = content;
    }
    const allowed = new Set(Object.keys(capture.files));
    for (const file of selected.filter((file2) => isMarkdown(file2.path))) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) throw new UserError("Obsidian is still indexing notes. Wait briefly and preview the vault again.");
      const source = toText(capture.files[file.path]);
      const addLink = (link, displayText, embed, position, original) => {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link)) return;
        const parsed = (0, import_obsidian.parseLinktext)(link);
        let destination2 = parsed.path ? this.app.metadataCache.getFirstLinkpathDest(parsed.path, file.path) : file;
        if (!destination2 && parsed.path.includes("%")) {
          try {
            destination2 = this.app.metadataCache.getFirstLinkpathDest(decodeURIComponent(parsed.path), file.path);
          } catch {
          }
        }
        const entry = {
          source: file.path,
          target: destination2 && allowed.has(destination2.path) ? destination2.path : null,
          label: displayText || parsed.path || parsed.subpath || file.name,
          subpath: parsed.subpath,
          embed
        };
        if (position) {
          entry.start = position.start.offset;
          entry.end = position.end.offset;
          entry.original = original ?? source.slice(entry.start, entry.end);
          if (source.slice(entry.start, entry.end) !== entry.original) throw new UserError("The link index is updating. Preview the vault again after indexing finishes.");
        }
        capture.links.push(entry);
      };
      for (const link of cache.links ?? []) addLink(link.link, link.displayText, false, link.position, link.original);
      for (const link of cache.embeds ?? []) addLink(link.link, link.displayText, true, link.position, link.original);
      for (const link of cache.frontmatterLinks ?? []) {
        const frontmatter = cache.frontmatterPosition;
        if (!frontmatter || !source.slice(frontmatter.start.offset, frontmatter.end.offset).includes(link.original)) throw new UserError("The note properties index is updating. Preview again after indexing finishes.");
        addLink(link.link, link.displayText, false);
      }
      capture.blocks[file.path] = Object.values(cache.blocks ?? {}).map((block) => ({ offset: block.position.start.offset, id: block.id }));
    }
    const after = this.app.vault.getFiles().filter((file) => supported(file.path) && !inFolder(file.path.normalize("NFC").toLowerCase(), configRoot));
    if (after.length !== selected.length || after.some((file) => stamps.get(file.path) !== `${file.stat.mtime}:${file.stat.size}`)) throw new LocalChanged();
    for (const file of selected) this.checkEditors(file, capture.files[file.path]);
    return capture;
  }
  async replace(root, path, expected, content) {
    const fullPath = this.full(root, path);
    if (!supported(path)) throw new UserError("This file type or path is excluded from sync.");
    if (content !== null && decode(content).length > this.maxBytes()) throw new UserError("The file exceeds the configured size limit.");
    if (content !== null && isText(path)) {
      try {
        toText(content);
      } catch {
        throw new UserError("A text file contains invalid UTF-8. No local content was replaced.");
      }
    }
    const current = this.app.vault.getAbstractFileByPath(fullPath);
    if (current && !(current instanceof import_obsidian.TFile)) throw new UserError("A folder is blocking a connected file.");
    if (current instanceof import_obsidian.TFile) this.checkEditors(current, expected);
    if (await this.read(root, path) !== expected) throw new LocalChanged();
    if (content === expected) return;
    if (content === null) {
      if (current instanceof import_obsidian.TFile) {
        this.checkEditors(current, expected);
        await this.app.vault.trash(current, false);
      }
      return;
    }
    if (!current) {
      const parent = fullPath.split("/").slice(0, -1).join("/");
      await this.ensureFolder(parent);
      try {
        await this.app.vault.createBinary(fullPath, asBuffer(decode(content)));
      } catch {
        throw new LocalChanged();
      }
    } else if (isText(path)) {
      let nextText;
      try {
        nextText = toText(content);
      } catch {
        throw new UserError("A text file contains invalid UTF-8. No local content was replaced.");
      }
      await this.app.vault.process(current, (data) => {
        this.checkEditors(current, expected);
        if (fromText(data) !== expected) throw new LocalChanged();
        return nextText;
      });
    } else {
      if (await this.read(root, path) !== expected) throw new LocalChanged();
      await this.app.vault.modifyBinary(current, asBuffer(decode(content)));
    }
  }
};

// src/ui.ts
var import_obsidian3 = require("obsidian");

// src/privacy.ts
function diagnostics(state, version) {
  const mounts = Object.values(state.mounts);
  return JSON.stringify({
    plugin: "github-sync-zev",
    version,
    schema: state.schema,
    connections: mounts.length,
    readOnlyConnections: mounts.filter((m) => m.connection.access === "read-only").length,
    pendingChanges: mounts.reduce((total, m) => total + m.pending, 0),
    conflicts: mounts.reduce((total, m) => total + Object.keys(m.conflicts).length, 0),
    recoveringUploads: mounts.filter((m) => m.inFlight !== null).length,
    vaultSnapshots: Object.keys(state.vaultExports ?? {}).length,
    pendingVaultSnapshots: Object.values(state.vaultExports ?? {}).filter((record) => record.status === "pending" || record.status === "preparing").length
  }, null, 2);
}

// src/export-ui.ts
var import_obsidian2 = require("obsidian");

// src/export-service.ts
var VaultExportService = class {
  constructor(store, remote, changed = () => void 0) {
    this.store = store;
    this.remote = remote;
    this.changed = changed;
  }
  busy = false;
  stopped = false;
  stop() {
    this.stopped = true;
  }
  check() {
    if (this.stopped) throw new UserError("Plugin is unloading. Check the snapshot status after reopening Obsidian.");
  }
  async publish(connection, plan) {
    if (this.busy) throw new UserError("A vault export is already running.");
    if (connection.access !== "read-write") throw new UserError("Choose a writable connection for vault export.");
    this.check();
    const records = this.store.data.vaultExports ??= {};
    if (records[plan.id]) throw new UserError("This snapshot has already been submitted. Check its status or create a new preview.");
    const target = { ...connection, id: plan.id, remotePath: "", localPath: "Vault", autoUpload: false, paused: false };
    const record = {
      id: plan.id,
      prefix: plan.prefix,
      target,
      commit: null,
      status: "preparing",
      noteCount: plan.noteCount,
      linkCount: plan.linkCount,
      fileCount: plan.fileCount,
      createdAt: Date.now()
    };
    records[record.id] = record;
    this.busy = true;
    this.changed();
    try {
      await this.store.save();
      for (let attempt = 0; attempt < 3; attempt++) {
        this.check();
        const revision = await this.remote.revision(target);
        const commit = await this.remote.prepareVaultExport(target, revision, plan, () => this.check());
        this.check();
        record.commit = commit;
        record.status = "pending";
        await this.store.save();
        this.check();
        try {
          await this.remote.publish(target, commit);
        } catch (error) {
          if (error instanceof ConcurrentUpdate && attempt < 2) {
            const latest = await this.remote.revision(target);
            if (await this.remote.containsCommit(target, commit, latest.head)) break;
            continue;
          }
          throw error;
        }
        break;
      }
      record.status = "published";
      const old = Object.values(records).filter((item) => item.status === "published").sort((a, b) => b.createdAt - a.createdAt).slice(20);
      for (const item of old) delete records[item.id];
      await this.store.save();
      return record;
    } catch (error) {
      if (!record.commit) {
        record.status = "not-published";
        await this.store.save().catch(() => void 0);
      }
      throw error;
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  async checkPublication(id) {
    if (this.busy) throw new UserError("Wait for the current vault export to finish.");
    this.check();
    const record = this.store.data.vaultExports?.[id];
    if (!record) throw new UserError("The snapshot record is unavailable on this device.");
    if (!record.commit) {
      record.status = "not-published";
      await this.store.save();
      return record;
    }
    this.busy = true;
    this.changed();
    try {
      const revision = await this.remote.revision(record.target);
      record.status = await this.remote.containsCommit(record.target, record.commit, revision.head) ? "published" : "not-published";
      await this.store.save();
      return record;
    } finally {
      this.busy = false;
      this.changed();
    }
  }
};
function vaultExportURL(record) {
  const { owner, repo } = record.target;
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree/${encodeURIComponent(record.commit ?? record.target.branch)}/${record.prefix.split("/").map(encodeURIComponent).join("/")}`;
}

// src/export-ui.ts
var VaultExportModal = class extends import_obsidian2.Modal {
  constructor(plugin, connectionId) {
    super(plugin.app);
    this.plugin = plugin;
    this.selected = connectionId ?? Object.values(plugin.store.data.mounts).find((mount) => mount.connection.access === "read-write")?.connection.id ?? "";
  }
  selected = "";
  plan = null;
  reviewed = false;
  busy = false;
  message = "";
  onOpen() {
    this.modalEl.addClass("gsz-modal", "gsz-export-modal");
    this.render();
  }
  onClose() {
    this.plan = null;
    this.contentEl.empty();
  }
  async perform(task) {
    if (this.busy) return;
    this.busy = true;
    this.message = "";
    this.render();
    try {
      await task();
    } catch (error) {
      this.message = error instanceof UserError ? error.message : "The vault save could not finish. Check publication status before creating another snapshot.";
    } finally {
      this.busy = false;
      this.render();
    }
  }
  button(parent, label, task, primary = false) {
    const button = new import_obsidian2.ButtonComponent(parent).setButtonText(label).setDisabled(this.busy || this.plugin.exporter.busy).onClick(() => void this.perform(task));
    if (primary) button.setCta();
    return button;
  }
  render() {
    const root = this.contentEl;
    root.empty();
    root.createDiv({ text: "ZEV // VAULT ARCHIVE", cls: "gsz-eyebrow" });
    root.createEl("h2", { text: "Save a standalone vault" });
    root.createEl("p", { text: "Capture all supported notes and attachments from this vault, preserving folders and Obsidian links. A separate GitHub reading copy includes clickable links and backlink lists.", cls: "gsz-muted" });
    const writable = Object.values(this.plugin.store.data.mounts).filter((mount) => mount.connection.access === "read-write");
    if (!writable.length) {
      root.createEl("p", { text: "Connect a repository with read and write access first, then open this archive panel again." });
    } else {
      new import_obsidian2.Setting(root).setName("Destination repository").setDesc("Each save creates a new folder under Obsidian-Vaults/. Snapshots stay separate from normal folder sync.").addDropdown((dropdown) => {
        for (const { connection } of writable) dropdown.addOption(connection.id, `${connection.owner}/${connection.repo} \xB7 ${connection.branch}`);
        dropdown.setValue(this.selected).setDisabled(this.busy || this.plugin.exporter.busy).onChange((value) => {
          this.selected = value;
          this.reviewed = false;
          this.render();
        });
      });
      const controls = root.createDiv({ cls: "gsz-actions" });
      this.button(controls, this.busy ? "Working\u2026" : "Preview full vault", async () => {
        const capture = await this.plugin.bridge.captureVault();
        this.plan = buildVaultExport(capture, this.plugin.store.data.settings.maxFileMB * 1024 * 1024);
        this.reviewed = false;
      });
      if (this.plan) {
        const plan = this.plan;
        const metrics = root.createDiv({ cls: "gsz-archive-metrics" });
        metrics.createDiv({ text: `${plan.noteCount} notes` });
        metrics.createDiv({ text: `${plan.fileCount} source files` });
        metrics.createDiv({ text: `${plan.linkCount} linked references` });
        metrics.createDiv({ text: `${(plan.uploadBytes / 1024 / 1024).toFixed(2)} MB upload` });
        root.createEl("p", { text: `${plan.excludedCount} unsupported or private/configuration files excluded \xB7 ${plan.unresolvedCount} missing or excluded link targets.`, cls: "gsz-muted" });
        root.createEl("p", { text: "Original vault + GitHub reading copy + fresh core settings for Backlinks, Outgoing links, and Graph. Original plugin settings, workspace history, tokens, and caches are excluded." });
        const files = root.createDiv({ cls: "gsz-preview-list" });
        for (const path of plan.sourcePaths.slice(0, 300)) files.createDiv({ text: path, cls: "gsz-archive-path" });
        if (plan.sourcePaths.length > 300) files.createEl("p", { text: `Showing 300 of ${plan.sourcePaths.length} source files.` });
        const fullList = root.createEl("details");
        fullList.createEl("summary", { text: "Review the complete source file list" });
        fullList.createEl("pre", { text: plan.sourcePaths.join("\n"), cls: "gsz-preview-content" });
        root.createEl("p", { text: "This includes notes from the entire vault, beyond your connected folder. If the destination repository is public, the snapshot and its note history will be public. Edits made after this preview require a new preview." });
        new import_obsidian2.Setting(root).setName("I reviewed the full-vault file list and destination").addToggle((toggle) => toggle.setValue(this.reviewed).setDisabled(this.busy).onChange((value) => {
          this.reviewed = value;
          this.render();
        }));
        this.button(root, "Save vault to repository", async () => {
          if (!this.reviewed || !this.plan) throw new UserError("Review the vault and destination before saving.");
          await this.plugin.saveVault(this.selected, this.plan);
          this.message = "Vault snapshot saved. Open it below, or download the repository and open its vault folder in Obsidian.";
          this.plan = null;
          this.reviewed = false;
        }, true).setDisabled(this.busy || this.plugin.exporter.busy || !this.reviewed || Boolean(this.plugin.store.data.vaultExports?.[plan.id]));
      }
    }
    if (this.message) root.createEl("p", { text: this.message, cls: "gsz-state" });
    const history = Object.values(this.plugin.store.data.vaultExports ?? {}).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
    if (history.length) {
      root.createEl("h3", { text: "Recent snapshots" });
      for (const record of history) {
        const card = root.createDiv({ cls: "gsz-export-record" });
        card.createDiv({ text: `${record.target.owner}/${record.target.repo} \xB7 ${record.target.branch}` });
        card.createDiv({ text: `${record.noteCount} notes \xB7 ${record.linkCount} links \xB7 ${record.status.replace("-", " ")} \xB7 ${new Date(record.createdAt).toLocaleString()}`, cls: "gsz-muted" });
        if (record.status === "published") {
          const link = card.createEl("a", { text: "Open snapshot on GitHub" });
          link.href = vaultExportURL(record);
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        } else if (record.commit || record.status === "preparing") {
          this.button(card, "Check publication status", async () => {
            const checked = await this.plugin.exporter.checkPublication(record.id);
            this.message = checked.status === "published" ? "GitHub confirms this snapshot was published. It was not uploaded again." : "This snapshot is not on the current branch. Create a new preview to save a new snapshot.";
          });
        }
      }
    }
  }
};

// src/ui.ts
var VIEW_TYPE = "github-sync-zev-explorer";
function action(parent, label, callback, primary = false) {
  const button = new import_obsidian3.ButtonComponent(parent).setButtonText(label).onClick(callback);
  if (primary) button.setCta();
  return button;
}
function readable(content) {
  if (content === null) return "[File deleted]";
  try {
    return toText(content);
  } catch {
    return `[Binary file: ${decode(content).length} bytes]`;
  }
}
function errorText(error) {
  return error instanceof UserError ? error.message : "The operation could not finish. Retry without changing your local files.";
}
var ConnectModal = class extends import_obsidian3.Modal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
  }
  url = "";
  owner = "";
  repo = "";
  branch = "";
  branches = [];
  remotePath = "";
  localPath = "";
  access = "read-write";
  preview = null;
  localCount = 0;
  differentCount = 0;
  busy = false;
  message = "";
  autoUpload = false;
  connectionId = crypto.randomUUID();
  onOpen() {
    this.modalEl.addClass("gsz-modal");
    this.render();
  }
  onClose() {
    this.contentEl.empty();
  }
  draft() {
    return {
      id: this.connectionId,
      owner: this.owner,
      repo: this.repo,
      branch: this.branch,
      remotePath: safePath(this.remotePath, true),
      localPath: safePath(this.localPath),
      access: this.access,
      secretId: this.plugin.secretId,
      autoUpload: this.autoUpload,
      paused: false
    };
  }
  async perform(task) {
    if (this.busy) return;
    this.busy = true;
    this.message = "";
    this.render();
    try {
      await task();
    } catch (error) {
      this.message = errorText(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }
  async load() {
    const parsed = parseRepoURL(this.url);
    const info = await this.plugin.client.repoInfo(parsed.owner, parsed.repo, this.plugin.secretId);
    const branches = await this.plugin.client.branches(parsed.owner, parsed.repo, this.plugin.secretId);
    const resolved = resolveTreeURL(parsed.treeTail, branches, info.default_branch);
    this.owner = parsed.owner;
    this.repo = parsed.repo;
    this.branches = branches;
    this.branch = resolved.branch;
    this.remotePath = resolved.remotePath;
    if (!this.localPath) this.localPath = `GitHub/${this.repo}${this.remotePath ? `/${this.remotePath}` : ""}`;
    this.preview = null;
  }
  async previewConnection() {
    validateBranch(this.branch);
    const connection = this.draft();
    this.plugin.validateConnection(connection);
    const preview = await this.plugin.client.snapshot(connection);
    const local = await this.plugin.bridge.exists(connection.localPath) ? await this.plugin.bridge.scan(connection.localPath) : {};
    this.localCount = Object.keys(local).length;
    this.differentCount = 0;
    for (const [path, content] of Object.entries(local)) {
      if (preview.files[path] && await blobSha(content) !== preview.files[path].sha) this.differentCount++;
    }
    this.preview = preview;
  }
  render() {
    const root = this.contentEl;
    root.empty();
    root.createEl("h2", { text: "Open a GitHub folder" });
    root.createEl("p", { text: "Connect a repository folder to this vault. Markdown opens in the native editor; selected notes and supported attachments are kept locally for offline use.", cls: "gsz-muted" });
    new import_obsidian3.Setting(root).setName("GitHub sign-in").setDesc(this.plugin.app.secretStorage.getSecret(this.plugin.secretId) ? "Token stored in Obsidian SecretStorage." : "Private repositories and uploads require a token. Use Contents: Read and write for saving notes.").addButton((button) => button.setButtonText("Set GitHub token").onClick(() => new TokenModal(this.plugin, () => this.render()).open()));
    new import_obsidian3.Setting(root).setName("Repository or folder URL").setDesc("HTTPS github.com URL. Credentials do not belong in the URL.").addText((text) => text.setPlaceholder("https://github.com/example/notes/tree/main/docs").setValue(this.url).setDisabled(this.busy).onChange((value) => {
      if (/^(?:github_pat_|gh[pousr]_)/.test(value.trim())) {
        text.setValue("");
        this.url = "";
        this.preview = null;
        this.message = "That is a token. Use Set GitHub token above; this field needs your repository URL.";
        this.render();
        return;
      }
      this.url = value;
      this.owner = "";
      this.repo = "";
      this.preview = null;
    }));
    action(root, this.busy ? "Working\u2026" : "Load repository", () => void this.perform(() => this.load())).setDisabled(this.busy);
    if (!this.plugin.app.secretStorage.getSecret(this.plugin.secretId)) {
      root.createEl("p", { text: "Private repositories require a token. Add a fine-grained token in this plugin\u2019s settings, then load the repository again.", cls: "gsz-muted" });
    }
    if (this.owner && this.repo) {
      root.createEl("h3", { text: `${this.owner}/${this.repo}` });
      new import_obsidian3.Setting(root).setName("Branch").addDropdown((dropdown) => {
        for (const branch of this.branches) dropdown.addOption(branch, branch);
        dropdown.setValue(this.branch).setDisabled(this.busy).onChange((value) => {
          this.branch = value;
          this.preview = null;
          this.render();
        });
      });
      new import_obsidian3.Setting(root).setName("Remote folder").setDesc("Leave empty to connect the repository root. Hidden folders are excluded.").addText((text) => text.setValue(this.remotePath).setDisabled(this.busy).onChange((value) => {
        this.remotePath = value.trim();
        this.preview = null;
      }));
      new import_obsidian3.Setting(root).setName("Local folder in this vault").setDesc("Choose a new folder, or connect an existing folder. Connected folders cannot overlap.").addText((text) => text.setValue(this.localPath).setDisabled(this.busy).onChange((value) => {
        this.localPath = value.trim();
        this.preview = null;
      }));
      new import_obsidian3.Setting(root).setName("Access").addDropdown((dropdown) => dropdown.addOption("read-write", "Read and write").addOption("read-only", "Read-only").setValue(this.access).setDisabled(this.busy).onChange((value) => {
        this.access = value;
        this.render();
      }));
      new import_obsidian3.Setting(root).setName("Upload changes automatically").setDesc("Off by default. Turn on after reviewing your files. Remote updates still download automatically.").addToggle((toggle) => toggle.setValue(this.autoUpload).setDisabled(this.busy || this.access === "read-only").onChange((value) => {
        this.autoUpload = value;
      }));
      const controls = root.createDiv({ cls: "gsz-actions" });
      action(controls, "Preview connection", () => void this.perform(() => this.previewConnection())).setDisabled(this.busy);
      if (this.preview) {
        const preview = this.preview;
        root.createEl("p", { text: `${Object.keys(preview.files).length} supported remote files \xB7 ${this.localCount} local files \xB7 ${this.differentCount} matching paths with different contents.` });
        root.createEl("p", { text: "Connecting downloads remote files. Different contents at the same path need conflict review. Local-only files are kept; nothing uploads during the first download.", cls: "gsz-muted" });
        const list = root.createDiv({ cls: "gsz-preview-list" });
        for (const path of Object.keys(preview.files).sort().slice(0, 100)) {
          const row = list.createDiv({ cls: "gsz-file-row" });
          const button = action(row, path, () => {
            const file = preview.files[path];
            this.plugin.run(async () => {
              const content = await this.plugin.client.read(this.draft(), file.sha);
              new RemotePreviewModal(this.app, path, content).open();
            });
          });
          button.buttonEl.addClass("gsz-file-button");
        }
        if (Object.keys(preview.files).length > 100) list.createEl("p", { text: "Showing the first 100 files. All supported files in this folder will download." });
        action(controls, "Connect and download", () => void this.perform(async () => {
          if (!this.preview) throw new UserError("Preview the current connection before continuing.");
          await this.plugin.connect(this.draft());
          this.close();
        }), true).setDisabled(this.busy);
      }
    }
    if (this.message) root.createEl("p", { text: this.message, cls: "gsz-error" });
  }
};
var TokenModal = class extends import_obsidian3.Modal {
  constructor(plugin, done) {
    super(plugin.app);
    this.plugin = plugin;
    this.done = done;
  }
  value = "";
  input = null;
  onOpen() {
    this.modalEl.addClass("gsz-modal");
    this.contentEl.createEl("h2", { text: "Set GitHub token" });
    this.contentEl.createEl("p", { text: "Create a fine-grained token for your chosen repository. Set Contents to Read and write; Metadata stays Read-only. Store the token here, then paste the repository URL in the connection dialog." });
    new import_obsidian3.Setting(this.contentEl).setName("GitHub token").addText((text) => {
      text.inputEl.type = "password";
      text.inputEl.autocomplete = "off";
      text.inputEl.spellcheck = false;
      text.setPlaceholder("Paste token here").onChange((value) => {
        this.value = value;
      });
      this.input = text.inputEl;
    });
    action(this.contentEl, "Store token", () => this.plugin.run(async () => {
      this.plugin.storeToken(this.value);
      this.close();
      this.done();
    }), true);
  }
  onClose() {
    this.value = "";
    if (this.input) this.input.value = "";
    this.input = null;
    this.contentEl.empty();
  }
};
var RemotePreviewModal = class extends import_obsidian3.Modal {
  constructor(app, path, content) {
    super(app);
    this.path = path;
    this.content = content;
  }
  onOpen() {
    this.modalEl.addClass("gsz-modal");
    this.contentEl.createEl("h2", { text: this.path });
    this.contentEl.createEl("p", { text: "Remote preview \xB7 connect this folder to edit in Obsidian." });
    this.contentEl.createEl("pre", { text: isText(this.path) ? readable(this.content) : `Attachment \xB7 ${decode(this.content).length} bytes`, cls: "gsz-preview-content" });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ExplorerView = class extends import_obsidian3.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  expanded = /* @__PURE__ */ new Set();
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "GitHub workspaces";
  }
  getIcon() {
    return "github";
  }
  async onOpen() {
    this.contentEl.addClass("gsz-explorer");
    this.render();
  }
  async onClose() {
    this.contentEl.empty();
  }
  render() {
    const root = this.contentEl;
    root.empty();
    if (!this.plugin.engine) return;
    const header = root.createDiv({ cls: "gsz-console-header" });
    header.createDiv({ text: "ZEV // ORBITAL SYNC", cls: "gsz-eyebrow" });
    const title = header.createDiv({ cls: "gsz-console-title" });
    title.createEl("h3", { text: "GitHub workspaces" });
    title.createDiv({ cls: "gsz-orbit", attr: { "aria-hidden": "true" } });
    const online = navigator.onLine !== false;
    header.createDiv({ text: online ? "SYSTEM ONLINE" : "OFFLINE \xB7 LOCAL MODE", cls: `gsz-system-chip${online ? "" : " gsz-system-offline"}` });
    const mounts = Object.values(this.plugin.store.data.mounts);
    const stats = root.createDiv({ cls: "gsz-console-stats" });
    const metrics = [
      ["WORKSPACES", mounts.length],
      ["PENDING", mounts.reduce((sum, mount) => sum + mount.pending, 0)],
      ["CONFLICTS", mounts.reduce((sum, mount) => sum + Object.keys(mount.conflicts).length, 0)]
    ];
    for (const [label, count] of metrics) {
      const metric = stats.createDiv({ cls: "gsz-console-stat" });
      metric.createDiv({ text: String(count).padStart(2, "0"), cls: "gsz-console-value" });
      metric.createDiv({ text: label, cls: "gsz-console-label" });
    }
    const toolbar = root.createDiv({ cls: "gsz-actions" });
    action(toolbar, "Connect folder", () => new ConnectModal(this.plugin).open(), true);
    action(toolbar, "Sync all", () => this.plugin.run(() => this.plugin.syncAll(true))).setDisabled(this.plugin.exporter?.busy ?? false);
    const archive = root.createDiv({ cls: "gsz-archive-card" });
    archive.createDiv({ text: "VAULT ARCHIVE", cls: "gsz-eyebrow" });
    archive.createEl("h4", { text: "Keep your knowledge connected" });
    archive.createEl("p", { text: "Save an independent vault with original wiki-links, plus a GitHub copy with outgoing links and backlinks.", cls: "gsz-muted" });
    action(archive, this.plugin.exporter?.busy ? "Saving vault\u2026" : "Save full vault", () => new VaultExportModal(this.plugin).open()).setDisabled(this.plugin.exporter?.busy ?? false);
    if (!mounts.length) {
      const empty = root.createDiv({ cls: "gsz-empty-state" });
      empty.createDiv({ text: "AWAITING CONNECTION", cls: "gsz-eyebrow" });
      empty.createEl("p", { text: "Connect a GitHub folder to start editing notes, working offline, and sending changes from this console.", cls: "gsz-muted" });
      return;
    }
    for (const [index, mount] of mounts.entries()) this.mount(root, mount, index);
  }
  mount(parent, mount, index) {
    const connection = mount.connection;
    const status = this.plugin.engine.status(connection.id);
    const card = parent.createDiv({ cls: `gsz-workspace gsz-workspace-${status.phase}` });
    const line = card.createDiv({ cls: "gsz-workspace-topline" });
    line.createDiv({ text: `REMOTE ${String(index + 1).padStart(2, "0")}`, cls: "gsz-eyebrow" });
    line.createDiv({ text: status.phase.toUpperCase(), cls: `gsz-phase gsz-phase-${status.phase}` });
    card.createEl("h4", { text: connection.localPath });
    card.createDiv({ text: `${connection.owner}/${connection.repo}`, cls: "gsz-remote-label" });
    const route = card.createDiv({ cls: "gsz-route" });
    route.createEl("span", { text: connection.branch, cls: "gsz-branch-chip" });
    route.createEl("span", { text: `/${connection.remotePath}`, cls: "gsz-muted" });
    card.createDiv({ text: status.message, cls: `gsz-state gsz-state-${status.phase}` });
    card.createDiv({ cls: "gsz-signal-line", attr: { "aria-hidden": "true" } });
    if (mount.lastSync) card.createDiv({ text: `Last completed: ${new Date(mount.lastSync).toLocaleString()}`, cls: "gsz-muted" });
    const buttons = card.createDiv({ cls: "gsz-actions" });
    action(buttons, "Sync", () => this.plugin.run(() => this.plugin.syncOne(connection.id, true))).setDisabled(this.plugin.engine.isRunning(connection.id) || connection.paused || (this.plugin.exporter?.busy ?? false));
    action(buttons, "New note", () => new NewNoteModal(this.plugin, connection).open());
    if (mount.deletionReview && connection.access === "read-write") action(buttons, "Review deletions", () => new DeletionModal(this.plugin, mount).open());
    for (const [path, conflict] of Object.entries(mount.conflicts)) {
      const row = card.createDiv({ cls: "gsz-conflict-row" });
      action(row, `Resolve: ${path}`, () => new ConflictModal(this.plugin, connection.id, structuredClone(conflict)).open());
    }
    const folder = this.app.vault.getAbstractFileByPath(connection.localPath);
    if (folder instanceof import_obsidian3.TFolder) this.folder(card, folder, connection.localPath, true);
  }
  folder(parent, folder, root, top = false) {
    const container = top ? parent.createDiv({ cls: "gsz-tree" }) : parent.createEl("details", { cls: "gsz-tree-folder" });
    let loaded = false;
    const populate = () => {
      if (loaded) return;
      loaded = true;
      const children = folder.children.filter((item) => item instanceof import_obsidian3.TFolder ? this.visibleFolder(item, root) : supported(item.path.slice(root.length + 1))).sort((a, b) => Number(b instanceof import_obsidian3.TFolder) - Number(a instanceof import_obsidian3.TFolder) || a.name.localeCompare(b.name));
      for (const item of children.slice(0, 300)) {
        if (item instanceof import_obsidian3.TFolder) this.folder(container, item, root);
        else if (item instanceof import_obsidian3.TFile) {
          const row = container.createDiv({ cls: "gsz-file-row" });
          action(row, item.name, () => this.plugin.run(() => this.app.workspace.getLeaf(false).openFile(item))).buttonEl.addClass("gsz-file-button");
        }
      }
      if (children.length > 300) container.createEl("p", { text: "Use Obsidian\u2019s file explorer for the remaining files.", cls: "gsz-muted" });
      if (!children.length && top) container.createDiv({ text: "Files appear here as they download.", cls: "gsz-muted" });
    };
    if (container instanceof HTMLDetailsElement) {
      container.createEl("summary", { text: folder.name });
      container.open = this.expanded.has(folder.path);
      if (container.open) populate();
      container.addEventListener("toggle", () => {
        if (container.open) {
          this.expanded.add(folder.path);
          populate();
        } else this.expanded.delete(folder.path);
      });
    } else populate();
  }
  visibleFolder(folder, root) {
    try {
      safePath(folder.path.slice(root.length + 1));
      return true;
    } catch {
      return false;
    }
  }
};
var NewNoteModal = class extends import_obsidian3.Modal {
  constructor(plugin, connection) {
    super(plugin.app);
    this.plugin = plugin;
    this.connection = connection;
  }
  onOpen() {
    this.contentEl.createEl("h2", { text: "New connected note" });
    let path = "";
    new import_obsidian3.Setting(this.contentEl).setName("Path inside this workspace").addText((text) => text.setPlaceholder("projects/idea.md").onChange((value) => {
      path = value.trim();
    }));
    action(this.contentEl, "Create note", () => this.plugin.run(async () => {
      if (!/\.(md|markdown)$/i.test(path)) path += ".md";
      safePath(path);
      await this.plugin.bridge.replace(this.connection.localPath, path, null, fromText(""));
      const file = this.app.vault.getAbstractFileByPath(join(this.connection.localPath, path));
      if (file instanceof import_obsidian3.TFile) await this.app.workspace.getLeaf(false).openFile(file);
      this.close();
      this.plugin.emit();
    }), true);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var DeletionModal = class extends import_obsidian3.Modal {
  constructor(plugin, mount) {
    super(plugin.app);
    this.plugin = plugin;
    this.mount = mount;
    this.fingerprint = mount.deletionReview.fingerprint;
    this.paths = [...mount.deletionReview.paths];
  }
  fingerprint;
  paths;
  onOpen() {
    this.contentEl.createEl("h2", { text: "Review remote deletions" });
    this.contentEl.createEl("p", { text: "The following files are missing locally and will be deleted from the connected GitHub branch. Other pending edits are included in the same commit. Git history retains previous versions." });
    const list = this.contentEl.createEl("ul");
    for (const path of this.paths) list.createEl("li", { text: path });
    action(this.contentEl, "Delete listed files and sync", () => this.plugin.run(async () => {
      await this.plugin.syncOne(this.mount.connection.id, true, this.fingerprint);
      this.close();
    }), true);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ConflictModal = class extends import_obsidian3.Modal {
  constructor(plugin, id, conflict) {
    super(plugin.app);
    this.plugin = plugin;
    this.id = id;
    this.conflict = conflict;
  }
  onOpen() {
    this.modalEl.addClass("gsz-modal", "gsz-conflict-modal");
    const { conflict, contentEl: root } = this;
    root.createEl("h2", { text: `Resolve ${conflict.path}` });
    root.createEl("p", { text: "Uploads for this workspace wait until every conflict is resolved. Your chosen result is saved locally first." });
    const versions = root.createDiv({ cls: "gsz-versions" });
    for (const [title, value] of [["Common version", conflict.base], ["Local", conflict.local], ["GitHub", conflict.remote]]) {
      const column = versions.createDiv();
      column.createEl("h4", { text: title });
      const text = column.createEl("textarea", { cls: "gsz-version" });
      text.readOnly = true;
      text.setAttribute("aria-label", title);
      text.value = conflict.kind === "binary" && value !== null ? `[Binary file: ${decode(value).length} bytes]` : readable(value);
    }
    const controls = root.createDiv({ cls: "gsz-actions" });
    const resolve = (content) => this.plugin.run(async () => {
      await this.plugin.bridge.flushEditors(this.plugin.store.data.mounts[this.id]?.connection.localPath);
      await this.plugin.engine.resolve(this.id, conflict.path, content, conflict);
      this.close();
    });
    action(controls, conflict.local === null ? "Keep local deletion" : "Keep local version", () => resolve(conflict.local));
    action(controls, conflict.remote === null ? "Accept GitHub deletion" : "Use GitHub version", () => resolve(conflict.remote));
    if (conflict.kind !== "binary") {
      root.createEl("h4", { text: "Merged result" });
      const editor = root.createEl("textarea", { cls: "gsz-merge-editor" });
      editor.setAttribute("aria-label", "Merged result");
      editor.value = conflict.local === null ? readable(conflict.remote) : readable(conflict.local);
      action(root, "Save merged result", () => resolve(fromText(editor.value)), true);
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};
var DiagnosticModal = class extends import_obsidian3.Modal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
  }
  onOpen() {
    this.contentEl.createEl("h2", { text: "Safe diagnostics" });
    this.contentEl.createEl("p", { text: "This report includes only version numbers and counts. It excludes tokens, account names, repositories, paths, commit IDs, note contents, and timestamps." });
    const text = this.contentEl.createEl("textarea", { cls: "gsz-diagnostics" });
    text.value = diagnostics(this.plugin.store.data, this.plugin.manifest.version);
    text.readOnly = true;
    text.setAttribute("aria-label", "Safe diagnostic report");
    action(this.contentEl, "Select report", () => {
      text.focus();
      text.select();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var PluginSettings = class extends import_obsidian3.PluginSettingTab {
  constructor(plugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }
  display() {
    const root = this.containerEl;
    root.empty();
    new import_obsidian3.Setting(root).setName("GitHub Sync _ Zev").setHeading();
    root.createEl("p", { text: "Open GitHub folders in your vault. Connection state and conflict history stay in this device\u2019s IndexedDB. This plugin does not write a data.json settings file.", cls: "gsz-muted" });
    this.tokenSetting(root);
    new import_obsidian3.Setting(root).setName("Remote refresh interval").setDesc("Seconds, from 30 to 3600. Refresh runs while Obsidian is visible. Mobile background execution is controlled by the operating system.").addText((text) => text.setValue(String(this.plugin.store.data.settings.pollSeconds)).onChange((value) => this.settingNumber("pollSeconds", value, 30, 3600)));
    new import_obsidian3.Setting(root).setName("Automatic upload delay").setDesc("Seconds after edits settle, from 5 to 300. Enabled separately for each connection.").addText((text) => text.setValue(String(this.plugin.store.data.settings.uploadDelaySeconds)).onChange((value) => this.settingNumber("uploadDelaySeconds", value, 5, 300)));
    new import_obsidian3.Setting(root).setName("Maximum file size").setDesc("MB per file, from 1 to 25. Files above this limit stop sync; they are never mistaken for deletions.").addText((text) => text.setValue(String(this.plugin.store.data.settings.maxFileMB)).onChange((value) => this.settingNumber("maxFileMB", value, 1, 25)));
    new import_obsidian3.Setting(root).setName("Connected folders").setHeading();
    action(root, "Connect folder", () => new ConnectModal(this.plugin).open(), true);
    for (const mount of Object.values(this.plugin.store.data.mounts)) this.connection(root, mount);
    new import_obsidian3.Setting(root).setName("Diagnostics").setDesc("Share a report containing only version numbers and counts.").addButton((button) => button.setButtonText("Show safe report").onClick(() => new DiagnosticModal(this.plugin).open()));
  }
  tokenSetting(root) {
    let token = "";
    let field = null;
    const stored = Boolean(this.app.secretStorage.getSecret(this.plugin.secretId));
    const setting = new import_obsidian3.Setting(root).setName("GitHub token").setDesc(`${stored ? "A token is stored." : "No token is stored."} Use a fine-grained token limited to selected repositories, with Contents read/write (or read for read-only use). The token stays in Obsidian SecretStorage.`);
    setting.addText((text) => {
      text.inputEl.type = "password";
      text.inputEl.autocomplete = "off";
      text.inputEl.spellcheck = false;
      text.setPlaceholder("Paste a new token").onChange((value) => {
        token = value.trim();
      });
      field = text.inputEl;
    });
    setting.addButton((button) => button.setButtonText("Store token").onClick(() => {
      this.plugin.run(async () => {
        this.plugin.storeToken(token);
        token = "";
        if (field) field.value = "";
        this.display();
      });
    }));
    if (stored) setting.addButton((button) => button.setButtonText("Remove token").onClick(() => {
      this.app.secretStorage.setSecret(this.plugin.secretId, "");
      this.display();
    }));
  }
  settingNumber(key, value, min, max) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) return;
    this.plugin.store.data.settings[key] = number;
    this.plugin.run(() => this.plugin.store.save());
  }
  updateConnection(mount, change) {
    this.plugin.run(async () => {
      if (this.plugin.engine.isRunning(mount.connection.id)) {
        this.display();
        throw new UserError("Wait for the current sync to finish before changing this connection.");
      }
      Object.assign(mount.connection, change);
      await this.plugin.store.save();
      this.plugin.emit();
      this.display();
    });
  }
  connection(root, mount) {
    const connection = mount.connection;
    const card = root.createDiv({ cls: "gsz-settings-workspace" });
    card.createEl("h4", { text: connection.localPath });
    card.createEl("p", { text: `${connection.owner}/${connection.repo} \xB7 ${connection.branch} \xB7 /${connection.remotePath}` });
    new import_obsidian3.Setting(card).setName("Paused").setDesc("Keep local files and stop network sync for this connection.").addToggle((toggle) => toggle.setValue(connection.paused).onChange((value) => this.updateConnection(mount, { paused: value })));
    new import_obsidian3.Setting(card).setName("Access").addDropdown((dropdown) => dropdown.addOption("read-write", "Read and write").addOption("read-only", "Read-only").setValue(connection.access).onChange((value) => this.updateConnection(mount, { access: value })));
    new import_obsidian3.Setting(card).setName("Upload automatically").setDesc("Commit local changes after the upload delay. Deletions still require review.").addToggle((toggle) => toggle.setDisabled(connection.access === "read-only").setValue(connection.autoUpload).onChange((value) => this.updateConnection(mount, { autoUpload: value })));
    new import_obsidian3.Setting(card).setName("Disconnect").setDesc("Keep all local and GitHub files. Device-only baselines and unresolved conflict snapshots for this connection are removed.").addButton((button) => button.setButtonText("Disconnect\u2026").onClick(() => new DisconnectModal(this.plugin, mount, () => this.display()).open()));
  }
};
var DisconnectModal = class extends import_obsidian3.Modal {
  constructor(plugin, mount, done) {
    super(plugin.app);
    this.plugin = plugin;
    this.mount = mount;
    this.done = done;
  }
  onOpen() {
    this.contentEl.createEl("h2", { text: "Disconnect this folder?" });
    this.contentEl.createEl("p", { text: "All local and GitHub files stay in place. The device-only synchronization baseline and conflict snapshots for this connection will be removed. Resolve any conflicts you want to keep first." });
    action(this.contentEl, "Disconnect and keep files", () => this.plugin.run(async () => {
      await this.plugin.engine.disconnect(this.mount.connection.id);
      this.done();
      this.close();
    }));
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/main.ts
var GitHubSyncZev = class extends import_obsidian4.Plugin {
  store;
  client;
  engine;
  bridge;
  exporter;
  secretId = "";
  ready = false;
  uploadTimers = /* @__PURE__ */ new Map();
  lastPoll = 0;
  statusEl = null;
  changedTimer = null;
  syncAllRunning = false;
  async onload() {
    try {
      let deviceKey = this.app.loadLocalStorage("github-sync-zev-device-key");
      if (typeof deviceKey !== "string" || !/^[a-z0-9-]+$/.test(deviceKey)) {
        deviceKey = crypto.randomUUID();
        this.app.saveLocalStorage("github-sync-zev-device-key", deviceKey);
      }
      this.secretId = `github-sync-zev-${String(deviceKey)}`;
      this.store = new DeviceStore(String(deviceKey));
      await this.store.open();
      this.bridge = new VaultBridge(this.app, () => this.store.data.settings.maxFileMB * 1024 * 1024);
      this.client = new GitHubClient(async (params) => {
        const response = await (0, import_obsidian4.requestUrl)({ ...params, throw: false });
        let json;
        try {
          json = response.json;
        } catch {
          json = null;
        }
        return { status: response.status, headers: response.headers, json };
      }, (id) => this.app.secretStorage.getSecret(id), () => this.store.data.settings.maxFileMB * 1024 * 1024);
      this.engine = new SyncEngine(this.store, this.bridge, this.client, () => this.emit());
      this.exporter = new VaultExportService(this.store, this.client, () => this.emit());
      for (const mount of Object.values(this.store.data.mounts)) this.validateConnection(mount.connection, mount.connection.id);
      this.registerView(VIEW_TYPE, (leaf) => new ExplorerView(leaf, this));
      this.addRibbonIcon("github", "Open GitHub workspace", () => this.run(() => this.openExplorer()));
      this.addCommand({ id: "open-workspaces", name: "Open workspace browser", callback: () => this.run(() => this.openExplorer()) });
      this.addCommand({ id: "connect-folder", name: "Open or connect a GitHub folder", callback: () => new ConnectModal(this).open() });
      this.addCommand({ id: "sync-all", name: "Sync all connected folders", callback: () => this.run(() => this.syncAll(true)) });
      this.addCommand({ id: "refresh-all", name: "Download remote updates", callback: () => this.run(() => this.syncAll(false)) });
      this.addCommand({ id: "safe-diagnostics", name: "Show private-data-free diagnostics", callback: () => new DiagnosticModal(this).open() });
      this.addCommand({ id: "save-full-vault", name: "Save standalone vault to GitHub", callback: () => new VaultExportModal(this).open() });
      this.addSettingTab(new PluginSettings(this));
      this.statusEl = this.addStatusBarItem();
      this.statusEl.addClass("gsz-statusbar");
      this.statusEl.addEventListener("click", () => this.run(() => this.openExplorer()));
      this.registerEvent(this.app.vault.on("modify", (file) => this.fileChanged(file)));
      this.registerEvent(this.app.vault.on("create", (file) => this.fileChanged(file)));
      this.registerEvent(this.app.vault.on("delete", (file) => this.fileChanged(file)));
      this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
        this.fileChanged(file);
        this.pathChanged(oldPath);
      }));
      this.registerDomEvent(window, "online", () => {
        this.lastPoll = 0;
        this.emit();
        this.backgroundSync();
      });
      this.registerDomEvent(window, "offline", () => this.emit());
      this.registerDomEvent(document, "visibilitychange", () => {
        if (document.visibilityState === "visible") {
          this.lastPoll = 0;
          this.backgroundSync();
        }
      });
      this.registerInterval(window.setInterval(() => this.backgroundSync(), 5e3));
      this.ready = true;
      this.app.workspace.onLayoutReady(() => {
        if (!this.ready) return;
        this.emit();
        this.backgroundSync();
      });
    } catch (error) {
      this.ready = false;
      this.store?.close();
      this.showError(error);
    }
  }
  onunload() {
    this.ready = false;
    this.engine?.stop();
    this.exporter?.stop();
    for (const timer of this.uploadTimers.values()) window.clearTimeout(timer);
    this.uploadTimers.clear();
    if (this.changedTimer !== null) window.clearTimeout(this.changedTimer);
    if (this.store) void this.store.flush().catch(() => void 0).finally(() => this.store.close());
  }
  run(task) {
    void task().catch((error) => this.showError(error));
  }
  showError(error) {
    new import_obsidian4.Notice(error instanceof UserError ? error.message : "The operation could not finish. Local files were kept. Retry or reopen the workspace browser.", 8e3);
  }
  storeToken(token) {
    const value = token.trim();
    if (value.length < 20 || value.length > 255 || /\s/.test(value)) throw new UserError("Paste a valid GitHub personal access token.");
    this.app.secretStorage.setSecret(this.secretId, value);
  }
  fileChanged(file) {
    this.pathChanged(file.path);
  }
  pathChanged(path) {
    if (!this.ready) return;
    for (const mount of Object.values(this.store.data.mounts)) {
      const connection = mount.connection;
      if (!inFolder(path, connection.localPath)) continue;
      const relative = path.slice(connection.localPath.length + 1);
      if (relative && !supported(relative) && path !== connection.localPath) {
        if (!Object.keys(mount.baseline).some((p) => inFolder(p, relative))) continue;
      }
      mount.pending = Math.max(1, mount.pending);
      if (this.changedTimer === null) this.changedTimer = window.setTimeout(() => {
        this.changedTimer = null;
        this.run(() => this.store.save());
        this.emit();
      }, 400);
      if (connection.paused || !connection.autoUpload || connection.access !== "read-write" || this.engine.isRunning(connection.id)) continue;
      const previous = this.uploadTimers.get(connection.id);
      if (previous !== void 0) window.clearTimeout(previous);
      this.uploadTimers.set(connection.id, window.setTimeout(() => {
        this.uploadTimers.delete(connection.id);
        this.run(() => this.syncOne(connection.id, true));
      }, this.store.data.settings.uploadDelaySeconds * 1e3));
    }
  }
  backgroundSync() {
    if (!this.ready || this.engine.isStopped() || document.visibilityState === "hidden" || navigator.onLine === false) return;
    if (Date.now() - this.lastPoll < this.store.data.settings.pollSeconds * 1e3) return;
    this.lastPoll = Date.now();
    this.run(() => this.syncAll());
  }
  async syncOne(id, upload, approval) {
    const mount = this.store.data.mounts[id];
    if (!mount || mount.connection.paused || this.engine.isRunning(id) || this.exporter?.busy) return;
    await this.bridge.flushEditors(mount.connection.localPath);
    await this.engine.sync(id, upload ?? mount.connection.autoUpload, approval);
    this.emit();
  }
  async syncAll(upload) {
    if (this.syncAllRunning || this.exporter?.busy) return;
    this.syncAllRunning = true;
    try {
      for (const id of Object.keys(this.store.data.mounts)) {
        if (!this.ready) break;
        await this.syncOne(id, upload);
      }
    } finally {
      this.syncAllRunning = false;
    }
  }
  validateConnection(connection, except) {
    this.bridge.validateRoot(connection.localPath);
    safePath(connection.remotePath, true);
    const canonical = (path) => path.normalize("NFC").toLowerCase();
    const overlaps = (a, b) => !a || !b || inFolder(a, b) || inFolder(b, a);
    for (const mount of Object.values(this.store.data.mounts)) {
      const other = mount.connection;
      if (other.id === except) continue;
      if (overlaps(canonical(connection.localPath), canonical(other.localPath))) throw new UserError("Connected local folders cannot overlap. Choose a separate workspace folder.");
      if (connection.owner.toLowerCase() === other.owner.toLowerCase() && connection.repo.toLowerCase() === other.repo.toLowerCase() && connection.branch === other.branch && overlaps(connection.remotePath, other.remotePath)) {
        throw new UserError("This GitHub folder overlaps another connection on the same branch.");
      }
    }
  }
  async connect(connection) {
    this.validateConnection(connection);
    await this.bridge.ensureFolder(connection.localPath);
    await this.engine.add(connection);
    await this.openExplorer();
    await this.syncOne(connection.id, false);
  }
  async saveVault(connectionId, plan) {
    const mount = this.store.data.mounts[connectionId];
    if (!mount) throw new UserError("Select an existing writable repository connection.");
    if (this.syncAllRunning || Object.keys(this.store.data.mounts).some((id) => this.engine.isRunning(id))) throw new UserError("Wait for folder sync to finish, then save the vault.");
    await this.exporter.publish(mount.connection, plan);
  }
  async openExplorer() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const next = this.app.workspace.getLeftLeaf(false);
      if (!next) throw new UserError("Cannot open a workspace pane.");
      leaf = next;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }
  emit() {
    if (!this.ready) return;
    let pending = 0, conflicts = 0, syncing = false, errors = 0;
    for (const mount of Object.values(this.store.data.mounts)) {
      pending += mount.pending;
      conflicts += Object.keys(mount.conflicts).length;
      syncing ||= this.engine.isRunning(mount.connection.id);
      errors += this.engine.status(mount.connection.id).phase === "error" ? 1 : 0;
    }
    const summary = this.exporter?.busy ? "Saving vault\u2026" : syncing ? "Syncing\u2026" : conflicts ? `${conflicts} conflicts` : errors ? "Needs attention" : pending ? `${pending} pending` : "Ready";
    this.statusEl?.setText(`GitHub \xB7 ${summary}`);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof ExplorerView) leaf.view.render();
  }
};
