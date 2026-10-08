import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const webRoot = process.cwd().endsWith("web") ? process.cwd() : join(process.cwd(), "apps", "web");
const read = (relPath: string) => readFileSync(join(webRoot, relPath), "utf8");

test("Storybook: @storybook/addon-a11y is configured with test: 'error' baseline gate", () => {
  const preview = read(".storybook/preview.tsx");
  assert.match(preview, /a11y:\s*\{\s*test:\s*["']error["']/);

  const main = read(".storybook/main.ts");
  assert.match(main, /@storybook\/addon-a11y/);
});

test("Storybook: static build includes a11y addon manager bundle and story manifest", (t) => {
  const staticDir = join(webRoot, "storybook-static");
  if (!existsSync(staticDir)) {
    t.skip("storybook-static not built yet; verified by test:storybook script");
    return;
  }

  const indexHtml = read("storybook-static/index.html");
  assert.match(indexHtml, /sb-addons/);

  const indexJsonRaw = read("storybook-static/index.json");
  const indexJson = JSON.parse(indexJsonRaw);
  assert.ok(Object.keys(indexJson.entries).length >= 50, "Storybook catalog must cover all foundational stories");
});

test("a11y static contract: Button component enforces type='button' and accessible loading states", () => {
  const buttonSource = read("design-system/components/Button/Button.tsx");
  assert.match(buttonSource, /type="button"/);
  assert.match(buttonSource, /aria-busy=\{loading \? "true" : undefined\}/);
});

test("a11y static contract: IconButton component enforces strictly mandatory aria-label", () => {
  const iconButtonSource = read("design-system/components/IconButton/IconButton.tsx");
  assert.match(iconButtonSource, /"aria-label": string/);
  assert.match(iconButtonSource, /aria-label=\{ariaLabel\}/);
});

test("a11y static contract: Input and Textarea associate label and aria-describedby for errors", () => {
  const inputSource = read("design-system/components/Input/Input.tsx");
  assert.match(inputSource, /htmlFor=\{id\}/);
  assert.match(inputSource, /aria-invalid=\{hasError \? "true" : undefined\}/);
  assert.match(inputSource, /aria-describedby=\{describedBy\}/);
  assert.match(inputSource, /role="alert"/);

  const textareaSource = read("design-system/components/Textarea/Textarea.tsx");
  assert.match(textareaSource, /htmlFor=\{id\}/);
  assert.match(textareaSource, /aria-invalid=\{hasError \? "true" : undefined\}/);
  assert.match(textareaSource, /aria-describedby=\{describedBy\}/);
  assert.match(textareaSource, /role="alert"/);
});

test("a11y static contract: Spinner and Skeleton provide accessible role and screen-reader support", () => {
  const spinnerSource = read("design-system/components/Spinner/Spinner.tsx");
  assert.match(spinnerSource, /role="status"/);
  assert.match(spinnerSource, /aria-label=\{label\}/);
  assert.match(spinnerSource, /cc-sr-only/);

  const skeletonSource = read("design-system/components/Skeleton/Skeleton.tsx");
  assert.match(skeletonSource, /aria-hidden="true"/);
});

test("a11y static contract: Pagination and Table enforce semantic landmark and scoping", () => {
  const paginationSource = read("design-system/components/Pagination/Pagination.tsx");
  assert.match(paginationSource, /<nav/);
  assert.match(paginationSource, /aria-label="Navegação entre páginas"/);
  assert.match(paginationSource, /aria-label="Página anterior"/);
  assert.match(paginationSource, /aria-label="Próxima página"/);

  const tableSource = read("design-system/components/Table/Table.tsx");
  assert.match(tableSource, /<table/);
  assert.match(tableSource, /<thead/);
  assert.match(tableSource, /<tbody/);
  assert.match(tableSource, /scope="col"/);
});

test("a11y static contract: AppShell implements skip-link, main landmark and navigation semantics", () => {
  const appShellSource = read("design-system/shell/AppShell/AppShell.tsx");
  assert.match(appShellSource, /href="#main-content"/);
  assert.match(appShellSource, /id="main-content"/);
  assert.match(appShellSource, /tabIndex=\{-1\}/);
  assert.match(appShellSource, /aria-label=\{isCollapsed \? "Expandir barra lateral" : "Recolher barra lateral"\}/);

  const sidebarSource = read("design-system/shell/Sidebar/Sidebar.tsx");
  assert.match(sidebarSource, /aria-label="Navegação principal"/);
  assert.match(sidebarSource, /aria-current=\{item\.active \? "page" : undefined\}/);
  assert.match(sidebarSource, /<Link/);

  const mobileNavSource = read("design-system/shell/MobileNavigationDrawer/MobileNavigationDrawer.tsx");
  assert.match(mobileNavSource, /aria-label="Navegação móvel"/);
  assert.match(mobileNavSource, /aria-current=\{item\.active \? "page" : undefined\}/);
});

test("a11y static contract: AccountMenu enforces accessible button and interactive state", () => {
  const accountMenuSource = read("design-system/shell/AccountMenu/AccountMenu.tsx");
  assert.match(accountMenuSource, /Menu da conta de \$\{name\}/);
});

test("a11y static contract: ErrorState component supports headingLevel prop for page-level error states", () => {
  const errorStateSource = read("design-system/components/ErrorState/ErrorState.tsx");
  assert.match(errorStateSource, /headingLevel\?:\s*1\s*\|\s*2\s*\|\s*3/);
  assert.match(errorStateSource, /headingLevel\s*===\s*1\s*\?\s*"h1"/);

  const dashboardErrorSource = read("app/dashboard/error.tsx");
  assert.match(dashboardErrorSource, /headingLevel=\{1\}/);
});

test("design system token integrity: dashboard views reference only canonical --cc-* tokens", () => {
  const tokenFiles = ["motion.css", "primitives.css", "semantic.css", "spacing.css", "typography.css"];
  const canonicalTokens = new Set<string>();

  for (const file of tokenFiles) {
    const content = read(`design-system/tokens/${file}`);
    const defined = content.match(/--cc-[a-zA-Z0-9_-]+/g) || [];
    for (const token of defined) {
      canonicalTokens.add(token);
    }
  }

  function scanDir(relDir: string): string[] {
    const fullDir = join(webRoot, relDir);
    if (!existsSync(fullDir)) return [];
    const results: string[] = [];
    const entries = readdirSync(fullDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryRel = join(relDir, entry.name);
      if (entry.isDirectory()) {
        results.push(...scanDir(entryRel));
      } else if (entry.isFile() && (entry.name.endsWith(".tsx") || entry.name.endsWith(".css") || entry.name.endsWith(".ts"))) {
        results.push(entryRel);
      }
    }
    return results;
  }

  const scannedFiles = [...scanDir("components/dashboard"), ...scanDir("app/dashboard")];
  const unknownTokens: Array<{ file: string; token: string }> = [];

  for (const relFile of scannedFiles) {
    const fileContent = read(relFile);
    const usages = fileContent.match(/var\((--cc-[a-zA-Z0-9_-]+)/g) || [];
    for (const usage of usages) {
      const token = usage.replace(/^var\(/, "");
      if (!canonicalTokens.has(token)) {
        unknownTokens.push({ file: relFile, token });
      }
    }
  }

  assert.equal(
    unknownTokens.length,
    0,
    `Found unknown --cc-* design tokens: ${JSON.stringify(unknownTokens)}`
  );
});
