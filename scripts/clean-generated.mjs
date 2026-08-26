import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const generatedDirectoryNames = new Set(["dist", ".vinext", ".next", "coverage"]);

async function clean(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".git", ".traceforge", "opencode-activity-captures"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory() && generatedDirectoryNames.has(entry.name)) {
      await rm(path, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory()) await clean(path);
    else if (entry.name.endsWith(".tsbuildinfo")) await rm(path, { force: true });
  }
}

await clean(root);
