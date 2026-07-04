#!/usr/bin/env node
/**
 * DOM-contract integrity check (plan-014, AC-4).
 *
 * Verifies that every element ID referenced by the renderer scripts
 * (app.js, html-view.js, zip-download-ui.js) resolves against index.html
 * or is created dynamically by those same scripts.
 *
 * Exit 0 — all referenced IDs resolve (prints the resolved count).
 * Exit 1 — one or more referenced IDs are unresolved (prints each one).
 *
 * Zero dependencies; plain Node ESM.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(ROOT, "src", "electron", "public");

const JS_FILES = ["app.js", "html-view.js", "zip-download-ui.js"];
const HTML_FILE = "index.html";

/**
 * IDs that are referenced via patterns this script cannot statically trace.
 * Every entry REQUIRES a justification comment. Keep empty unless proven
 * necessary.
 */
const ALLOWLIST = new Set([
  // (empty)
]);

const read = (name) => readFileSync(join(PUBLIC_DIR, name), "utf8");

// ---------------------------------------------------------------------------
// 1. Collect referenced IDs from the JS files
// ---------------------------------------------------------------------------
const referenced = new Map(); // id -> Set of "file:line"

function addRef(id, file, line) {
  if (!referenced.has(id)) referenced.set(id, new Set());
  referenced.get(id).add(`${file}:${line}`);
}

for (const file of JS_FILES) {
  const src = read(file);
  const lines = src.split("\n");
  lines.forEach((text, i) => {
    const lineNo = i + 1;
    // getElementById("...") / getElementById('...')
    for (const m of text.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)) {
      addRef(m[1], file, lineNo);
    }
    // querySelector / querySelectorAll with a literal starting with '#'
    for (const m of text.matchAll(/querySelector(?:All)?\(\s*["']#([^"']+)["']\s*\)/g)) {
      // Take the leading ID token, strip descendant/attribute/class/pseudo tails
      const id = m[1].split(/[\s.:[>~+]/)[0];
      if (id) addRef(id, file, lineNo);
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Collect defined IDs: static (index.html) + dynamic (JS-created)
// ---------------------------------------------------------------------------
const defined = new Set();

// Static: id="..." in index.html
for (const m of read(HTML_FILE).matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) {
  defined.add(m[1]);
}

for (const file of JS_FILES) {
  const src = read(file);
  // .id = "..."
  for (const m of src.matchAll(/\.id\s*=\s*["']([^"']+)["']/g)) defined.add(m[1]);
  // setAttribute("id", "...")
  for (const m of src.matchAll(/setAttribute\(\s*["']id["']\s*,\s*["']([^"']+)["']\s*\)/g)) {
    defined.add(m[1]);
  }
  // id="..." inside JS string literals / innerHTML templates
  for (const m of src.matchAll(/\bid\s*=\s*\\?["']([^"'\\]+)\\?["']/g)) defined.add(m[1]);
}

// ---------------------------------------------------------------------------
// 3. Report
// ---------------------------------------------------------------------------
const unresolved = [];
for (const [id, sites] of referenced) {
  if (!defined.has(id) && !ALLOWLIST.has(id)) {
    unresolved.push({ id, sites: [...sites] });
  }
}

if (unresolved.length > 0) {
  console.error(`DOM contract check FAILED — ${unresolved.length} unresolved ID(s):\n`);
  for (const { id, sites } of unresolved.sort((a, b) => a.id.localeCompare(b.id))) {
    console.error(`  #${id}`);
    for (const site of sites) console.error(`      referenced at ${site}`);
  }
  process.exit(1);
}

console.log(
  `DOM contract check passed — ${referenced.size} referenced ID(s) all resolve ` +
    `(${defined.size} defined: static + dynamic).`
);
process.exit(0);
