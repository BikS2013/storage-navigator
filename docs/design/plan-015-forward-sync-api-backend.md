# Plan 015 — Forward repo-sync over API backends

## Problem

Storage Navigator supports two storage backend kinds: `direct` (Azure SDK straight to blob storage) and `api` (REST calls to the `API/` service, which brokers Azure access behind OIDC + RBAC). Blob browsing already worked with both, via `IStorageBackend` (`src/core/backend/backend.ts`).

The forward repo-sync subsystem never made that transition. `src/core/sync-engine.ts` and `src/core/diff-engine.ts` took a concrete `BlobClient`, whose constructor throws for anything but a direct entry. `src/electron/server.ts` therefore guarded nine endpoints with `requireDirect()`, returning:

```
400 {"error": "This endpoint currently only supports direct storage backends."}
```

Reproduced by adding an api backend and trying to link a container to an Azure DevOps repo. The same limitation applied to the CLI repo commands and the agent's repo tools, which all constructed `new BlobClient(entry)` directly.

## Decision

Refactor the two engines onto `IStorageBackend`. No *new* API routes were needed — every operation the engines perform maps onto a route `API/` already serves (one pre-existing API bug did have to be fixed, see "API body-parser bug" below):

| Engine operation | `IStorageBackend` method | API route |
|---|---|---|
| read `.repo-links.json` / `.repo-sync-meta.json` | `readBlob` | `GET .../blobs/*path` |
| write registry, upload repo file | `uploadBlob` | `PUT .../blobs/*path` |
| delete stale file | `deleteBlob` | `DELETE .../blobs/*path` |
| physical blob check for `diff` | `iterateBlobsFlat` | `GET .../blobs` (flat + paged) |

**Out of scope:** reverse-git publication stays direct-only. `reverse-sync-engine.ts` and `blob-enumerator.ts` still take a concrete `BlobClient`, and the enumerator's per-blob `getBlobProperties` ETag `HEAD` would become one HTTP round-trip per blob over an api backend. Lifting it needs an `etag` field on `BlobItem` first, so that `ApiBackend.listBlobs` can carry ETags out of the paged listing (`API/src/azure/blob-service.ts` already returns them; `src/core/types.ts:BlobItem` drops them). That is a separate change.

## Implementation

### Shared stream helper

`readBlob` returns a stream where `getBlobContent` returned a Buffer. Two private copies of the drain loop already existed, so they were consolidated into `src/util/stream.ts` (`streamToBuffer`) and adopted in `src/cli/commands/view.ts` and `src/core/backend/direct-backend.ts`. `src/util/*` imports nothing from `core/`, keeping `core → util` a leaf dependency.

### sync-engine

All nine exported functions take `backend: IStorageBackend` as their first positional parameter instead of `blobClient: BlobClient`. Two module-private helpers absorb the shape change:

- `readJsonBlob` — `readBlob` + `streamToBuffer` + `JSON.parse`
- `writeJsonBlob` — `Buffer.from(json, "utf-8")` + `uploadBlob(..., body.byteLength, "application/json")`

Dead `writeSyncMeta` (module-private, zero references) was deleted.

**Byte length, not string length.** `ApiBackend.uploadBlob` writes `sizeBytes` straight into the `Content-Length` header. Using `String.length` would truncate the body whenever the registry JSON or a repo file contains multi-byte UTF-8 — e.g. a Greek path or a non-ASCII repo URL. Every upload path now passes `Buffer.byteLength`.

**Narrowed missing-blob catch.** `readSyncMeta` and `readLinks` previously did `catch { return null }`. That was tolerable when the only realistic failure was a 404, but against an api backend a `NeedsLoginError` (401) or `AccessDeniedError` (403) would be swallowed too: the synced container renders as unlinked, and the next `createLink` starts from an empty registry and **wipes the real links** on write. The catch now re-throws anything that is not a 404:

```ts
function isNotFound(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number } | null;
  return e?.status === 404 || e?.statusCode === 404;
}
```

Duck-typed so the engine stays backend-agnostic — the api backend's `NotFoundError` carries `.status`, Azure's `RestError` carries `.statusCode`. Container-not-found remains swallowed, so behavior on that path is unchanged.

### diff-engine

`diffLink`'s optional client parameter became `backend?: IStorageBackend`. The single use — the physical-blob check — moved from the eager `listBlobsFlat(container)` to draining `backend.iterateBlobsFlat(container, "")`.

**`iterateBlobsFlat`, not `listBlobs`.** `DirectBackend.listBlobs` ignores `opts.delimiter` and always hierarchy-lists with `/`, and never paginates; `ApiBackend.listBlobs` pages. Only `iterateBlobsFlat` is flat *and* paginated on both implementations. An empty-string prefix is falsy on both, meaning "whole container".

### CLI and agent

`resolveStorageBackend` in `src/cli/commands/shared.ts` was widened to return `{ store, entry, backend }` — purely additive, so the 20+ existing `{backend}` / `{entry, backend}` destructures kept compiling. The repo commands need `store` for `resolvePatToken`; calling both resolvers instead would construct `CredentialStore` twice.

Every `resolveStorageEntry` + `new BlobClient(entry)` pair in `link-ops.ts` (5 sites, including `linkSsh`), `repo-sync.ts` (4 sites, including `cloneSsh`), `diff-ops.ts` (1), and `src/agent/tools/repo-tools.ts` (2) now calls `resolveStorageBackend(opts, opts.account)`. A dead `readSyncMeta` import was dropped from `repo-sync.ts`.

### Server

