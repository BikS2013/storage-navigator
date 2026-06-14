// ===========================================================================
// src/core/blob-enumerator.ts
//
// Reverse-git blob enumerator. Given a `ReverseLinkScope` (account /
// container / prefix), walks the in-scope subtree and yields one
// `EnumeratedBlob` per matching blob, applying the path-mapping rules
// R5.1–R5.5, the user-supplied exclusion patterns (R6.1), the optional
// scope-root `.gitignore` (R6.2 / OQ-11), and the always-excluded
// metadata-blob list (`EXCLUDED_BLOB_NAMES`, R6.3 / R6.4).
//
// Inputs are taken read-only from the supplied `BlobClient` and `scope`
// description. No write methods of `BlobClient` are invoked.
//
// Source of truth: docs/design/project-design.md §"Module structure"
// (`blob-enumerator.ts`), §"Path mapping (blob path → repo path)" (5.2),
// and §".gitignore pattern evaluation (scope-root-relative)" (5.9).
// ===========================================================================

import type { BlobClient } from "./blob-client.js";
import {
  EXCLUDED_BLOB_NAMES,
  type EnumeratedBlob,
  type ReverseLinkScope,
} from "./reverse-git-types.js";
import { PathCollisionError } from "./reverse-git-errors.js";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Options accepted by {@link enumerateScope}. */
export interface EnumerateScopeOptions {
  /**
   * `.gitignore`-style exclusion patterns supplied on the `ReverseLink`.
   * Evaluated relative to the source scope root (OQ-11).
   */
  exclusionPatterns: string[];

  /**
   * When true, look for a `.gitignore` at the scope root and honour its
   * patterns in addition to {@link exclusionPatterns}. The `.gitignore`
   * file itself is NEVER excluded by its own rules (AC-D6 invariant).
   */
  respectGitignore: boolean;

  /**
   * Optional sub-folder inside the target repo. Prepended to every
   * `repoPath`. Empty string = repo root.
   */
  repoSubPath: string;

  /**
   * Optional sink for warning messages emitted for skipped illegal paths
   * (backslash, `.git/`, control chars) per R5.4.
   */
  onWarn?: (msg: string) => void;
}

/**
 * Stream every blob that should be published for `scope`, in arbitrary
 * order, applying path mapping + exclusions.
 *
 * The function is an async generator so the engine can build the current
 * snapshot lazily (NFR2: never materialise the entire account in memory).
 *
 * Throws {@link PathCollisionError} when two distinct storage paths map
 * to the same repo path (R5.5 default `abort` policy).
 *
 * @param blobClient Read-only Azure Blob client (existing infra).
 * @param scope      Source scope discriminated union.
 * @param opts       Exclusion + mapping options (see {@link EnumerateScopeOptions}).
 */
