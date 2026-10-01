import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(startDir: string): string {
  let cur = startDir;
  while (cur !== path.dirname(cur)) {
    if (fs.existsSync(path.join(cur, "pnpm-workspace.yaml"))) {
      return cur;
    }
    cur = path.dirname(cur);
  }
  return path.resolve(startDir, "../../../../../");
}

const repoRoot = findRepoRoot(currentDir);

export function detectCustomerInserts(content: string): Array<{ line: number; match: string }> {
  const matches: Array<{ line: number; match: string }> = [];
  const regex = /\bINSERT\s+INTO\s+customers\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const line = content.slice(0, match.index).split("\n").length;
    matches.push({ line, match: match[0] });
  }
  return matches;
}

function findProductionSourceFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findProductionSourceFiles(fullPath));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".spec.") &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

function getProductionSourceTrees(root: string): string[] {
  const dirs: string[] = [];
  for (const parent of ["apps", "packages"]) {
    const parentPath = path.join(root, parent);
    if (!fs.existsSync(parentPath)) continue;
    for (const entry of fs.readdirSync(parentPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const srcPath = path.join(parentPath, entry.name, "src");
        if (fs.existsSync(srcPath) && fs.statSync(srcPath).isDirectory()) {
          dirs.push(srcPath);
        }
      }
    }
  }
  return dirs;
}

test("Architecture: detects multiline and whitespace-separated direct customer INSERT queries", () => {
  const multilineSnippet = `
    const query = \`
      INSERT INTO
      customers (id, phone_e164)
      VALUES ($1, $2)
    \`;
  `;
  const extraSpacesSnippet = "INSERT   INTO   customers (phone_e164)";
  const mixedCaseSnippet = "insert\ninto\ncustomers";
  const negativeSnippet = "SELECT * FROM customers WHERE id = $1";

  const multilineMatches = detectCustomerInserts(multilineSnippet);
  assert.equal(multilineMatches.length, 1);
  assert.match(multilineMatches[0]!.match, /INSERT\s+INTO\s+customers/i);

  const extraSpacesMatches = detectCustomerInserts(extraSpacesSnippet);
  assert.equal(extraSpacesMatches.length, 1);

  const mixedCaseMatches = detectCustomerInserts(mixedCaseSnippet);
  assert.equal(mixedCaseMatches.length, 1);

  const negativeMatches = detectCustomerInserts(negativeSnippet);
  assert.equal(negativeMatches.length, 0);
});

test("Architecture: direct customer creation outside customer.repository.ts is prohibited in production code", () => {
  const sourceTrees = getProductionSourceTrees(repoRoot);
  assert.ok(sourceTrees.length > 0, "Must locate production source directories under apps/**/src and packages/**/src");

  const productionFiles = sourceTrees.flatMap(findProductionSourceFiles);
  assert.ok(productionFiles.length > 50, "Must scan production source files");

  const occurrences: Array<{ file: string; line: number; match: string }> = [];

  for (const file of productionFiles) {
    const content = fs.readFileSync(file, "utf8");
    const detected = detectCustomerInserts(content);
    for (const item of detected) {
      occurrences.push({
        file: path.relative(repoRoot, file).replace(/\\/g, "/"),
        line: item.line,
        match: item.match,
      });
    }
  }

  // Exactly one legitimate location in production code: apps/api/src/modules/customers/customer.repository.ts
  const nonCanonicalOccurrences = occurrences.filter(
    (occ) => occ.file !== "apps/api/src/modules/customers/customer.repository.ts",
  );

  assert.deepEqual(
    nonCanonicalOccurrences,
    [],
    `Found unauthorized direct INSERT INTO customers outside customer.repository.ts: ${JSON.stringify(nonCanonicalOccurrences, null, 2)}`,
  );
  assert.equal(
    occurrences.length,
    1,
    "customer.repository.ts must be the single canonical place for customer creation in production code",
  );
  assert.equal(
    occurrences[0]!.file,
    "apps/api/src/modules/customers/customer.repository.ts",
    "Single canonical place must be apps/api/src/modules/customers/customer.repository.ts",
  );
});
