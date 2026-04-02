/**
 * Tests for the path mapping logic end-to-end.
 * Verifies that filterByRepoSubPath + mapToTargetPaths produces correct
 * MappedFileEntry results for various repoSubPath and targetPrefix combinations.
 *
 * Run: npx tsx test_scripts/test-path-mapping.ts
 */

import {
  filterByRepoSubPath,
  mapToTargetPaths,
} from "../src/core/sync-engine.js";
import type { RepoFileEntry } from "../src/core/types.js";

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

// ============================================================
// Mock repository data — simulates a typical project structure
// ============================================================
const mockRepo: RepoFileEntry[] = [
  { path: "README.md", sha: "sha-readme" },
  { path: ".gitignore", sha: "sha-gitignore" },
  { path: "package.json", sha: "sha-pkg" },
  { path: "src/index.ts", sha: "sha-index" },
  { path: "src/utils/helpers.ts", sha: "sha-helpers" },
  { path: "src/templates/extract.json", sha: "sha-extract" },
  { path: "src/templates/validate.json", sha: "sha-validate" },
  { path: "src/templates/prompts/system.txt", sha: "sha-system" },
  { path: "src/templates/prompts/user.txt", sha: "sha-user" },
  { path: "docs/guide.md", sha: "sha-guide" },
  { path: "docs/api/reference.md", sha: "sha-apiref" },
  { path: "docs/api/examples/basic.md", sha: "sha-basic" },
];

// ============================================================
// Scenario 1: Entire repo -> container root (identity)
// ============================================================
console.log("\n=== Scenario 1: Entire repo -> container root ===\n");
{
  const filtered = filterByRepoSubPath(mockRepo, undefined);
  const mapped = mapToTargetPaths(filtered, undefined, undefined);

  assert(mapped.length === 12, "all 12 files mapped");
  assert(mapped[0].repoPath === "README.md", "repoPath preserved");
  assert(mapped[0].blobPath === "README.md", "blobPath equals repoPath");
  assert(mapped[0].sha === "sha-readme", "sha preserved");

  // Spot check a nested file
  const helpers = mapped.find(m => m.repoPath === "src/utils/helpers.ts");
  assert(helpers !== undefined, "nested file found");
  assert(helpers!.blobPath === "src/utils/helpers.ts", "nested blobPath equals repoPath");
}

// ============================================================
// Scenario 2: Repo sub-path only (no target prefix)
// ============================================================
console.log("\n=== Scenario 2: Repo sub-path only ===\n");
{
  const filtered = filterByRepoSubPath(mockRepo, "src/templates");
  const mapped = mapToTargetPaths(filtered, "src/templates", undefined);

  assert(filtered.length === 4, "4 files under src/templates");
  assert(mapped.length === 4, "4 files mapped");

  // Verify sub-path is stripped
  const extract = mapped.find(m => m.repoPath === "src/templates/extract.json");
  assert(extract !== undefined, "extract.json found");
  assert(extract!.blobPath === "extract.json", "sub-path stripped from blobPath");

  const system = mapped.find(m => m.repoPath === "src/templates/prompts/system.txt");
  assert(system !== undefined, "deeply nested file found");
  assert(system!.blobPath === "prompts/system.txt", "deep sub-path correctly stripped");

  // Verify files outside sub-path are excluded
  const readme = mapped.find(m => m.repoPath === "README.md");
  assert(readme === undefined, "README.md excluded (not under sub-path)");
}

// ============================================================
// Scenario 3: Target prefix only (no repo sub-path)
// ============================================================
console.log("\n=== Scenario 3: Target prefix only ===\n");
{
  const filtered = filterByRepoSubPath(mockRepo, undefined);
  const mapped = mapToTargetPaths(filtered, undefined, "my-project");

  assert(mapped.length === 12, "all 12 files mapped");

  const readme = mapped.find(m => m.repoPath === "README.md");
  assert(readme!.blobPath === "my-project/README.md", "target prefix prepended to root file");

  const helpers = mapped.find(m => m.repoPath === "src/utils/helpers.ts");
  assert(helpers!.blobPath === "my-project/src/utils/helpers.ts", "target prefix prepended to nested file");
}

// ============================================================
// Scenario 4: Both repo sub-path and target prefix
// ============================================================
console.log("\n=== Scenario 4: Repo sub-path + target prefix ===\n");
{
  const filtered = filterByRepoSubPath(mockRepo, "docs/api");
  const mapped = mapToTargetPaths(filtered, "docs/api", "api-docs");

  assert(filtered.length === 2, "2 files under docs/api");
  assert(mapped.length === 2, "2 files mapped");

  const ref = mapped.find(m => m.repoPath === "docs/api/reference.md");
  assert(ref !== undefined, "reference.md found");
  assert(ref!.blobPath === "api-docs/reference.md", "sub-path stripped and prefix prepended");

  const basic = mapped.find(m => m.repoPath === "docs/api/examples/basic.md");
  assert(basic !== undefined, "nested example found");
  assert(basic!.blobPath === "api-docs/examples/basic.md", "nested path correctly transformed");
}

