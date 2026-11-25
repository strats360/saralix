import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASE } from "../src/routes/flags";

// tests run from apps/api
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("release version", () => {
  it("matches package.json and the latest changelog entry", () => {
    expect(RELEASE.version).toBe((JSON.parse(read("package.json")) as { version: string }).version);
    expect(read("../../CHANGELOG.md").match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1]).toBe(RELEASE.version);
  });
});
