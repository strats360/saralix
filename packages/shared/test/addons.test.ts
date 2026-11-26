import { describe, expect, it } from "vitest";
import { addonBilledIn, addonCharge } from "../src/addons";
import { evaluateFlags } from "../src/flags";

const t = { id: "t1", plan: "growth" };
describe("add-ons", () => {
  it("are off unless switched on, and a flag can grant them", () => {
    expect(evaluateFlags([], t)["addon.ai_assistant"]).toBe(false);
    expect(evaluateFlags([], t, ["addon.ai_assistant"])["addon.ai_assistant"]).toBe(true);
    const pilot = { key: "addon.face_kiosk", enabled: true, rollout: "tenants", plans: [], tenantIds: ["t1"], excludedTenantIds: [], percent: 0 };
    expect(evaluateFlags([pilot], t)["addon.face_kiosk"]).toBe(true);
    expect(evaluateFlags([pilot], { id: "t2", plan: "growth" })["addon.face_kiosk"]).toBe(false);
    expect(evaluateFlags([pilot], { id: "t2", plan: "growth" }, ["addon.face_kiosk"])["addon.face_kiosk"]).toBe(true);
    expect(evaluateFlags([], t)["module.tds"]).toBe(true);
  });
  it("charges per employee or flat", () => {
    expect(addonCharge({ pricing: "per_employee", price: 30 }, 120)).toBe(3600);
    expect(addonCharge({ pricing: "flat", price: 999 }, 120)).toBe(999);
  });
  it("bills a month the add-on was on at any point", () => {
    expect(addonBilledIn({ startedAt: "2026-11-20T00:00:00Z", endedAt: null }, "2026-11")).toBe(true);
    expect(addonBilledIn({ startedAt: "2026-12-02T00:00:00Z", endedAt: null }, "2026-11")).toBe(false);
    expect(addonBilledIn({ startedAt: "2026-09-01T00:00:00Z", endedAt: "2026-10-31T00:00:00Z" }, "2026-11")).toBe(false);
    expect(addonBilledIn({ startedAt: "2026-09-01T00:00:00Z", endedAt: "2026-11-03T00:00:00Z" }, "2026-11")).toBe(true);
  });
});
