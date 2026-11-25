import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RELEASE } from "../src/routes/flags";

describe("release version", () => {
  it("matches package.json and the latest changelog entry", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { version: string };
    const changelog = readFileSync(fileURLToPath(new URL("../../../CHANGELOG.md", import.meta.url)), "utf8");
    expect(RELEASE.version).toBe(pkg.version);
    expect(changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1]).toBe(RELEASE.version);
  });
});