export async function* enumerateScope(
  blobClient: BlobClient,
  scope: ReverseLinkScope,
  opts: EnumerateScopeOptions,
): AsyncGenerator<EnumeratedBlob> {
  const repoSubPath = normalizeRepoSubPath(opts.repoSubPath);

  // Track repoPath -> storagePath so we can detect case-insensitive
  // collisions (R5.5). Comparison uses lower-cased key but the error
  // reports the original casings.
  const seenRepoPaths = new Map<string, string>();

  const emit = (b: EnumeratedBlob): EnumeratedBlob => {
    const lowerKey = b.repoPath.toLowerCase();
    const existing = seenRepoPaths.get(lowerKey);
    if (existing !== undefined && existing !== b.storagePath) {
      throw new PathCollisionError([existing, b.storagePath]);
    }
    seenRepoPaths.set(lowerKey, b.storagePath);
    return b;
  };

  switch (scope.kind) {
    case "container": {
      yield* enumerateContainerScope(
        blobClient,
        scope.container,
        "", // no source prefix
        /*topLevelFolder*/ "",
        repoSubPath,
        opts,
        emit,
      );
      return;
    }

    case "prefix": {
      const prefix = normalizeStoragePrefix(scope.prefix);
      yield* enumerateContainerScope(
        blobClient,
        scope.container,
        prefix,
        /*topLevelFolder*/ "",
        repoSubPath,
        opts,
        emit,
      );
      return;
    }

    case "account": {
      const containers = await blobClient.listContainers();
      for (const c of containers) {
        // R5.3 — every container becomes a top-level folder in the repo.
        yield* enumerateContainerScope(
          blobClient,
          c.name,
          "", // no source prefix
          /*topLevelFolder*/ c.name,
          repoSubPath,
          opts,
          emit,
        );
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Per-container walker
// ---------------------------------------------------------------------------

/**
 * Enumerate one container's blobs, applying the supplied source prefix,
 * the per-container `.gitignore` lookup, and the exclusion-pattern
 * filter, then map each surviving blob to its target repo path and
 * invoke `emit()` (collision-checker) before yielding.
 */
async function* enumerateContainerScope(
  blobClient: BlobClient,
  container: string,
  storagePrefix: string,
  topLevelFolder: string,
  repoSubPath: string,
  opts: EnumerateScopeOptions,
  emit: (b: EnumeratedBlob) => EnumeratedBlob,
): AsyncGenerator<EnumeratedBlob> {
  // Lazily load .gitignore at the scope root if requested. The matcher is
  // null when respectGitignore=false or no .gitignore is present.
  const gitignore = opts.respectGitignore
    ? await loadGitignoreMatcher(blobClient, container, storagePrefix)
    : null;

  for await (const item of blobClient.iterateBlobsFlat(
    container,
    storagePrefix || undefined,
  )) {
    const blobName = item.name;

    // Compute path RELATIVE to the scope root. This is the key the
    // gitignore matcher + exclusion patterns are evaluated against
    // (OQ-11 — scope-root-relative).
    const relative = stripScopePrefix(blobName, storagePrefix);

    // ── Filter 1: always-excluded metadata blob names (R6.3 / R6.4) ─────
    if (isAlwaysExcludedBasename(relative)) continue;

    // ── Filter 2: illegal-path checks (R5.4) ──────────────────────────
    const illegal = detectIllegalPath(relative);
    if (illegal !== null) {
      opts.onWarn?.(
        `[blob-enumerator] skipping illegal path "${blobName}" (${illegal})`,
      );
      continue;
    }

    // ── Filter 3: user-supplied exclusion patterns (R6.1) ─────────────
    if (matchesAnyPattern(relative, opts.exclusionPatterns)) continue;

    // ── Filter 4: .gitignore (R6.2 / AC-D6) ───────────────────────────
    if (gitignore && gitignore.ignores(relative)) {
      // The .gitignore file itself is never excluded by its own rules.
      if (basename(relative) === ".gitignore") {
        // fall through and publish .gitignore
      } else {
        continue;
      }
    }

    // ── Fetch etag + size via cheap HEAD ───────────────────────────────
    const props = await blobClient.getBlobProperties(container, blobName);
    if (!props.etag) {
      opts.onWarn?.(
        `[blob-enumerator] skipping "${container}/${blobName}" — no ETag returned by HEAD`,
      );
      continue;
    }

    // ── Map to repo path ──────────────────────────────────────────────
    const repoPath = mapToRepoPath(relative, topLevelFolder, repoSubPath);

    yield emit({
      storagePath: `${container}/${blobName}`,
      repoPath,
      etag: props.etag,
      size: props.size ?? 0,
    });
  }
}

// ---------------------------------------------------------------------------
// Path mapping
// ---------------------------------------------------------------------------

/**
 * Apply scope-specific transform + repo-sub-path prepending.
 *
 * - `container` scope: `relative` is the full blob name → maps 1:1 (R5.1).
 * - `prefix`    scope: `relative` is the blob name minus the prefix → R5.2.
 * - `account`   scope: `topLevelFolder` is the container name → R5.3.
 *
 * `repoSubPath` (when non-empty) is prepended to the final path.
 */
function mapToRepoPath(
  relative: string,
  topLevelFolder: string,
  repoSubPath: string,
): string {
  let path = relative;
  if (topLevelFolder) {
    path = topLevelFolder + "/" + path;
  }
  if (repoSubPath) {
    path = repoSubPath + "/" + path;
  }
  // Normalise: strip leading slash. The transforms above never introduce
  // double slashes because each component is itself normalised.
  return stripLeadingSlash(path);
}

/** Trim leading/trailing `/`. */
function normalizeRepoSubPath(p: string): string {
  return p.replace(/^\/+|\/+$/g, "");
}

/**
 * Normalise a storage prefix so it ends with exactly one `/` when
 * non-empty. Returns `""` for empty input.
 */
function normalizeStoragePrefix(p: string): string {
  if (!p) return "";
  const trimmed = p.replace(/^\/+/, "");
  return trimmed.endsWith("/") ? trimmed : trimmed + "/";
}

/** Strip a `prefix/` from the start of `name` if present. */
function stripScopePrefix(name: string, prefix: string): string {
  if (!prefix) return name;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

function stripLeadingSlash(p: string): string {
  return p.replace(/^\/+/, "");
}

function basename(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

// ---------------------------------------------------------------------------
// Illegal-path detection (R5.4)
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable reason when the path is illegal, otherwise
 * `null`. Illegal paths are reported via `onWarn` and silently skipped
 * (never silently translated — R5.4).
 */
function detectIllegalPath(p: string): string | null {
  if (p.includes("\\")) return "contains backslash";
  if (p === ".git" || p.startsWith(".git/")) return "rooted at .git/";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(p)) return "contains control characters";
  return null;
}

/** Returns true when the basename matches one of the always-excluded names. */
function isAlwaysExcludedBasename(p: string): boolean {
  const name = basename(p);
  return EXCLUDED_BLOB_NAMES.includes(name);
}

// ---------------------------------------------------------------------------
// Pattern matching (small in-tree implementation — no npm dependency)
// ---------------------------------------------------------------------------

/**
 * Returns true when `path` matches at least one glob in `patterns`.
 *
 * Supports the common `.gitignore` subset:
 *   - Literal segments.
 *   - `*`  — matches any run of non-`/` characters.
 *   - `?`  — matches one non-`/` character.
 *   - `**` — matches any depth of segments (including zero), only when
 *            used as its own path segment.
 *   - Leading `/`   — anchors the match at the scope root.
 *   - Trailing `/`  — restricts the pattern to directory matches; for
 *                     file paths we treat this as "match the file when
 *                     any of its ancestor directories matches".
 *
 * Negation (`!`) is intentionally NOT supported in the exclusion-pattern
 * list (R6.1 — patterns are additive). Negation IS honoured inside the
 * dedicated `.gitignore` matcher (see {@link compileGitignore}).
 */
function matchesAnyPattern(path: string, patterns: string[]): boolean {
  for (const pat of patterns) {
    if (!pat || pat.startsWith("#")) continue;
    if (matchesPattern(path, pat)) return true;
  }
  return false;
}

/**
 * Match a single `.gitignore`-style pattern against `path` (a forward-
 * slash-separated relative path, no leading slash).
 */
function matchesPattern(path: string, rawPattern: string): boolean {
  let pattern = rawPattern.trim();
  if (!pattern) return false;

  // Strip a leading `!` — handled at a higher level.
  if (pattern.startsWith("!")) pattern = pattern.slice(1);

  const anchored = pattern.startsWith("/");
  if (anchored) pattern = pattern.slice(1);

  const directoryOnly = pattern.endsWith("/");
  if (directoryOnly) pattern = pattern.slice(0, -1);

  // No slash in the pattern + not anchored ⇒ match the basename at any
  // depth. We achieve this by prefixing `**/`.
  if (!anchored && !pattern.includes("/")) {
    pattern = "**/" + pattern;
  }

  const regex = gitignoreToRegex(pattern, directoryOnly);
  return regex.test(path);
}

/**
 * Translate a `.gitignore` pattern (with `*`, `?`, `**`) into a RegExp
 * anchored at the start of the relative path. When `directoryOnly` is
 * true the pattern matches `path` itself OR any ancestor directory of
 * `path`.
 */
function gitignoreToRegex(pattern: string, directoryOnly: boolean): RegExp {
  const tokens = pattern.split("/");
  let body = "";

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const last = i === tokens.length - 1;

    if (token === "**") {
      // `**` matches any depth (including zero segments). The matching
      // `/` (if any) is part of the next iteration's prefix.
      body += "(?:[^/]+/)*";
      // Skip emitting a trailing `/` — the next non-`**` segment will
      // be matched directly against the remaining path.
    } else {
      body += segmentToRegex(token);
      if (!last) body += "/";
    }
  }

  // Both file and directory patterns are allowed to match descendants
  // ("foo" matches "foo/bar" because gitignore treats listed entries as
  // directories when they ARE directories on disk; for our purposes
  // erring on the side of "match descendants too" is correct because
  // the blob enumerator only ever sees files).
  const tail = "(?:/.*)?$";
  void directoryOnly; // both branches behave the same in this enumerator
  return new RegExp("^" + body + tail);
}

/** Translate a single segment (no `/`) to regex, expanding `*` and `?`. */
function segmentToRegex(seg: string): string {
  let out = "";
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i];
    if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += escapeRegexChar(ch);
    }
  }
  return out;
}

function escapeRegexChar(ch: string): string {
  return /[\\^$.|+()[\]{}]/.test(ch) ? "\\" + ch : ch;
}

// ---------------------------------------------------------------------------
// .gitignore matcher (compiled once per container scope)
// ---------------------------------------------------------------------------

/**
 * Compiled `.gitignore` matcher. `ignores(relativePath)` returns true
 * when the path should be ignored, taking negation (`!`) rules into
 * account in the same order as the file.
 */
interface GitignoreMatcher {
  ignores(relativePath: string): boolean;
}

/**
 * Look up a `.gitignore` blob at the scope root and compile it into a
 * matcher. Returns `null` when no `.gitignore` is present (HEAD 404).
 */
async function loadGitignoreMatcher(
  blobClient: BlobClient,
  container: string,
  storagePrefix: string,
): Promise<GitignoreMatcher | null> {
  const gitignoreBlob = (storagePrefix || "") + ".gitignore";
  try {
    const blob = await blobClient.getBlobContent(container, gitignoreBlob);
    const text =
      typeof blob.content === "string"
        ? blob.content
        : blob.content.toString("utf-8");
    return compileGitignore(text);
  } catch {
    // Any failure — usually 404 — means there is no .gitignore at the
    // scope root. We deliberately swallow the error per the design's
    // "lazily load" guidance (this is read-only).
    return null;
  }
}

/**
 * Parse a `.gitignore` file body into a {@link GitignoreMatcher} that
 * supports negation (`!`). Rules are evaluated in order; the LAST
 * matching rule wins (standard `.gitignore` semantics).
 */
function compileGitignore(body: string): GitignoreMatcher {
  interface Rule {
    negate: boolean;
    pattern: string;
  }
  const rules: Rule[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    const pattern = negate ? line.slice(1) : line;
    if (!pattern) continue;
    rules.push({ negate, pattern });
  }

  return {
    ignores(relativePath: string): boolean {
      let ignored = false;
      for (const r of rules) {
        if (matchesPattern(relativePath, r.pattern)) {
          ignored = !r.negate;
        }
      }
      return ignored;
    },
  };
}
