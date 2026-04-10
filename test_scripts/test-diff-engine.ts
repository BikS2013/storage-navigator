/**
 * Smoke / unit tests for diffLink() in src/core/diff-engine.ts
 *
 * Run with:
 *   npx tsx test_scripts/test-diff-engine.ts
 *
 * All scenarios use mock objects — no live Azure or GitHub calls.
 *
 * Covered scenarios:
 *   AC-CORE-01: Perfect sync (all identical)
 *   AC-CORE-02: One file modified
 *   AC-CORE-03: One file repo-only
 *   AC-CORE-04: One file container-only
 *   AC-CORE-05: Never-synced link (empty fileShas)
 *   AC-CORE-06: Path mapping with repoSubPath and targetPrefix
 *   AC-CORE-07: downloadFile never called (verified by mock)
 */

import { diffLink } from "../src/core/diff-engine.js";
import type { RepoProvider, RepoLink, RepoFileEntry } from "../src/core/types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function section(name: string): void {
  console.log(`\n${name}`);
}

// ── Mock factories ─────────────────────────────────────────────────────────

function makeProvider(files: RepoFileEntry[], trackDownloadCalls = false): RepoProvider & { downloadCalls: number } {
  let downloadCalls = 0;
  return {
    downloadCalls: 0,
    async listFiles() {
      return files;
    },
    async downloadFile(_filePath: string): Promise<Buffer> {
      downloadCalls++;
      (this as { downloadCalls: number }).downloadCalls = downloadCalls;
      throw new Error("downloadFile should never be called in diff");
    },
  };
}

