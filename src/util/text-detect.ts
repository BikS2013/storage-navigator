// Detect whether a file is "text-like" — safe to load into a textarea and
// edit in place. Layered check so we don't trust extension alone:
//
//   1. Allowlist of obvious text extensions / well-known basenames.
//   2. If the name doesn't match, sniff the first 8 KiB of bytes:
//      - any NUL byte → binary.
//      - >=95% of the bytes must be printable ASCII, common whitespace,
//        or valid leading UTF-8 multibyte sequences → text.
//   3. Size cap (DEFAULT_MAX_EDIT_BYTES) — refuse to edit files larger
//      than the threshold even if they're textual.
//
// All three checks are exported so the API server can decide editability
// without re-deriving the rules in the renderer.

/** 2 MiB. Anything above this is refused for in-place editing. */
export const DEFAULT_MAX_EDIT_BYTES = 2 * 1024 * 1024;

/** First N bytes inspected when sniffing for binary content. */
export const SNIFF_BYTES = 8 * 1024;

const TEXT_EXTENSIONS = new Set<string>([
  'txt', 'md', 'markdown', 'rst', 'log', 'csv', 'tsv',
  'json', 'json5', 'jsonl', 'ndjson',
  'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env', 'properties',
  'xml', 'svg', 'html', 'htm', 'xhtml',
  'css', 'scss', 'sass', 'less',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
  'py', 'rb', 'php', 'pl', 'pm', 'lua',
  'go', 'rs', 'swift', 'kt', 'kts', 'scala', 'clj', 'cljs', 'cljc',
  'java', 'groovy',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx', 'm', 'mm',
  'sh', 'bash', 'zsh', 'fish', 'ksh',
  'sql', 'graphql', 'gql', 'proto', 'thrift',
  'tf', 'tfvars', 'hcl', 'bicep',
  'ps1', 'psm1', 'bat', 'cmd',
  'r', 'jl', 'erl', 'ex', 'exs', 'fs', 'fsx',
  'gitignore', 'gitattributes', 'editorconfig', 'dockerignore', 'npmignore',
  'patch', 'diff',
]);

// Match these as exact basenames (case-insensitive). These are files
// users routinely want to edit but that carry no extension.
const TEXT_BASENAMES = new Set<string>([
  'dockerfile',
  'makefile',
  'license',
  'readme',
  'changelog',
  'contributing',
  'authors',
  'notice',
  'procfile',
  'rakefile',
  'gemfile',
  'pipfile',
  'vagrantfile',
  '.env',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.dockerignore',
  '.npmignore',
  '.npmrc',
  '.yarnrc',
  '.eslintrc',
  '.prettierrc',
  '.babelrc',
]);

/**
 * Returns true when the file's name alone is enough to call it text — the
 * extension is in the allowlist or the basename is a well-known no-extension
 * text file (Dockerfile, Makefile, .env, etc.).
 */
export function isTextByName(name: string): boolean {
  const base = basenameOf(name).toLowerCase();
  if (TEXT_BASENAMES.has(base)) return true;

  // Dotfiles like `.env.local` — strip trailing components until we hit one
  // we recognise. Matches `.env`, `.eslintrc.json`, etc.
  if (base.startsWith('.')) {
    for (const known of TEXT_BASENAMES) {
      if (known.startsWith('.') && (base === known || base.startsWith(known + '.'))) {
        return true;
      }
    }
  }

  const ext = extensionOf(base);
  if (!ext) return false;
  return TEXT_EXTENSIONS.has(ext);
}

/**
 * Content-based sniff. Inspect at most SNIFF_BYTES and decide whether the
 * payload looks like text. Returns true for empty buffers — an empty file
 * is editable by definition.
 */
export function looksLikeText(bytes: Uint8Array | Buffer): boolean {
  const len = Math.min(bytes.length, SNIFF_BYTES);
  if (len === 0) return true;

  let printable = 0;
  for (let i = 0; i < len; i++) {
    const b = bytes[i] as number;
    if (b === 0) return false; // NUL → binary
    if (b === 0x09 || b === 0x0a || b === 0x0d) { printable++; continue; } // tab/LF/CR
    if (b >= 0x20 && b < 0x7f) { printable++; continue; } // ASCII printable
    if (b >= 0x80) { printable++; continue; } // tolerate UTF-8 continuation / non-ASCII
    // 0x01-0x08, 0x0b-0x0c, 0x0e-0x1f, 0x7f → control characters, not counted
  }
  return printable / len >= 0.95;
}

export type Editability = {
  editable: boolean;
  reason: 'ok' | 'binary' | 'too-large' | 'unknown';
  maxBytes: number;
};

/**
 * Composite decision used by the API: combines size cap, name allowlist,
 * and content sniff. `bytes` is optional — when omitted the decision falls
 * back to name-only (used when the caller already streamed past the body).
 */
export function detectEditability(
  name: string,
  size: number | undefined,
  bytes: Uint8Array | Buffer | undefined,
  maxBytes: number = DEFAULT_MAX_EDIT_BYTES,
): Editability {
  if (size !== undefined && size > maxBytes) {
    return { editable: false, reason: 'too-large', maxBytes };
  }
  if (bytes && bytes.length > maxBytes) {
    return { editable: false, reason: 'too-large', maxBytes };
  }
  if (isTextByName(name)) {
    // Even if the extension is known, refuse if the bytes scream binary —
    // catches e.g. a corrupted .json with embedded NULs.
    if (bytes && !looksLikeText(bytes)) {
      return { editable: false, reason: 'binary', maxBytes };
    }
    return { editable: true, reason: 'ok', maxBytes };
  }
  if (!bytes) {
    return { editable: false, reason: 'unknown', maxBytes };
  }
  return looksLikeText(bytes)
    ? { editable: true, reason: 'ok', maxBytes }
    : { editable: false, reason: 'binary', maxBytes };
}

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

function extensionOf(base: string): string | undefined {
  // Treat leading-dot files (".env") as basename matches handled above.
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return undefined;
  return base.slice(dot + 1);
}
