import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");

describe("responsive layout contracts", () => {
  it("keeps page headers usable on narrow screens", () => {
    const css = readCss("components/page-container.module.css");

    expect(css).toContain("@media (max-width: 40rem)");
  });

  it("provides responsive list, investigation, and table behavior", () => {
    expect(readCss("features/sessions/sessions.module.css")).toContain("@media (max-width: 42rem)");
    expect(readCss("features/session-details/session-details.module.css")).toContain(
      "@media (max-width: 38rem)"
    );
    expect(readCss("components/ui/ui.module.css")).toMatch(
      /\.tableViewport\s*\{[^}]*overflow-x:\s*auto;/su
    );
  });
});

function readCss(relativePath: string): string {
  return readFileSync(join(sourceRoot, relativePath), "utf8");
}
