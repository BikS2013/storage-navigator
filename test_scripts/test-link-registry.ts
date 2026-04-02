/**
 * Tests for the link registry pure functions from sync-engine.ts.
 * Tests: normalizePath, filterByRepoSubPath, mapToTargetPaths,
 *        detectExactConflict, detectOverlap, findLinkByPrefix.
 *
 * Run: npx tsx test_scripts/test-link-registry.ts
 */

import {
  normalizePath,
  filterByRepoSubPath,
  mapToTargetPaths,
  detectExactConflict,
  detectOverlap,
  findLinkByPrefix,
} from "../src/core/sync-engine.js";
import type { RepoFileEntry, RepoLink } from "../src/core/types.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

function assertThrows(fn: () => void, message: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

/** Helper to create a minimal RepoLink for testing */
function makeLink(overrides: Partial<RepoLink> = {}): RepoLink {
  return {
    id: overrides.id ?? "test-id",
    provider: overrides.provider ?? "github",
    repoUrl: overrides.repoUrl ?? "https://github.com/owner/repo",
    branch: overrides.branch ?? "main",
    repoSubPath: overrides.repoSubPath,
    targetPrefix: overrides.targetPrefix,
    lastSyncAt: overrides.lastSyncAt,
    lastCommitSha: overrides.lastCommitSha,
    fileShas: overrides.fileShas ?? {},
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
  };
}

// ============================================================
// normalizePath
// ============================================================
console.log("\n=== normalizePath ===\n");

console.log("Test: undefined input");
assert(normalizePath(undefined) === "", "undefined returns empty string");

console.log("Test: empty string input");
assert(normalizePath("") === "", "empty string returns empty string");

console.log("Test: leading slashes");
assert(normalizePath("/foo/bar") === "foo/bar", "leading slash stripped");
assert(normalizePath("///foo/bar") === "foo/bar", "multiple leading slashes stripped");

console.log("Test: trailing slashes");
assert(normalizePath("foo/bar/") === "foo/bar", "trailing slash stripped");
assert(normalizePath("foo/bar///") === "foo/bar", "multiple trailing slashes stripped");

console.log("Test: both leading and trailing slashes");
assert(normalizePath("/foo/bar/") === "foo/bar", "both leading and trailing slashes stripped");

console.log("Test: normal path (no changes)");
assert(normalizePath("foo/bar") === "foo/bar", "normal path unchanged");

console.log("Test: single segment");
assert(normalizePath("docs") === "docs", "single segment unchanged");

console.log("Test: slash only");
assert(normalizePath("/") === "", "single slash returns empty string");
assert(normalizePath("///") === "", "multiple slashes returns empty string");

// ============================================================
// filterByRepoSubPath
// ============================================================
console.log("\n=== filterByRepoSubPath ===\n");

const sampleFiles: RepoFileEntry[] = [
  { path: "README.md", sha: "aaa" },
  { path: "src/index.ts", sha: "bbb" },
  { path: "src/templates/extract.json", sha: "ccc" },
  { path: "src/templates/deep/nested.json", sha: "ddd" },
  { path: "docs/guide.md", sha: "eee" },
];

console.log("Test: no filter (undefined)");
{
  const result = filterByRepoSubPath(sampleFiles, undefined);
  assert(result.length === 5, "all files returned when repoSubPath is undefined");
}

console.log("Test: no filter (empty string)");
{
  const result = filterByRepoSubPath(sampleFiles, "");
  assert(result.length === 5, "all files returned when repoSubPath is empty string");
}

console.log("Test: exact match (file equals repoSubPath)");
{
  const result = filterByRepoSubPath(sampleFiles, "README.md");
  assert(result.length === 1, "exact match returns single file");
  assert(result[0].path === "README.md", "correct file matched");
}

console.log("Test: prefix match");
{
  const result = filterByRepoSubPath(sampleFiles, "src/templates");
  assert(result.length === 2, "two files under src/templates");
  assert(result.every(f => f.path.startsWith("src/templates")), "all results under src/templates");
}

console.log("Test: prefix match with trailing slash");
{
  const result = filterByRepoSubPath(sampleFiles, "src/templates/");
  assert(result.length === 2, "trailing slash normalized, two files matched");
}

console.log("Test: prefix match with leading slash");
{
  const result = filterByRepoSubPath(sampleFiles, "/src/templates");
  assert(result.length === 2, "leading slash normalized, two files matched");
}

console.log("Test: no matches");
{
  const result = filterByRepoSubPath(sampleFiles, "nonexistent");
  assert(result.length === 0, "no files match nonexistent prefix");
}

console.log("Test: partial name does not false-match");
{
  // "src/temp" should NOT match "src/templates/..."
  const result = filterByRepoSubPath(sampleFiles, "src/temp");
  assert(result.length === 0, "partial folder name does not match");
}

// ============================================================
// mapToTargetPaths
// ============================================================
console.log("\n=== mapToTargetPaths ===\n");

const templateFiles: RepoFileEntry[] = [
  { path: "src/templates/extract.json", sha: "ccc" },
  { path: "src/templates/deep/nested.json", sha: "ddd" },
];

console.log("Test: identity transform (no prefix, no subpath)");
{
  const result = mapToTargetPaths(sampleFiles, undefined, undefined);
  assert(result.length === 5, "all files mapped");
  assert(result[0].blobPath === "README.md", "blobPath equals repoPath for identity");
  assert(result[0].repoPath === "README.md", "repoPath preserved");
  assert(result[0].sha === "aaa", "sha preserved");
}

console.log("Test: with repoSubPath only");
{
  const result = mapToTargetPaths(templateFiles, "src/templates", undefined);
  assert(result.length === 2, "two files mapped");
  assert(result[0].blobPath === "extract.json", "repoSubPath stripped from blobPath");
  assert(result[0].repoPath === "src/templates/extract.json", "repoPath preserved");
  assert(result[1].blobPath === "deep/nested.json", "nested path correctly stripped");
}

console.log("Test: with targetPrefix only");
{
  const result = mapToTargetPaths(sampleFiles.slice(0, 1), undefined, "prompts/coa");
  assert(result.length === 1, "one file mapped");
  assert(result[0].blobPath === "prompts/coa/README.md", "targetPrefix prepended");
  assert(result[0].repoPath === "README.md", "repoPath preserved");
}

console.log("Test: with both repoSubPath and targetPrefix");
{
  const result = mapToTargetPaths(templateFiles, "src/templates", "prompts/coa");
  assert(result.length === 2, "two files mapped");
  assert(result[0].blobPath === "prompts/coa/extract.json", "sub-path stripped and prefix prepended");
  assert(result[0].repoPath === "src/templates/extract.json", "repoPath preserved");
  assert(result[1].blobPath === "prompts/coa/deep/nested.json", "nested path correctly transformed");
}

console.log("Test: with trailing/leading slashes in parameters");
{
  const result = mapToTargetPaths(templateFiles, "/src/templates/", "/prompts/coa/");
  assert(result[0].blobPath === "prompts/coa/extract.json", "slashes normalized in both parameters");
}

// ============================================================
// detectExactConflict
// ============================================================
console.log("\n=== detectExactConflict ===\n");

const existingLinks: RepoLink[] = [
  makeLink({ id: "1", targetPrefix: "docs" }),
  makeLink({ id: "2", targetPrefix: "prompts/coa" }),
  makeLink({ id: "3", targetPrefix: undefined }),  // container root
];

console.log("Test: no conflict");
assert(
  detectExactConflict(existingLinks, "src") === false,
  "no conflict for 'src'"
);

console.log("Test: exact match with normalized prefix");
assert(
  detectExactConflict(existingLinks, "docs") === true,
  "conflict detected for 'docs'"
);

console.log("Test: exact match with slashes");
assert(
  detectExactConflict(existingLinks, "/docs/") === true,
  "conflict detected for '/docs/' (normalized to 'docs')"
);

console.log("Test: exact match for container root");
assert(
  detectExactConflict(existingLinks, undefined) === true,
  "conflict detected for container root (undefined)"
);

console.log("Test: exact match for container root (empty string)");
assert(
  detectExactConflict(existingLinks, "") === true,
  "conflict detected for container root (empty string)"
);

console.log("Test: no conflict with empty link list");
assert(
  detectExactConflict([], "docs") === false,
  "no conflict with empty link list"
);

// ============================================================
// detectOverlap
// ============================================================
console.log("\n=== detectOverlap ===\n");

const overlapLinks: RepoLink[] = [
  makeLink({ id: "1", targetPrefix: "docs" }),
  makeLink({ id: "2", targetPrefix: "prompts/coa" }),
];

console.log("Test: no overlap");
{
  const result = detectOverlap(overlapLinks, "src");
  assert(result === null, "no overlap for 'src'");
}

console.log("Test: nested overlap (new is under existing)");
{
  const result = detectOverlap(overlapLinks, "docs/api");
  assert(result !== null, "overlap detected for 'docs/api' under 'docs'");
  assert(result!.includes("Warning"), "result is a warning message");
}

console.log("Test: nested overlap (new contains existing)");
{
  const linksForTest: RepoLink[] = [makeLink({ id: "1", targetPrefix: "docs/api/v2" })];
  const result = detectOverlap(linksForTest, "docs/api");
  assert(result !== null, "overlap detected when new prefix contains existing");
}

console.log("Test: no overlap with exact match (handled by detectExactConflict)");
{
  const result = detectOverlap(overlapLinks, "docs");
  assert(result === null, "exact match skipped by detectOverlap");
}

console.log("Test: root overlap (new is root, existing is folder)");
{
  const result = detectOverlap(overlapLinks, undefined);
  assert(result !== null, "overlap detected for container root vs folder links");
}

console.log("Test: root overlap (existing is root, new is folder)");
{
  const rootLinks: RepoLink[] = [makeLink({ id: "1", targetPrefix: undefined })];
  const result = detectOverlap(rootLinks, "docs");
  assert(result !== null, "overlap detected for folder vs container root link");
}

console.log("Test: no overlap with empty link list");
{
  const result = detectOverlap([], "docs");
  assert(result === null, "no overlap with empty link list");
}

// ============================================================
// findLinkByPrefix
// ============================================================
console.log("\n=== findLinkByPrefix ===\n");

const searchLinks: RepoLink[] = [
  makeLink({ id: "link-1", targetPrefix: "docs" }),
  makeLink({ id: "link-2", targetPrefix: "prompts/coa" }),
  makeLink({ id: "link-3", targetPrefix: undefined }),
];

console.log("Test: found by prefix");
{
  const result = findLinkByPrefix(searchLinks, "docs");
  assert(result.id === "link-1", "correct link found for 'docs'");
}

console.log("Test: found by prefix with normalization");
{
  const result = findLinkByPrefix(searchLinks, "/docs/");
  assert(result.id === "link-1", "correct link found for '/docs/' (normalized)");
}

console.log("Test: found container root link");
{
  const result = findLinkByPrefix(searchLinks, undefined);
  assert(result.id === "link-3", "container root link found with undefined prefix");
}

console.log("Test: found container root link (empty string)");
{
  const result = findLinkByPrefix(searchLinks, "");
  assert(result.id === "link-3", "container root link found with empty string prefix");
}

console.log("Test: not found throws");
assertThrows(
  () => findLinkByPrefix(searchLinks, "nonexistent"),
  "throws when no link matches"
);

console.log("Test: multiple matches throws");
{
  const dupeLinks: RepoLink[] = [
    makeLink({ id: "a", targetPrefix: "docs" }),
    makeLink({ id: "b", targetPrefix: "docs" }),
  ];
  assertThrows(
    () => findLinkByPrefix(dupeLinks, "docs"),
    "throws when multiple links match"
  );
}

// ============================================================
// Summary
// ============================================================
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