function makeLink(overrides: Partial<RepoLink> = {}): RepoLink {
  return {
    id: "test-link-id",
    provider: "github",
    repoUrl: "https://github.com/owner/repo",
    branch: "main",
    repoSubPath: undefined,
    targetPrefix: undefined,
    lastSyncAt: "2026-01-01T00:00:00.000Z",
    lastCommitSha: "abc123",
    fileShas: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── AC-CORE-01: Perfect sync (all identical) ───────────────────────────────

section("AC-CORE-01: Perfect sync — all identical");
{
  const files: RepoFileEntry[] = [
    { path: "README.md", sha: "aaa" },
    { path: "src/index.ts", sha: "bbb" },
  ];
  const link = makeLink({
    fileShas: { "README.md": "aaa", "src/index.ts": "bbb" },
  });
  const provider = makeProvider(files);

  const report = await diffLink(provider, link);

  assertEqual(report.summary.identicalCount, 2, "identicalCount");
  assertEqual(report.summary.modifiedCount, 0, "modifiedCount");
  assertEqual(report.summary.repoOnlyCount, 0, "repoOnlyCount");
  assertEqual(report.summary.containerOnlyCount, 0, "containerOnlyCount");
  assert(report.summary.isInSync === true, "isInSync === true");
  assertEqual(report.identical.length, 2, "identical array length");
  assertEqual(report.modified.length, 0, "modified array length");
  assertEqual(report.repoOnly.length, 0, "repoOnly array length");
  assertEqual(report.containerOnly.length, 0, "containerOnly array length");
}

// ── AC-CORE-02: One file modified ─────────────────────────────────────────

section("AC-CORE-02: One file modified");
{
  const files: RepoFileEntry[] = [
    { path: "README.md", sha: "aaa-new" },   // SHA changed
    { path: "src/index.ts", sha: "bbb" },
  ];
  const link = makeLink({
    fileShas: { "README.md": "aaa-old", "src/index.ts": "bbb" },
  });
  const provider = makeProvider(files);

  const report = await diffLink(provider, link);

  assertEqual(report.summary.modifiedCount, 1, "modifiedCount");
  assertEqual(report.summary.identicalCount, 1, "identicalCount");
  assert(report.summary.isInSync === false, "isInSync === false");
  assertEqual(report.modified[0]?.blobPath, "README.md", "modified[0].blobPath");
  assertEqual(report.modified[0]?.remoteSha, "aaa-new", "modified[0].remoteSha");
  assertEqual(report.modified[0]?.storedSha, "aaa-old", "modified[0].storedSha");
}

// ── AC-CORE-03: One file repo-only ────────────────────────────────────────

section("AC-CORE-03: One file repo-only (in remote, absent from fileShas)");
{
  const files: RepoFileEntry[] = [
    { path: "README.md", sha: "aaa" },
    { path: "NEW_FILE.md", sha: "ccc" },     // not in fileShas
  ];
  const link = makeLink({
    fileShas: { "README.md": "aaa" },
  });
  const provider = makeProvider(files);

  const report = await diffLink(provider, link);

  assertEqual(report.summary.repoOnlyCount, 1, "repoOnlyCount");
  assertEqual(report.summary.identicalCount, 1, "identicalCount");
  assert(report.summary.isInSync === false, "isInSync === false");
  assertEqual(report.repoOnly[0]?.blobPath, "NEW_FILE.md", "repoOnly[0].blobPath");
  assertEqual(report.repoOnly[0]?.remoteSha, "ccc", "repoOnly[0].remoteSha");
  assert(report.repoOnly[0]?.storedSha === null, "repoOnly[0].storedSha === null");
}

// ── AC-CORE-04: One file container-only ───────────────────────────────────

section("AC-CORE-04: One file container-only (in fileShas, absent from remote)");
{
  const files: RepoFileEntry[] = [
    { path: "README.md", sha: "aaa" },
    // "deleted-file.md" was removed from repo
  ];
  const link = makeLink({
    fileShas: { "README.md": "aaa", "deleted-file.md": "ddd" },
  });
  const provider = makeProvider(files);

  const report = await diffLink(provider, link);

  assertEqual(report.summary.containerOnlyCount, 1, "containerOnlyCount");
  assertEqual(report.summary.identicalCount, 1, "identicalCount");
  assert(report.summary.isInSync === false, "isInSync === false");
  assertEqual(report.containerOnly[0]?.blobPath, "deleted-file.md", "containerOnly[0].blobPath");
  assert(report.containerOnly[0]?.remoteSha === null, "containerOnly[0].remoteSha === null");
  assertEqual(report.containerOnly[0]?.storedSha, "ddd", "containerOnly[0].storedSha");
}

// ── AC-CORE-05: Never-synced link (empty fileShas) ────────────────────────

section("AC-CORE-05: Never-synced link — all remote files appear as repo-only");
{
  const files: RepoFileEntry[] = [
    { path: "README.md", sha: "aaa" },
    { path: "src/index.ts", sha: "bbb" },
  ];
  const link = makeLink({
    fileShas: {},
    lastSyncAt: undefined,
    lastCommitSha: undefined,
  });
  const provider = makeProvider(files);

  const report = await diffLink(provider, link);

  assertEqual(report.summary.repoOnlyCount, 2, "repoOnlyCount");
  assertEqual(report.summary.identicalCount, 0, "identicalCount");
  assert(report.summary.isInSync === false, "isInSync === false");
  assert(typeof report.note === "string" && report.note.length > 0, "note is set");
  assert(report.note!.includes("never been synced"), "note mentions 'never been synced'");
}

// ── AC-CORE-06: Path mapping with repoSubPath and targetPrefix ────────────

section("AC-CORE-06: Path mapping — repoSubPath='src/docs', targetPrefix='docs'");
{
  const files: RepoFileEntry[] = [
    { path: "src/docs/guide.md", sha: "eee" },
    { path: "src/docs/api.md", sha: "fff" },
    { path: "src/other/ignore.ts", sha: "ggg" },   // outside repoSubPath — must be excluded
  ];
  // After mapping: src/docs/guide.md → docs/guide.md, src/docs/api.md → docs/api.md
  const link = makeLink({
    repoSubPath: "src/docs",
    targetPrefix: "docs",
    fileShas: { "docs/guide.md": "eee", "docs/api.md": "fff" },
  });
  const provider = makeProvider(files);

  const report = await diffLink(provider, link);

  assertEqual(report.summary.total, 2, "total files (ignore.ts excluded)");
  assertEqual(report.summary.identicalCount, 2, "identicalCount");
  assertEqual(report.summary.repoOnlyCount, 0, "repoOnlyCount");
  assert(report.summary.isInSync === true, "isInSync === true");

  // Verify mapped paths
  const identicalPaths = report.identical.map((e) => e.blobPath).sort();
  assert(identicalPaths.includes("docs/guide.md"), "docs/guide.md in identical");
  assert(identicalPaths.includes("docs/api.md"), "docs/api.md in identical");

  // Verify repoPath preserved original
  const guideEntry = report.identical.find((e) => e.blobPath === "docs/guide.md");
  assertEqual(guideEntry?.repoPath, "src/docs/guide.md", "repoPath preserved");
}

// ── AC-CORE-07: downloadFile never called ─────────────────────────────────

section("AC-CORE-07: provider.downloadFile() is never called");
{
  const files: RepoFileEntry[] = [
    { path: "README.md", sha: "aaa" },
    { path: "CHANGED.md", sha: "bbb-new" },
    { path: "NEW.md", sha: "ccc" },
  ];
  const link = makeLink({
    fileShas: { "README.md": "aaa", "CHANGED.md": "bbb-old", "DELETED.md": "zzz" },
  });
  const provider = makeProvider(files, true);

  // Run a diff that exercises all four categories
  const report = await diffLink(provider, link);

  // Verify categories are correct (sanity check)
  assertEqual(report.summary.identicalCount, 1, "identicalCount sanity");
  assertEqual(report.summary.modifiedCount, 1, "modifiedCount sanity");
  assertEqual(report.summary.repoOnlyCount, 1, "repoOnlyCount sanity");
  assertEqual(report.summary.containerOnlyCount, 1, "containerOnlyCount sanity");

  // Verify downloadFile was never called
  assertEqual(provider.downloadCalls, 0, "downloadFile call count === 0");
}

// ── showIdentical=false strips identical array but preserves count ─────────

section("showIdentical=false: identical[] emptied but identicalCount preserved");
{
  const files: RepoFileEntry[] = [
    { path: "a.md", sha: "111" },
    { path: "b.md", sha: "222" },
  ];
  const link = makeLink({
    fileShas: { "a.md": "111", "b.md": "222" },
  });
  const provider = makeProvider(files);

  const report = await diffLink(provider, link, undefined, undefined, { showIdentical: false });

  assertEqual(report.identical.length, 0, "identical array is empty");
  assertEqual(report.summary.identicalCount, 2, "identicalCount preserved in summary");
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log("All tests passed.");
}
