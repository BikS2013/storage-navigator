import { BlobClient } from "../src/core/blob-client.js";
import { CredentialStore } from "../src/core/credential-store.js";

const store = new CredentialStore();
const entry = store.getStorage("corporateloans");
if (!entry) { console.error("Storage not found"); process.exit(1); }
const client = new BlobClient(entry);

async function listAll(container: string): Promise<string[]> {
  const items = await client.listBlobsFlat(container);
  return items.map(i => i.name).sort();
}

async function main() {
  const [prompts, promptsv2] = await Promise.all([listAll("prompts"), listAll("promptsv2")]);

  const promptsSet = new Set(prompts);
  const v2Set = new Set(promptsv2);

  const onlyInPrompts = prompts.filter(f => !v2Set.has(f));
  const onlyInV2 = promptsv2.filter(f => !promptsSet.has(f));
  const common = prompts.filter(f => v2Set.has(f));

  console.log("=== prompts: " + prompts.length + " files | promptsv2: " + promptsv2.length + " files ===\n");
  console.log("Common files: " + common.length);
  console.log("Only in prompts: " + onlyInPrompts.length);
  console.log("Only in promptsv2: " + onlyInV2.length);

  if (onlyInPrompts.length > 0) {
    console.log("\n--- Only in 'prompts' ---");
    for (const f of onlyInPrompts) console.log("  " + f);
  }
  if (onlyInV2.length > 0) {
    console.log("\n--- Only in 'promptsv2' ---");
    for (const f of onlyInV2) console.log("  " + f);
  }
}
main();
