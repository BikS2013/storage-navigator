#!/usr/bin/env node

import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const entryPoint = join(__dirname, "..", "src", "cli", "index.ts");
const projectDir = join(__dirname, "..");

// Run the TypeScript entry point via tsx, keeping the process alive
const child = spawn("npx", ["tsx", entryPoint, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: projectDir,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