The nine handlers now call the existing `backendFor(req, store)`, which already resolves both kinds and reads the Azure account name from `?account=`. A new `sendBackendError(res, err)` preserves a backend error's HTTP status so an api backend's 401/403 reaches the UI intact instead of collapsing into a 500 — this is what surfaces an RBAC rejection as a real 403.

`requireDirect` survives for `reverseGitContext()` only; its doc comment and the sync section header were rewritten to say so and why.

### API body-parser bug (found during live verification)

Live testing against the deployed dev API surfaced a **pre-existing** bug that blocked this work. `API/src/app.ts` mounted `express.json({ limit: '1mb' })` globally. That parser consumes the request body for any `application/json` request — including `PUT`, whose two routes (blob upload, `routes/blobs.ts:149`; file upload, `routes/files.ts:130`) stream `req` directly into Azure. The handler then awaited a stream that had already been drained, so the request hung until the client gave up.

Symptoms, reproduced three ways:

| Probe | `text/plain` | `application/octet-stream` | `application/json` |
|---|---|---|---|
| Raw `fetch` PUT to deployed API | 201 (387 ms) | 201 (129 ms) | hang → abort at 15 s |
| `ApiBackend.uploadBlob` | OK (380 ms) | — | hang > 25 s |
| 12-line local Express repro | `bytes: 7` | `bytes: 7` | `bytes: 0` |

This already broke `storage-nav create --file foo.json` over an api backend (`blob-ops.ts:91` sets `application/json` for `.json`), and it blocked plan-015 because the registry blob is written as `application/json`.

Fix: give `express.json()` a `type` predicate that skips `PUT`. Every route that wants a parsed JSON body is a `POST` (container create, share create, rename, download-zip) — verified by enumerating all mutating routes; the only `PUT`s are the two uploads. The predicate otherwise mirrors the default media-type test, so `+json` suffixes still parse on POST.

### Frontend

Ten fetches in `src/electron/public/app.js` called these endpoints without the `withAccount()` helper (lines 669, 1627, 1738, 1773, 1846, 1870, 1889, 1904, 2020, 2088). Without it the server falls back to the entry name as the Azure account name for api backends — silently wrong. Line 1773 (`openLinksPanel`) is the easy one to miss: the badge renders but the panel breaks.

## Verification

Two new test files cover engines that previously had none:

- `tests/unit/sync-engine-backend.test.ts` — an in-memory `FakeBackend` over `Map<string, Buffer>`. Covers: `readLinks` returning null on both 404 shapes; **re-throwing 401 and 403** (the link-wipe regression guard, including a case asserting the seeded registry survives a failed `createLink`); `sizeBytes === byteLength` for multi-byte content on both the registry and file-upload paths; `syncRepo` upload/skip/delete classification; a failing delete landing in `result.errors` without aborting; `dryRun` touching nothing.
- `tests/unit/diff-engine-backend.test.ts` — physical check drains the async generator, annotates `physicallyExists`, honors `targetPrefix`, throws without a backend, and does not enumerate when the check is off.

`API/test/unit/json-upload.test.ts` covers the parser fix through the real `buildApp`: an `application/json` PUT reaches the upload service with its bytes intact, multi-byte UTF-8 survives byte-for-byte, non-JSON uploads still stream, and POST routes still get a parsed body. Confirmed to be a genuine regression test — reverting `app.ts` makes it fail with `received ''` (the drained-stream symptom).

Suites: root `npm test` → 48 files / 702 tests. `API/` `npm test` → 23 files / 99 tests. `npx tsc --noEmit` clean in both packages.

### End-to-end probe

`test_scripts/verify-plan015-api-sync.mts` drives the real `sync-engine` through the real `ApiBackend`, over real HTTP, into a real `buildApp()` instance — only Azure itself is stubbed behind `BlobService`. Every layer this plan touched is exercised for real. 13 checks: empty-container resolve, `createLink` writing the dot-prefixed registry, multi-byte prefix round-trip, re-read over a fresh GET, `syncRepo` upload + stale delete, byte-exact upload content, `diffLink` with the physical check, and `removeLink`. All pass.

### Live verification against the deployed dev API

- `list-links` over the api backend returns "No repository links found" (previously HTTP 400).
- `GET /api/links/dev/<container>?account=<acct>` → `200 {"version":1,"links":[]}`; the direct backend returns the same, confirming no regression.
- A `GET` for `.repo-links.json` returns a 404 carrying an API `correlationId`, proving the leading dot reaches the blob handler rather than missing Express's `*path` wildcard — and that `status: 404` is the field `isNotFound` reads.
- Write path exercised against a scratch container (`storage-nav-plan015-verify`), which surfaced the body-parser bug above; the container was deleted afterwards.

### Still pending

- **UI walkthrough:** select the api storage → click the **account node** (this is what sets `currentAccount`; without it `withAccount` is a no-op) → expand the container → link badge appears → open the links panel → Sync Now → Diff.
- **Full CLI sync against a live repo:** needs a GitHub/ADO PAT, which is not configured in this environment (`list-tokens` → none).
- **RBAC:** the API enforces Reader / Writer / Admin (`API/src/rbac/permissions.ts`). Sync writes blobs and deletes stale ones, and even `createLink` writes `.repo-links.json`, so a StorageReader token cannot link. Re-run `link-github` with a Reader token and confirm a propagated 403 "Insufficient role", not a 500.
- **Deploy:** the `API/` fix only takes effect in QA/dev once the service is redeployed.

## Known gaps

- Reverse-git remains direct-only (see Decision above).
- CLI commands have no global unhandled-rejection handler outside `src/tui/index.ts`, so an `AccessDeniedError` from any api-backend command exits with a raw stack trace. Pre-existing — it already affects `view` and `ls`. Logged in `Issues - Pending Items.md`.
