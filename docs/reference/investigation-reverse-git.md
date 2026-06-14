# Investigation: Reverse-Git — Publishing Azure Storage Content to GitHub / Azure DevOps

## Executive Summary

The reverse-git feature must initialize and incrementally update a remote Git repository (GitHub or Azure DevOps) from Azure Blob Storage at three granularities (account / container / prefix). The clear recommendation across all decision dimensions is to follow the **already-established architecture of the forward-sync feature**: a pure **REST-based, no-working-copy** approach using the provider Git Data APIs, with `fetch` routed through the existing `rateLimitedFetch` helper, ETag-based change detection persisted in `.reverse-git-links.json` (mirroring `.repo-links.json`), batched single-commit-per-push semantics, and a new `RepoWriteClient` abstraction implemented by sibling `github-write-client.ts` / `devops-write-client.ts` modules. This route adds **zero new runtime dependencies** for the GitHub path (Git Data API is plain HTTPS + JSON), satisfies NFR1, mirrors `sync-engine.ts` patterns one-for-one so the codebase remains coherent, and works equally well from CLI, Electron main, and the `storage-nav-api` HTTP server. Local-working-copy approaches (`simple-git`, `isomorphic-git`) are rejected for this project — they import a fundamentally different mental model, require temp-disk handling that breaks the server-runtime use case, and contradict the constraint already encoded in Assumption A4 of the refined request.

## Context

- **What was investigated:** Approach families, libraries, change-detection strategies, repo-creation policies, account-scope semantics, metadata location, commit granularity, provider extensibility, divergence handling, and the diff-engine fit for the reverse-git feature defined in `docs/reference/refined-request-reverse-git.md`.
- **Key requirements driving evaluation:**
  - NFR1: prefer zero new runtime dependencies; reuse `fetch`, `@azure/storage-blob`, `crypto.randomUUID()`.
  - NFR2: 1,000-file initial publish ≤ 5 min; 50-file incremental ≤ 60 s.
  - NFR3: reuse `rateLimitedFetch`; respect 50 ms ADO inter-request delay.
  - NFR4: per-file failures must not abort the operation.
  - NFR6: zero regression to forward-sync surface.
  - Code must run in three runtimes (CLI process, Electron main, `storage-nav-api` Express server).
  - Repository creation must work without a local Git binary (no shell-out, no temp working tree).
- **Provenance:**
  - Refined request: `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git/docs/reference/refined-request-reverse-git.md`
  - Codebase scan: `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git/docs/reference/codebase-scan-reverse-git.md`

---

## Dimension 1 — Git Interaction Strategy

### Option 1a: Pure REST API push via Git Data API (GitHub) + `/git/pushes` (Azure DevOps)
- **Description:** Build Git objects programmatically over HTTPS. For GitHub: `POST /repos/{o}/{r}/git/blobs` → `POST /git/trees` → `POST /git/commits` → `PATCH /git/refs/heads/{b}`. For Azure DevOps: a single `POST /git/repositories/{id}/pushes` carries `refUpdates` + `commits[].changes[]` with `newContent` as `rawtext` or `base64encoded`.
- **Strengths:** Zero filesystem footprint. No `git` binary required. Identical mental model to the existing `sync-engine.ts` (which also speaks REST only). Works inside any Node runtime — CLI, Electron, Express server, future serverless. Already-implemented `rateLimitedFetch` plugs in directly. Per-file errors fit naturally into `PushResult.errors`. The GitHub side is stateless across calls (perfect for the on-demand push model).
- **Weaknesses:** Two provider-specific protocols to implement (GitHub multi-step vs. ADO single-shot). GitHub tree-size limit (100k entries / 7 MB recursive) requires sub-tree decomposition for the storage-account-scope corner case. ADO uses a non-Git-SHA `objectId` so divergence checks need the ADO refs API rather than reading the GitHub ref blob.
- **Effort/Complexity:** Medium.
- **Risk:** Low.
- **Best suited when:** The runtime must be stateless, multi-host (CLI + Electron + HTTP server), and dependency-light. Matches this project exactly.

