import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";

const suite = process.argv[2];
if (suite !== "unit" && suite !== "integration") {
  throw new Error("Expected test suite: unit or integration");
}
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function testFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [path] : [];
  });
}
const files = testFiles(join(apiRoot, suite === "unit" ? "src" : "integration")).sort();
if (!files.length) throw new Error(`No ${suite} test files found`);
console.log(`Running ${suite} suite: ${files.length} test files (explicit cross-platform discovery)`);
// Never rely on shell ** expansion: Bash otherwise only expands one directory
// level, silently omitting app.test.ts and nested module tests from CI.
const result = spawnSync(process.execPath, [
  "--import", "tsx", "--test",
  ...(suite === "integration" ? ["--test-concurrency=1"] : []),
  ...files,
], { cwd: apiRoot, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
