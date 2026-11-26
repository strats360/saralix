import { describe, expect, it } from "vitest";
import { fmtKr, krProgress, objectiveProgress, objectiveSchema, periodChoices, periodOf, periodRange } from "../src/okrs";

describe("OKR periods", () => {
  it("names Indian financial year quarters", () => {
    expect(periodOf("2026-04-01")).toBe("FY2026-27 Q1");
    expect(periodOf("2026-11-26")).toBe("FY2026-27 Q3");
    expect(periodOf("2027-02-10")).toBe("FY2026-27 Q4");
    expect(periodOf("2027-03-31", false)).toBe("FY2026-27");
    expect(periodOf("2099-09-30")).toBe("FY2099-00 Q2");
  });
  it("turns a period into dates", () => {
    expect(periodRange("FY2026-27 Q1")).toEqual({ start: "2026-04-01", end: "2026-06-30" });
    expect(periodRange("FY2026-27 Q3")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(periodRange("FY2026-27 Q4")).toEqual({ start: "2027-01-01", end: "2027-03-31" });
    expect(periodRange("FY2027-28 Q4")).toEqual({ start: "2028-01-01", end: "2028-03-31" });
    expect(periodRange("FY2026-27")).toEqual({ start: "2026-04-01", end: "2027-03-31" });
    expect(periodChoices("2026-11-26").slice(0, 3)).toEqual(["FY2026-27", "FY2026-27 Q1", "FY2026-27 Q2"]);
  });
});

describe("OKR progress", () => {
  it("measures up and down targets and clamps", () => {
    expect(krProgress({ kind: "number", start: 0, target: 40, current: 10 })).toBe(25);
    expect(krProgress({ kind: "percent", start: 20, target: 5, current: 12.5 })).toBe(50);
    expect(krProgress({ kind: "number", start: 0, target: 10, current: 15 })).toBe(100);
    expect(krProgress({ kind: "number", start: 10, target: 20, current: 5 })).toBe(0);
    expect(krProgress({ kind: "done", start: 0, target: 1, current: 1 })).toBe(100);
    expect(objectiveProgress([{ kind: "number", start: 0, target: 4, current: 1 }, { kind: "done", start: 0, target: 1, current: 1 }])).toBe(63);
    expect(objectiveProgress([])).toBe(0);
  });
  it("formats values", () => {
    expect(fmtKr("currency", 1250000)).toBe("₹12.5 L");
    expect(fmtKr("currency", 32000000)).toBe("₹3.2 Cr");
    expect(fmtKr("percent", 42.25)).toBe("42.3%");
    expect(fmtKr("number", 1800, "users")).toBe("1,800 users");
    expect(fmtKr("done", 0)).toBe("Not done");
  });
  it("validates objectives", () => {
    const kr = { title: "Close 40 new customers", target: 40 };
    expect(objectiveSchema.safeParse({ level: "company", title: "Grow revenue", period: "FY2026-27 Q3", keyResults: [kr] }).success).toBe(true);
    expect(objectiveSchema.safeParse({ level: "team", title: "Grow revenue", period: "FY2026-27 Q3", keyResults: [kr] }).success).toBe(false);
    expect(objectiveSchema.safeParse({ level: "company", title: "Grow revenue", period: "2026 Q3", keyResults: [kr] }).success).toBe(false);
    expect(objectiveSchema.safeParse({ level: "company", title: "Grow revenue", period: "FY2026-27", keyResults: [{ ...kr, target: 0 }] }).success).toBe(false);
  });
});
