import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(currentDir, "../..");

function findFiles(dir: string, extension: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findFiles(fullPath, extension));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(fullPath);
    }
  }
  return files;
}

test("Architecture: direct customer creation outside customer.repository.ts is prohibited in src", () => {
  const tsFiles = findFiles(srcDir, ".ts");
  const directCustomerInserts: Array<{ file: string; line: number; text: string }> = [];

  for (const file of tsFiles) {
    // Skip test files if any inside src
    if (file.endsWith(".test.ts")) continue;

    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/INSERT\s+INTO\s+customers/i.test(line)) {
        directCustomerInserts.push({
          file: path.relative(srcDir, file).replace(/\\/g, "/"),
          line: i + 1,
          text: line.trim(),
        });
      }
    }
  }

  // Exactly one legitimate location in production code: customer.repository.ts
  const nonCanonicalOccurrences = directCustomerInserts.filter(
    (occ) => occ.file !== "modules/customers/customer.repository.ts",
  );

  assert.deepEqual(
    nonCanonicalOccurrences,
    [],
    `Found unauthorized direct INSERT INTO customers outside customer.repository.ts: ${JSON.stringify(nonCanonicalOccurrences, null, 2)}`,
  );
  assert.equal(
    directCustomerInserts.length,
    1,
    "customer.repository.ts must be the single canonical place for customer creation in src",
  );
});
