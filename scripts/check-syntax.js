#!/usr/bin/env node
/**
 * Syntax-check every top-level src/*.js file with `node --check`.
 * Replaces the Unix-only shell loop so `pnpm check` works under cmd.exe.
 * Stops on the first failure. Does not include src/vendor/.
 */
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");
const entries = await readdir(srcDir);
const files = entries
  .filter((name) => name.endsWith(".js"))
  .sort()
  .map((name) => path.join(srcDir, name));

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    process.exit(result.status === null ? 1 : result.status);
  }
}
