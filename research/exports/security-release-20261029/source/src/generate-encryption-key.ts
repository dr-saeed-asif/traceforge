import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const name = "TRACEFORGE_GENERATED_CODE_PRIVATE_KEY";
const path = resolve(".env");
const current = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return "";
  throw error;
});

if (new RegExp(`^${name}=`, "mu").test(current)) {
  process.stdout.write(`${name} already exists in .env\n`);
} else {
  const prefix = current === "" || current.endsWith("\n") ? current : `${current}\n`;
  await writeFile(path, `${prefix}${name}=${randomBytes(32).toString("base64")}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${name} was generated in .env\n`);
}