// ============================================================
// Scenario 5: Empty prefix (equivalent to container root)
// ============================================================
console.log("\n=== Scenario 5: Empty prefix (container root) ===\n");
{
  const filtered = filterByRepoSubPath(mockRepo, "");
  const mapped = mapToTargetPaths(filtered, "", "");

  assert(filtered.length === 12, "empty repoSubPath returns all files");
  assert(mapped.length === 12, "all files mapped");
  assert(mapped[0].blobPath === "README.md", "empty prefix means no transformation");
}

// ============================================================
// Scenario 6: Root-level files only
// ============================================================
console.log("\n=== Scenario 6: Root-level files targeting a prefix ===\n");
{
  // Filter to only root files (no sub-path filter, but use mockRepo subset)
  const rootFiles: RepoFileEntry[] = [
    { path: "README.md", sha: "sha-readme" },
    { path: "package.json", sha: "sha-pkg" },
  ];
  const mapped = mapToTargetPaths(rootFiles, undefined, "config");

  assert(mapped.length === 2, "2 root files mapped");
  assert(mapped[0].blobPath === "config/README.md", "root file placed under prefix");
  assert(mapped[1].blobPath === "config/package.json", "second root file placed under prefix");
}

// ============================================================
// Scenario 7: Deeply nested sub-path
// ============================================================
console.log("\n=== Scenario 7: Deeply nested sub-path ===\n");
{
  const filtered = filterByRepoSubPath(mockRepo, "src/templates/prompts");
  const mapped = mapToTargetPaths(filtered, "src/templates/prompts", "prompts");

  assert(filtered.length === 2, "2 files under src/templates/prompts");

  const system = mapped.find(m => m.repoPath === "src/templates/prompts/system.txt");
  assert(system!.blobPath === "prompts/system.txt", "deeply nested sub-path correctly stripped");

  const user = mapped.find(m => m.repoPath === "src/templates/prompts/user.txt");
  assert(user!.blobPath === "prompts/user.txt", "second deeply nested file correct");
}

// ============================================================
// Scenario 8: Sub-path that matches no files
// ============================================================
console.log("\n=== Scenario 8: Sub-path that matches no files ===\n");
{
  const filtered = filterByRepoSubPath(mockRepo, "nonexistent/path");
  const mapped = mapToTargetPaths(filtered, "nonexistent/path", "target");

  assert(filtered.length === 0, "no files match nonexistent sub-path");
  assert(mapped.length === 0, "no files mapped from empty filter result");
}

// ============================================================
// Scenario 9: Path normalization edge cases
// ============================================================
console.log("\n=== Scenario 9: Path normalization edge cases ===\n");
{
  // Leading/trailing slashes in repoSubPath
  const filtered1 = filterByRepoSubPath(mockRepo, "/src/templates/");
  assert(filtered1.length === 4, "leading/trailing slashes in repoSubPath normalized");

  // Leading/trailing slashes in targetPrefix
  const mapped1 = mapToTargetPaths(filtered1, "/src/templates/", "/output/");
  assert(mapped1[0].blobPath.startsWith("output/"), "leading/trailing slashes in targetPrefix normalized");
  assert(!mapped1[0].blobPath.startsWith("/"), "no leading slash in output blobPath");
}

// ============================================================
// Scenario 10: Multiple independent mappings (simulating multi-link)
// ============================================================
console.log("\n=== Scenario 10: Multiple independent mappings ===\n");
{
  // Link 1: src/templates -> prompts/
  const filtered1 = filterByRepoSubPath(mockRepo, "src/templates");
  const mapped1 = mapToTargetPaths(filtered1, "src/templates", "prompts");

  // Link 2: docs -> documentation/
  const filtered2 = filterByRepoSubPath(mockRepo, "docs");
  const mapped2 = mapToTargetPaths(filtered2, "docs", "documentation");

  assert(mapped1.length === 4, "link 1: 4 template files mapped");
  assert(mapped2.length === 3, "link 2: 3 doc files mapped");

  // Verify no overlap in blob paths between the two mappings
  const blobPaths1 = new Set(mapped1.map(m => m.blobPath));
  const blobPaths2 = new Set(mapped2.map(m => m.blobPath));
  let overlap = false;
  for (const p of blobPaths1) {
    if (blobPaths2.has(p)) {
      overlap = true;
      break;
    }
  }
  assert(!overlap, "no blob path overlap between independent links");

  // Verify specific paths
  assert(mapped1.some(m => m.blobPath === "prompts/extract.json"), "link 1 correct path");
  assert(mapped2.some(m => m.blobPath === "documentation/guide.md"), "link 2 correct path");
  assert(mapped2.some(m => m.blobPath === "documentation/api/reference.md"), "link 2 nested path correct");
}

// ============================================================
// Scenario 11: SHA integrity through the pipeline
// ============================================================
console.log("\n=== Scenario 11: SHA integrity ===\n");
{
  const filtered = filterByRepoSubPath(mockRepo, "src/templates");
  const mapped = mapToTargetPaths(filtered, "src/templates", "out");

  for (const entry of mapped) {
    const original = mockRepo.find(f => f.path === entry.repoPath);
    assert(original !== undefined, `original found for ${entry.repoPath}`);
    assert(entry.sha === original!.sha, `SHA preserved for ${entry.repoPath}`);
  }
}

// ============================================================
// Summary
// ============================================================
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