### Option 1b: Local Git working-copy via `simple-git`
- **Description:** Spawn the system `git` binary through `simple-git`. Clone to temp dir, write blob bytes to working tree, `git add`, `git commit`, `git push` with PAT credentials in the URL.
- **Strengths:** Conceptually simple — anyone who knows Git understands the flow. `simple-git` is mature (~6.7M weekly downloads, ~3.7k GitHub stars [(npmtrends)](https://npmtrends.com/git.js-vs-isomorphic-git-vs-nodegit-vs-simple-git)).
- **Weaknesses:** **Hard dependency on a system `git` binary** — fails the "must run inside `storage-nav-api` server containers" and "must run in Electron app bundle on machines without dev tools" use cases. Requires a temp working tree per push — disk IO, cleanup, and partial-failure recovery overhead. Initial clone of a multi-GB target repo is wasteful when only metadata is needed. Credential handling via embedded PAT in URL is awkward and hard to scrub from process listings. `git` subprocess output must be parsed for progress callbacks (NFR7).
- **Effort/Complexity:** Medium (but with high operational surface).
- **Risk:** Medium-High (deployment fragility from binary dependency).
- **Best suited when:** Targeting a developer workstation where `git` is guaranteed and the team prefers the Git CLI mental model. Does **not** match this project's runtime mix.

### Option 1c: Local Git working-copy via `isomorphic-git` (pure JS)
- **Description:** Use `isomorphic-git` to materialize a `.git` directory in a temp dir (or in memory via `memfs`), commit and push entirely in JS, no `git` binary required.
- **Strengths:** Pure JS, no native deps, no system git required. Same library works in Electron renderer too (though irrelevant here). Active project (~554k weekly downloads, ~7.8k stars) [(npm-compare)](https://npm-compare.com/isomorphic-git,nodegit,simple-git).
- **Weaknesses:** Still requires materializing a working tree (or at least packfile staging in memory) — doubles RAM for large pushes. Pure-JS performance is slower than libgit2 on large repos. Adds a 200-300 KB runtime dependency for a problem the provider's REST APIs already solve cleanly. Push semantics over HTTPS to Azure DevOps are less well-trodden than to GitHub. No advisories surfaced in the targeted search, but it's still a non-zero new attack surface ([GitHub Advisory Database](https://github.com/advisories)).
- **Effort/Complexity:** Medium.
- **Risk:** Medium.
- **Best suited when:** You need to mirror real Git semantics (merge, rebase, packfile transport) — none of which this feature requires.

### Comparison Matrix (Dimension 1)

| Criterion | 1a REST API | 1b simple-git | 1c isomorphic-git |
|---|---|---|---|
| New runtime deps | **None (just fetch)** | `simple-git` + system `git` | `isomorphic-git` |
| Server-runtime compatibility | **Excellent** | Poor (binary req) | Good |
| Electron-app portability | **Excellent** | Fragile | Good |
| Mental-model match to existing `sync-engine.ts` | **Perfect** | Different | Different |
| Performance (1k files / 1MB) | Good (parallel blob POSTs) | Good | Medium |
| Progress callbacks (NFR7) | **Natural** | Hard (parse subprocess) | OK |
| Per-file partial-failure (NFR4) | **Natural** | Awkward (transactional commit) | Awkward |
| Auth using existing `TokenEntry` PAT | **Natural** | Awkward URL embedding | Natural |
| Disk footprint | **Zero** | Working copy | Working copy / memfs |
| Supports both GitHub + ADO equally | **Yes** | Yes | Yes (less battle-tested ADO) |

**Recommendation for Dimension 1:** **Option 1a — Pure REST API.** Confirms Assumption A4 of the refined request.

---

## Dimension 2 — Change Detection

### Option 2a: ETag-per-blob compared against stored snapshot
- **Description:** Persist `path → ETag` map at last successful push. On next push, `listBlobsFlat` returns ETags in the listing response — diff in O(N) without downloading any blob bodies.
- **Strengths:** Cheapest possible. ETag changes deterministically with content. Handles add/modify/delete naturally. Required only one API call per container.
- **Weaknesses:** Renames look like delete + add (acceptable — Git stores it that way anyway). ETags are opaque strings, not content hashes, so cross-storage-account comparison is meaningless (irrelevant for this use case).
- **Risk:** Low. **This is Assumption A3 of the refined request.**

### Option 2b: Listing-snapshot comparison (path-only)
- **Description:** Compare current path set against snapshot, but use content hash only for paths present in both.
- **Weaknesses:** Doesn't detect content changes without re-downloading blobs — defeats NFR2.

### Option 2c: Reuse forward `diff-engine.ts`
- **Description:** Extend the SHA-based diff engine bidirectionally.
- **Weaknesses:** Forward engine compares **Git tree SHAs** (downloaded from the repo) against **stored repo SHAs**. The reverse direction needs **blob ETags** (from Azure storage) against **stored ETag snapshot**. These are *different* fingerprints over *different* sources; conflating them would force the engine to handle two parallel state machines. The codebase scan (`reverse-diff-engine.ts` recommendation, line 173) already calls this out.
- **Risk:** Medium — increases coupling and fights the existing design.

### Option 2d: Azure Event Grid / Blob change feed
- **Description:** Subscribe to storage events for near-real-time triggering.
- **Out of scope per refined request OQ-6 / Assumption A7.** Flag as v2 enhancement.

### Comparison Matrix (Dimension 2)

| Criterion | 2a ETag | 2b Path-only | 2c Reuse forward diff | 2d Event Grid |
|---|---|---|---|---|
| Detects content change | **Yes** | No | Yes | Yes |
| Detects delete | **Yes** | Yes | Yes | Yes |
| Cost per check (1k blobs) | **1 list call** | 1 list call | N download calls | 0 (push) |
| Fit with codebase | **High** | Medium | Low | Out of scope |
| Implementation effort | Low | Low | High | High |

**Recommendation for Dimension 2:** **Option 2a — ETag comparison.** Create a new `src/core/reverse-diff-engine.ts` (do not extend forward `diff-engine.ts`) because the fingerprint sources differ. The reverse engine categorizes `added | modified | deleted | unchanged` using `(path, etag)` tuples.

---

## Dimension 3 — Repository Creation

### Options
- **3a — Auto-create by default:** Always attempt to create if missing.
- **3b — Pre-create only:** Fail with clear error; user must create the repo manually.
- **3c — Opt-in via `--create-repo`:** Default to fail-with-message; create only when flag is passed. **This is the refined request's R2 / AC-A5 / OQ-1 proposal.**
- **3d — Interactive prompt:** TTY-only, blocks scripting.

**Recommendation for Dimension 3:** **Option 3c — Opt-in `--create-repo`.** Reasons: (1) least surprise; (2) protects against typos that would otherwise silently fan out empty repos under the user's account; (3) consistent with the project rule "no fallback defaults for required configuration" (creating a repo is an irreversible side-effect — it should be explicit); (4) confirms refined-request Open Question OQ-1.

Default `--visibility` when `--create-repo` is set: **`private`** (NFR8). For GitHub use `POST /user/repos` or `POST /orgs/{org}/repos` (PAT scope: `repo`). For Azure DevOps use `POST /{org}/{project}/_apis/git/repositories` (PAT scope: `vso.code_manage`).

---

## Dimension 4 — Storage-Account-Scope Semantics

### Options
- **4a — One repo per container, fan-out.**
- **4b — One repo with containers as top-level folders. (Refined request R5.3.)**
- **4c — Per-container repos with commit synchronization.**

**Recommendation for Dimension 4:** **Option 4b.** Justifications: (1) confirms R5.3 in the refined request; (2) one push → one commit means atomic state of the whole account; (3) avoids combinatorial PAT-scope problems (one repo can be private under one owner; fan-out forces N permission decisions); (4) makes the diff-of-record trivially auditable.

Caveat for **OQ-10** in the refined request: when the account contains many containers (≥ 50) or many blobs (≥ 10k), iteration cost grows. Documented mitigation: surface this as a "use sparingly" mode in `docs/tools/storage-nav.md` and recommend per-container links as the default workflow. The engine itself does NOT need a new optimization — `listContainers` + parallel `listBlobsFlat` via `processInBatches` (already in `repo-utils.ts`) is sufficient up to the NFR2 budgets.

---

## Dimension 5 — Metadata Storage Location

### Options
- **5a — In-container hidden blob (`.reverse-git-links.json`) — matches forward `.repo-links.json`. (Refined request Assumption A2.)**
- **5b — Dedicated system container per account (e.g., `.storage-nav-system`).**
- **5c — Local user config alongside credential store.**

### Comparison Matrix (Dimension 5)

| Criterion | 5a In-container | 5b System container | 5c Local config |
|---|---|---|---|
| Portable across machines | **Yes** | **Yes** | No (per machine) |
| Auto-discoverable by other users | **Yes** | Yes (if they know the name) | No |
| Mirrors forward-link pattern | **Yes** | No | No |
| Creates new well-known blob in user's containers | Yes (already done for forward) | Yes (intrusive — adds a new container) | No |
| Works for storage-account-scope | **No (no home container)** | Yes | Yes |
| Effort | Low | Medium (container CRUD) | Low |

**Recommendation for Dimension 5:** **Hybrid 5a + 5c — exactly as proposed in refined-request Assumption A2.**
- Container-scoped and prefix-scoped reverse-links live in `.reverse-git-links.json` at the **container root** (parallels `.repo-links.json` from plan-004).
- Storage-account-scoped reverse-links live in the local user config (the same `CredentialData` JSON), keyed by storage account name, because no canonical home container exists.
- Reject 5b: creating a system container is a side-effect intrusion into the user's account and breaks parity with the forward-link convention; refined-request OQ-2's portability concern is offset by the fact that PATs (in `credentials.json`) are already machine-local, so the storage-account-scope link's portability cap is a non-issue.

---

## Dimension 6 — Commit Granularity

### Options
- **6a — One commit per push run** (batched). **R4.3 / OQ-4 proposal.**
- **6b — One commit per file** (verbose history).
- **6c — One commit per "logical change-set."** Requires user input — out of scope.

**Recommendation for Dimension 6:** **Option 6a — one commit per push.** Reasons: (1) matches forward-sync semantics; (2) GitHub Git Data API and the ADO `/pushes` endpoint both ingest a multi-change commit cheaply in one call; (3) atomicity — the push either succeeds entirely or the ref doesn't move; (4) confirms OQ-4. Commit message follows R4.4's `"Sync from storage <scope> at <iso> (+N ~M -K)"` template.

---

## Dimension 7 — Library Choices

For each provider, the candidate libraries and their fit:

### GitHub
- **`@octokit/rest` v22.0.1** — official, full typed surface, plugin ecosystem (`@octokit/plugin-retry`, `@octokit/plugin-throttling`). Last published 7 months ago, actively maintained by GitHub itself ([npm @octokit/rest](https://www.npmjs.com/package/@octokit/rest)). Pulls in ~7 transitive packages.
- **`@octokit/request`** — lightweight, GitHub-aware fetch wrapper. Fewer transitive deps.
- **Raw `fetch` (Node 18+ global) via existing `rateLimitedFetch`** — zero new deps. The project already uses this approach successfully for `GitHubClient` (`src/core/github-client.ts`).

### Azure DevOps
- **`azure-devops-node-api` v15.1.x** — official, actively maintained (last published ~3 months ago, per [npm listing](https://www.npmjs.com/package/azure-devops-node-api)). Provides typed `GitApi` with `createPush`, `createRepository`, `getRefs`. However, the project already speaks the ADO REST API directly via `rateLimitedFetch` in `DevOpsClient` (`src/core/devops-client.ts`).
- **Raw `fetch` via `rateLimitedFetch`** — zero new deps.

### Comparison Matrix (Dimension 7)

| Criterion | `@octokit/rest` + `azure-devops-node-api` | Raw `fetch` (current project pattern) |
|---|---|---|
| New deps to vet | 2 packages + ~15 transitive | **0** |
| Vetting workload per `<dependency-vetting>` rule | High (audit + caret pin + log entry) | **None** |
| Mental-model match to `GitHubClient` / `DevOpsClient` | Different | **Identical** |
| Built-in pagination, retry, rate-limit | **Yes** | Already implemented in `rateLimitedFetch` |
| TypeScript types | **Excellent** | Hand-written interfaces |
| Risk of supply-chain advisory | Non-zero (cf. 2025 chalk/debug, Nx incidents [Cyberdesserts](https://blog.cyberdesserts.com/npm-security-vulnerabilities/)) | Minimal |
| Implementation effort | Lower (typed methods) | Slightly higher (hand-written DTOs) |
| Long-term maintenance burden | Library version churn (Octokit major bumps require tsconfig changes per the npm-compare notes) | Stable |

**Recommendation for Dimension 7:** **Raw `fetch` via existing `rateLimitedFetch`.** Justifications: (1) preserves NFR1 ("no new runtime dependencies unless strictly required"); (2) exactly mirrors the design choice made for `GitHubClient` and `DevOpsClient` — the new `GitHubWriteClient` / `DevOpsWriteClient` will look like natural siblings; (3) avoids the `<dependency-vetting>` vetting cycle for two packages and their transitive trees; (4) eliminates exposure to the kind of npm supply-chain incidents documented in 2024–2025. The trade-off is hand-written request DTOs, but the surface area is small (about 6 endpoints per provider).

---

## Dimension 8 — Provider Extensibility

**Recommendation for Dimension 8:** Define a `RepoWriteClient` interface in `src/core/types.ts` exposing:

```ts
export interface RepoWriteClient {
  ensureRepo(opts: { name: string; visibility: "public" | "private"; createIfMissing: boolean }): Promise<void>;
  getBranchTip(branch: string): Promise<{ commitSha: string; treeSha?: string } | null>;
  createCommit(opts: {
    branch: string;
    parentCommitSha: string | null;          // null → root commit (initial publish)
    parentTreeSha: string | null;            // null for ADO single-shot push
    message: string;
    author: { name: string; email: string };
    changes: WriteChange[];                  // discriminated union: add | modify | delete
  }): Promise<{ commitSha: string; treeSha: string }>;
}
export type WriteChange =
  | { kind: "add" | "modify"; path: string; contentBytes: Uint8Array }
  | { kind: "delete"; path: string };
```

Both `GitHubWriteClient` and `DevOpsWriteClient` implement this interface. New providers (GitLab / Bitbucket / Gitea) become a new file implementing the same interface; the `reverse-sync-engine.ts` is provider-agnostic at the engine layer — confirms **OQ-7**.

The implementation detail is hidden inside each client: `GitHubWriteClient` does the four-step blobs/trees/commits/refs dance; `DevOpsWriteClient` does the single-shot `/pushes` POST. The engine never sees the difference.

---

## Dimension 9 — Divergence / Conflict Handling

### Options
- **9a — Fail closed** (current Assumption A8 of refined request).
- **9b — Force-push** (`PATCH /git/refs/heads/X` with `force=true`; or ADO push with `isForcePush: true`) — destroys other people's commits.
- **9c — Fast-forward-only** — implicit in failing closed.
- **9d — Push to a new branch** (`reverse-git/sync-<timestamp>`) — requires user to merge.

**Recommendation for Dimension 9:** **Option 9a — fail closed with clear error**, **plus** an opt-in `--force` flag whose semantics are *force-with-lease*-equivalent (the existing R4.8 `--force` rewrites every file; the divergence-force is a separate flag, e.g., `--allow-overwrite-remote`, defaulting to `false`).

Why: (1) destroying remote work silently is unacceptable; (2) v1 doesn't promise merge semantics; (3) confirms Assumption A8 / OQ-5. Document the recovery procedure: the user inspects the remote, manually reconciles, and re-runs `push` after acknowledging.

Detection mechanism: before the push, the engine calls `RepoWriteClient.getBranchTip()`. If the returned `commitSha` does not equal the `lastPushedCommitSha` in the reverse-link metadata, the engine throws a typed `RemoteDivergedError` carrying both SHAs.

---

## Dimension 10 — Diff-Engine Placement

**Recommendation for Dimension 10:** Create a new `src/core/reverse-diff-engine.ts` sibling of `diff-engine.ts`. Do NOT extend the forward engine. Reasons (codebase scan, line 100–101):

| Concern | Forward `diff-engine.ts` | Reverse engine |
|---|---|---|
| Source of "current state" | Remote Git tree (via `RepoProvider.listFiles`) | Azure listing (via `BlobClient.listBlobsFlat`) |
| Source of "last-known state" | `fileShas` map (Git SHA) | `blobSnapshot` map (Azure ETag) |
| Fingerprint algorithm | Git SHA-1 over blob content | Opaque ETag string |
| Categories | added / modified / deleted / unchanged | added / modified / deleted / unchanged |
| Special-cased exclusions | `META_BLOB`, `LINKS_BLOB` | `META_BLOB`, `LINKS_BLOB`, `REVERSE_LINKS_BLOB` |

The categories happen to match in name, but the fingerprint algorithms are different. Forcing a single module to handle both creates branchy code with no shared logic worth preserving. The two engines should share only the `DiffCategory` enum type (in `src/core/types.ts`).

---

## Cross-Cutting Comparison Matrix (Summary)

| Dimension | Recommended Option | Effort | Risk | Confirms refined-request? |
|---|---|---|---|---|
| 1. Git interaction | Pure REST API | Medium | Low | Yes (Assumption A4) |
| 2. Change detection | ETag per-blob | Low | Low | Yes (Assumption A3) |
| 3. Repo creation | Opt-in `--create-repo` | Low | Low | Yes (R2.1 / AC-A5 / OQ-1) |
| 4. Account scope | One repo, containers as top-level folders | Low | Low | Yes (R5.3) |
| 5. Metadata location | In-container blob + local config for account-scope | Low | Low | Yes (Assumption A2 / OQ-2) |
| 6. Commit granularity | One commit per push | Low | Low | Yes (R4.3 / OQ-4) |
| 7. Library choice | Raw `fetch` via `rateLimitedFetch` (no new deps) | Medium | Low | Yes (NFR1) |
| 8. Extensibility | `RepoWriteClient` interface | Low | Low | Yes (OQ-7) |
| 9. Divergence | Fail closed; optional `--allow-overwrite-remote` | Low | Low | Yes (Assumption A8 / OQ-5) |
| 10. Diff engine | New `reverse-diff-engine.ts` sibling | Low | Low | Codebase-scan recommendation |

### OQ-3 — Extend `GitHubClient` / `DevOpsClient` in place vs. sibling write clients?

**Recommendation: sibling write clients.** Create `src/core/github-write-client.ts` and `src/core/devops-write-client.ts`. Justifications:
1. The existing clients are intentionally read-only and consumed by the forward `sync-engine.ts` — adding write methods enlarges the public surface and risks accidental coupling.
2. Sibling files keep the read/write split visible in the directory layout, mirroring the read/write split in PAT scopes.
3. Tests are easier to scope (the read clients' existing tests stay untouched).
4. The new `RepoWriteClient` interface lives only on the write side — no need to evolve `RepoProvider`.

### OQ-8 — Naming

**Recommendation: accept refined-request naming as-is.** `publish-github` / `publish-devops` / `push` / `reverse-link-github` / `reverse-link-devops` / `reverse-unlink` / `list-reverse-links` / `.reverse-git-links.json`. They map cleanly onto the existing `clone-*` / `sync` / `link-*` / `unlink` / `list-links` family and pass the "obvious-from-name" test.

### OQ-9 — Commit author identity

**Recommendation:** **(b) configurable per-reverse-link** with a sensible default: `"Storage Navigator <storage-nav@local>"` if neither `--author-name` nor `--author-email` is provided AND the reverse-link record has no stored author. Avoid option (c) — an extra API call to look up the PAT's identity adds latency and breaks the offline case.

### OQ-10 — Storage-account scope iteration cost

**Recommendation:** Document storage-account scope as "use sparingly" in `docs/tools/storage-nav.md`. The engine itself is unchanged; performance optimisation deferred to v2 if metrics warrant.

### OQ-11 — `.gitignore` semantics

**Recommendation:** Patterns are evaluated **relative to the source scope root** (storage-account-scope: per-container root; container/prefix-scope: the prefix root). After the path-mapping rules (R5.1–R5.3) translate the storage path into the repo path, `.gitignore` is **not** re-evaluated against the mapped repo path. This matches typical user intuition (write the `.gitignore` next to your data, not next to your published repo).

### OQ-12 — Forward × Reverse coexistence

**Recommendation:** Allow both independently with **no implicit chaining**. Forward-sync writing into a container does NOT auto-trigger a reverse push. Document the configuration explicitly. The two metadata blobs (`.repo-links.json` and `.reverse-git-links.json`) coexist by virtue of distinct file names.

---

## Recommendation (Holistic)

Build the feature as a faithful directional mirror of `sync-engine.ts`:

1. **REST-only, no working copy.** Use raw `fetch` via existing `rateLimitedFetch` against GitHub Git Data API and Azure DevOps `/git/pushes`. Zero new runtime dependencies.
2. **New sibling write clients.** `src/core/github-write-client.ts` and `src/core/devops-write-client.ts` implement a new `RepoWriteClient` interface defined in `src/core/types.ts`. The existing read-only clients remain untouched.
3. **ETag-based reverse diff.** A new `src/core/reverse-diff-engine.ts` compares the live blob listing's ETag map against the `lastPushedBlobSnapshot` stored in each `ReverseLink`. Forward diff engine is unchanged.
4. **Metadata co-located with data.** Container/prefix-scoped reverse-links live in `.reverse-git-links.json` at the container root. Storage-account-scoped reverse-links live in the local `CredentialData` JSON keyed by storage-account name.
5. **One commit per push.** Default. `--force` re-pushes every file as modified (R4.8). `--allow-overwrite-remote` (separate flag) is the only path through a divergence check.
6. **Opt-in repo creation.** `--create-repo` flag required; defaults to private; uses GitHub `POST /user/repos` or `POST /orgs/{o}/repos`, and ADO `POST /{org}/{project}/_apis/git/repositories`.
7. **Provider extensibility.** `RepoWriteClient` interface; engine layer provider-agnostic.

This recommendation would change only if a future requirement forces local-working-copy semantics (e.g., need to apply LFS, sign commits, or replay actual Git history) — none of which appear in the refined request.

---

## Technical Research Guidance

**Research needed:** Yes.

### Topic 1: GitHub Git Data API — Tree / Commit / Ref construction for batch pushes
- **Why:** This is the core engine of `GitHubWriteClient`. Mistakes (wrong file mode, missing parent SHA, empty-repo `409`, large-tree truncation) will block the initial publish and the incremental push.
- **Focus:** (a) the four-call sequence `POST /git/blobs` → `POST /git/trees` (with `base_tree` to inherit unchanged paths on incremental pushes) → `POST /git/commits` → `PATCH /git/refs/heads/{branch}`; (b) file-mode constants (`100644` / `100755` / `040000` / `120000` / `160000`); (c) empty-repo bootstrap (`409 Conflict` workaround via `PUT /repos/{o}/{r}/contents/{path}` to initialize the default branch, **then** switch to Git Data API for everything else); (d) tree-size limit (100k / 7 MB) and sub-tree decomposition pattern; (e) PAT scope (`Contents: write` for fine-grained PATs, `repo` for classic PATs); (f) the `content` shortcut on `/git/trees` (avoids the separate blob POST for small files — important for NFR2); (g) repo auto-creation endpoints and visibility flag.
- **Depth:** Deep dive.
- **Relevance:** Directly drives the implementation of `GitHubWriteClient.createCommit()` and `ensureRepo()`. Without this, the engine cannot be coded.

### Topic 2: Azure DevOps Git REST API — `/pushes` endpoint and ref-update semantics
- **Why:** ADO's single-shot push model is unlike GitHub's; the codebase has read-only ADO experience but no write experience.
- **Focus:** (a) request body schema for `POST /{org}/{project}/_apis/git/repositories/{repoId}/pushes?api-version=7.1` — `refUpdates[].oldObjectId` (zeros for initial commit), `commits[0].comment`, `commits[0].changes[]` with `changeType` enum (`add | edit | delete | rename`) and `newContent.contentType` (`rawtext | base64encoded`); (b) how to retrieve `oldObjectId` via `GET /git/repositories/{id}/refs?filter=heads/{branch}`; (c) initial-commit semantics (`oldObjectId` all zeros); (d) repo auto-creation: `POST /{org}/{project}/_apis/git/repositories?api-version=7.1`; (e) PAT scope (`vso.code_manage` or `Code (Read & Write)`); (f) the 50 ms inter-request delay already enforced by `rateLimitedFetch`; (g) per-file size limits and the per-push payload size cap (ADO accepts large payloads but a single POST with thousands of files may need chunked pushes — investigate concrete thresholds); (h) error semantics for divergence (HTTP status + `typeKey`).
- **Depth:** Deep dive.
- **Relevance:** Directly drives `DevOpsWriteClient.createCommit()`, `ensureRepo()`, and divergence detection.

### Topic 3: Git blob SHA-1 computation (optional — only if pre-flight optimization is wanted)
- **Why:** GitHub allows passing `content` directly in the tree to avoid the blob-creation round-trip — but only for text content under reasonable size. For binaries the project still needs to POST blobs. As an optimization, the engine could compute Git's blob SHA-1 locally (`"blob {size}\0{content}"`) and check whether the remote tree already references that SHA, skipping uploads of unchanged blobs.
- **Focus:** Algorithm, `crypto.createHash("sha1")` usage in Node, validation against known SHAs.
- **Depth:** Overview.
- **Relevance:** Optional NFR2 optimisation; can be deferred to v1.1.

---

## Implementation Considerations

- **Empty-repo bootstrap on GitHub.** When `--create-repo` succeeds, the new repo has no commits and the Git Data API returns `409 Conflict`. The implementation must either (a) initialize via `PUT /contents/{path}` on a single placeholder file, then immediately replace it via the Git Data API, or (b) use `auto_init: true` on `POST /user/repos` to get a README and switch to Git Data API from there. Recommended: `auto_init: true` then overwrite via Git Data API on the initial publish (the README will be replaced unless the user excluded `README.md`).
- **`base_tree` on incremental commits.** Critical for NFR2 — without `base_tree`, every incremental commit must re-state the full tree (~100k entries cap). With `base_tree: <parentTreeSha>`, only the changed paths need to be sent.
- **Tree-size cap.** Storage-account-scope publishes with > 100k files must chunk the tree into nested sub-trees. The engine must accept this complexity inside `GitHubWriteClient` and not leak it to `reverse-sync-engine.ts`.
- **Binary content encoding.** GitHub blobs use `encoding: "base64"`; ADO changes use `contentType: "base64encoded"`. Both are handled per-change in the write client.
- **Large-file failures (R7.3).** GitHub rejects files > 100 MB. Catch the per-file error, append to `PushResult.errors`, and continue. Do NOT abort the commit — but do skip those files in the tree.
- **PAT scope verification.** Document required scopes prominently in `docs/tools/storage-nav.md`. GitHub PATs without `repo` scope will fail at `ensureRepo`. ADO PATs without `Code (Read & Write)` fail at `/pushes`.
- **Progress callbacks.** Stream after each blob upload (or each ADO push chunk) so the CLI / server / UI see linear progress. Include `(i / N) uploading blob foo/bar.txt`.
- **Idempotency (NFR5).** Verified by: (a) the reverse-diff returning zero changes when the snapshot matches, and (b) the engine short-circuiting before calling `RepoWriteClient.createCommit()` when the change set is empty.
- **Token expiry warning.** Reuse `TokenEntry.expiresAt` per AC-C5 — warn-before-use, do not block.
- **Suggested first steps:**
  1. Write `RepoWriteClient` interface + `WriteChange` types in `src/core/types.ts`.
  2. Build `GitHubWriteClient` against a throwaway test repo (drive Topic 1 research in parallel).
  3. Build `DevOpsWriteClient` (drive Topic 2 research in parallel).
  4. Build `BlobEnumerator` + `reverse-diff-engine.ts` (no network calls; unit-testable from fixtures).
  5. Build `reverse-sync-engine.ts` wiring the above together.
  6. Add CLI commands, Express endpoints, Electron modals in that order.
  7. Vitest unit tests per layer; integration test scripts in `test_scripts/`.

---

## References

| # | Source | URL | What was learned |
|---|---|---|---|
| 1 | GitHub REST API endpoints for Git trees | https://docs.github.com/en/rest/git/trees | Tree creation accepts nested entries; supports `base_tree` for incremental updates; recursive read truncates at 100k / 7 MB. |
| 2 | GitHub Getting started with the Git Database API | https://docs.github.com/en/rest/guides/getting-started-with-the-git-database-api | The blobs → trees → commits → refs sequence; folder representation; empty-repo 409 workaround. |
| 3 | Retool: Gotchas with Git and the GitHub API | https://retool.com/blog/gotchas-git-github-api | Real-world scaling lessons; one-tree-per-app strategy informs the sub-tree decomposition recommendation for large account-scope pushes. |
| 4 | DEV Community — Push multiple files under a single commit via GitHub API | https://dev.to/bro3886/create-a-folder-and-push-multiple-files-under-a-single-commit-through-github-api-23kc | Concrete request bodies for batch pushes. |
| 5 | Azure DevOps Pushes - Create REST API v7.1 | https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pushes/create?view=azure-devops-rest-7.1 | Single-shot push schema (`refUpdates` + `commits[].changes`); `oldObjectId` zeros for initial commit; `rawtext` vs `base64encoded`. |
| 6 | Azure DevOps Refs - Update Refs REST API | https://learn.microsoft.com/en-us/rest/api/azure/devops/git/refs/update-refs?view=azure-devops-rest-7.1 | Race-safe ref updates require both old and new commit SHAs — informs divergence-detection design. |
| 7 | npm-compare: isomorphic-git vs nodegit vs simple-git | https://npm-compare.com/isomorphic-git,nodegit,simple-git | Confirms isomorphic-git is the only pure-JS option; nodegit's install/portability issues; simple-git requires system `git`. |
| 8 | isomorphic-git project site & docs | https://isomorphic-git.org/ | Pure-JS git for node/browser; push works over HTTPS; slower than native for large repos. |
| 9 | npm trends — git.js vs isomorphic-git vs nodegit vs simple-git | https://npmtrends.com/git.js-vs-isomorphic-git-vs-nodegit-vs-simple-git | Weekly download counts and momentum. |
| 10 | npm @octokit/rest | https://www.npmjs.com/package/@octokit/rest | v22.0.1 (last 7 mo); 3,789 dependents; official GitHub maintenance. |
| 11 | Socket.dev — @octokit/rest security analysis | https://socket.dev/npm/package/@octokit/rest | Transitive dependency footprint; supply-chain risk surface. |
| 12 | npm azure-devops-node-api | https://www.npmjs.com/package/azure-devops-node-api | v15.1.x; active maintenance; provides typed GitApi. |
| 13 | GitHub Advisory Database | https://github.com/advisories | Authoritative source for npm advisories. |
| 14 | NPM Security Risks 2026 | https://blog.cyberdesserts.com/npm-security-vulnerabilities/ | 2024-2025 supply-chain incident landscape (nx, chalk/debug) — supports the "minimize new deps" stance. |

---

## Original Request

> I want you to implement a reverse Git capability that allows a storage navigator to initiate a Git repository based on the current storage account, a subfolder of the current storage account, or a container within the current storage account. Besides initiating the Git repository, it must be able to update the repository based on the content of the connected linked storage account, container, or subfolder. It should monitor changes and update the content of the Git repository accordingly. These capabilities must be implemented to support GitHub repositories and Azure DevOps repositories.

Full refined specification: `/Users/giorgosmarinos/aiwork/agent-platform/storage-navigator-reverse-git/docs/reference/refined-request-reverse-git.md`
