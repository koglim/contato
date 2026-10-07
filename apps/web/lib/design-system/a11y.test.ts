import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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
