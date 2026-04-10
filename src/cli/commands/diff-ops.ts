import * as fs from "fs";
import chalk from "chalk";
import { BlobClient } from "../../core/blob-client.js";
import { diffLink } from "../../core/diff-engine.js";
import { resolveLinks, findLinkByPrefix } from "../../core/sync-engine.js";
import { buildProviderForLink } from "../../core/repo-utils.js";
import type { DiffReport } from "../../core/types.js";
import { resolveStorageEntry, type StorageOpts, type PatOpts } from "./shared.js";

/**
 * Exit code conventions:
 *   0 = All diffed links are in sync (summary.isInSync === true for all)
 *   1 = One or more links have differences (not an error — expected for diff)
 *   2 = Fatal/operational error (no links, auth failure, container not found, ambiguous selection)
 */

// ── Formatting helpers ────────────────────────────────────────────────────────

function shortSha(sha: string | null | undefined): string {
  if (!sha) return "        ";
  return sha.slice(0, 8);
}

function useColor(): boolean {
  return process.stdout.isTTY === true;
}

function colorize(text: string, color: (s: string) => string): string {
  return useColor() ? color(text) : text;
}

function printSeparator(): void {
  console.log(colorize("─".repeat(60), chalk.dim));
}

function formatTableReport(report: DiffReport, showIdentical: boolean): void {
  const { summary } = report;
  const prefix = report.targetPrefix ?? "(root)";

  console.log();
  console.log(colorize(`Diff Report: ${report.repoUrl} (${report.branch}) → container/${prefix}`, chalk.bold));
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Last sync: ${report.lastSyncAt ?? "never"}`);
  console.log(`Provider:  ${report.provider}`);

  if (report.note) {
    console.log();
    console.log(colorize(`⚠  ${report.note}`, chalk.yellow));
  }

  console.log();
  console.log(colorize(" Category          Count", chalk.dim));
  console.log(colorize(" ─────────────────────────────", chalk.dim));
  console.log(` Modified     ${String(summary.modifiedCount).padStart(10)}`);
  console.log(` Repo-only    ${String(summary.repoOnlyCount).padStart(10)}`);
  console.log(` Container-only ${String(summary.containerOnlyCount).padStart(8)}`);
  console.log(` Identical    ${String(summary.identicalCount).padStart(10)}`);
  if (summary.untrackedCount > 0) {
    console.log(` Untracked    ${String(summary.untrackedCount).padStart(10)}`);
  }
  console.log(colorize(" ─────────────────────────────", chalk.dim));
  console.log(` Total        ${String(summary.total).padStart(10)}`);

  if (report.modified.length > 0) {
    console.log();
    console.log(colorize(`MODIFIED (${report.modified.length}):`, chalk.yellow));
    for (const e of report.modified) {
      const line = `  M  ${e.blobPath}  [stored: ${shortSha(e.storedSha)} → remote: ${shortSha(e.remoteSha)}]`;
      console.log(colorize(line, chalk.yellow));
    }
  }

  if (report.repoOnly.length > 0) {
    console.log();
    console.log(colorize(`REPO-ONLY (${report.repoOnly.length}):`, chalk.cyan));
    for (const e of report.repoOnly) {
      let suffix = "";
      if (e.physicallyExists !== undefined) {
        suffix = e.physicallyExists
          ? colorize("  [exists in container but untracked]", chalk.dim)
          : colorize("  [not in container]", chalk.dim);
      }
      console.log(colorize(`  +  ${e.blobPath}`, chalk.cyan) + suffix);
    }
  }

  if (report.containerOnly.length > 0) {
    console.log();
    console.log(colorize(`CONTAINER-ONLY (${report.containerOnly.length}):`, chalk.red));
    for (const e of report.containerOnly) {
      console.log(colorize(`  -  ${e.blobPath}`, chalk.red));
    }
  }

  if (report.untracked.length > 0) {
    console.log();
    console.log(colorize(`UNTRACKED (${report.untracked.length}):`, chalk.magenta));
    for (const e of report.untracked) {
      console.log(colorize(`  ?  ${e.blobPath}`, chalk.magenta));
    }
  }

  if (showIdentical && report.identical.length > 0) {
    console.log();
    console.log(colorize(`IDENTICAL (${report.identical.length}):`, chalk.green));
    for (const e of report.identical) {
      console.log(colorize(`  =  ${e.blobPath}`, chalk.green));
    }
  }

  console.log();
  const summaryLine = [
    `${summary.modifiedCount} modified`,
    `${summary.repoOnlyCount} repo-only`,
    `${summary.containerOnlyCount} container-only`,
    `${summary.identicalCount} identical`,
    ...(summary.untrackedCount > 0 ? [`${summary.untrackedCount} untracked`] : []),
  ].join(", ");
  console.log(`Summary: ${summaryLine}`);

  if (summary.isInSync) {
    console.log(`Status:  ${colorize("IN SYNC", chalk.green)}`);
  } else {
    console.log(`Status:  ${colorize("OUT OF SYNC", chalk.red)}`);
  }
}

function formatSummaryReport(report: DiffReport): void {
  const { summary } = report;
  const prefix = report.targetPrefix ?? "(root)";
  const status = summary.isInSync
    ? colorize("IN SYNC", chalk.green)
    : colorize("OUT OF SYNC", chalk.red);
  const summaryLine = [
    `${summary.modifiedCount} modified`,
    `${summary.repoOnlyCount} repo-only`,
    `${summary.containerOnlyCount} container-only`,
    `${summary.identicalCount} identical`,
  ].join(", ");
  console.log(
    `${prefix} / ${report.provider} / ${report.repoUrl} (${report.branch}) — ${summaryLine} — ${status}`
  );
}

// ── Main command ──────────────────────────────────────────────────────────────

export async function diffContainer(
  container: string,
  storageOpts: StorageOpts,
  patOpts: PatOpts,
  opts: {
    prefix?: string;
    linkId?: string;
    all?: boolean;
    format: "table" | "summary" | "json";
    showIdentical?: boolean;
    physicalCheck?: boolean;
    output?: string;
  }
): Promise<void> {
  const { format, showIdentical = false, physicalCheck = false } = opts;

  const { store, entry } = await resolveStorageEntry(storageOpts);
  const blobClient = new BlobClient(entry);

  // Load links registry
  const registry = await resolveLinks(blobClient, container);
  if (registry.links.length === 0) {
    console.error(`Container '${container}' has no repository links configured.`);
    process.exit(2);
  }

  // Determine which links to diff
  let linksToDiff = registry.links.slice();

  if (opts.all) {
    // Diff all links — linksToSync already = all links
  } else if (opts.linkId) {
    const found = registry.links.find((l) => l.id === opts.linkId);
    if (!found) {
      console.error(`Link with ID '${opts.linkId}' not found in container '${container}'.`);
      process.exit(2);
    }
    linksToDiff = [found];
  } else if (opts.prefix !== undefined) {
    try {
      const found = findLinkByPrefix(registry.links, opts.prefix);
      linksToDiff = [found];
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }
  } else if (registry.links.length === 1) {
    linksToDiff = [registry.links[0]];
  } else {
    console.error(
      `Container '${container}' has ${registry.links.length} links. Specify --prefix, --link-id, or --all.`
    );
    console.error("\nExisting links:");
    for (const l of registry.links) {
      console.error(`  ${l.id.slice(0, 8)}  ${l.provider}  ${l.repoUrl}  prefix: ${l.targetPrefix ?? "(root)"}`);
    }
    process.exit(2);
  }

  const reports: DiffReport[] = [];
  let hasErrors = false;

  for (const link of linksToDiff) {
    // SSH warning
    if (link.provider === "ssh") {
      console.warn(
        "Warning: this link uses SSH. Diff requires cloning the repository which may take a while..."
      );
    }

    // Resolve the inline PAT from patOpts
    const inlinePat = patOpts.pat;
    let resolvedPat: string | undefined = inlinePat;
    if (!resolvedPat && patOpts.tokenName) {
      const stored = store.getToken(patOpts.tokenName);
      if (!stored) {
        console.error(`Token '${patOpts.tokenName}' not found.`);
        process.exit(2);
      }
      resolvedPat = stored.token;
    }

    const result = await buildProviderForLink(store, link, resolvedPat);
    if (result === null) {
      console.error(
        `Error: No ${link.provider} personal access token configured for link '${link.id.slice(0, 8)}'.`
      );
      console.error(`\nTo add a token, run:`);
      console.error(
        `  npx tsx src/cli/index.ts add-token --name <name> --provider ${link.provider} --token <token>`
      );
      console.error(`\nOr provide one inline with --pat <token>`);
      hasErrors = true;
      continue;
    }

    const { provider, cleanup } = result;
    try {
      const report = await diffLink(provider, link, blobClient, container, {
        includePhysicalCheck: physicalCheck,
        showIdentical,
      });
      reports.push(report);
    } finally {
      cleanup?.();
    }
  }

  if (hasErrors && reports.length === 0) {
    process.exit(2);
  }

  // Output based on format
  if (format === "json") {
    const jsonOutput = JSON.stringify(reports, null, 2);
    if (opts.output) {
      fs.writeFileSync(opts.output, jsonOutput, "utf-8");
      // No stdout output when writing to file
    } else {
      console.log(jsonOutput);
    }
  } else if (format === "summary") {
    for (const report of reports) {
      formatSummaryReport(report);
    }
  } else {
    // table (default)
    for (let i = 0; i < reports.length; i++) {
      if (i > 0) {
        console.log();
        printSeparator();
      }
      formatTableReport(reports[i], showIdentical);
    }
  }

  // Determine exit code
  // Exit 0: all in sync; Exit 1: differences found; Exit 2: handled above (errors)
  const allInSync = reports.length > 0 && reports.every((r) => r.summary.isInSync);
  if (allInSync) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}
