import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client, nisha: Client, platform: Client, priya: Client;
let tenantId = "";
// a month no other test or seeded invoice uses
const PERIOD = "2026-02";

beforeAll(async () => {
  [kunal, nisha, platform, priya] = await Promise.all([login("kunal.shah@strats360.com"), login("nisha.trivedi@strats360.com"), login("platform@saralix.com"), login("priya.vaghela@strats360.com")]);
  [{ id: tenantId }] = (await sql`select id from tenants where code = 'TN-0142'`) as any;
  await sql`update tenants set status = 'active' where id = ${tenantId}`;
  await sql`delete from tenant_addons where tenant_id = ${tenantId}`;
  await sql`update addons set active = true`;
  await sql`delete from invoices where tenant_id = ${tenantId} and period = ${PERIOD}`;
});
afterAll(async () => {
  await sql`delete from tenant_addons where tenant_id = ${tenantId}`;
  await sql`delete from invoices where tenant_id = ${tenantId} and period = ${PERIOD}`;
  await sql`update addons set price = 30 where key = 'addon.ai_assistant'`;
  await sql`update addons set active = false`;
  await sql.end();
});
const features = async (c: Client) => (await c.get("/me")).body.memberships[0].features;

describe("Paid add-ons", () => {
  it("hides add-ons that aren't on sale", async () => {
    await sql`update addons set active = false`;
    expect((await kunal.get("/admin/billing/addons")).body.addons).toEqual([]);
    expect((await kunal.post("/admin/billing/addons/addon.ai_assistant", { on: true })).status).toBe(400);
    await sql`update addons set active = true`;
  });

  it("are off until the company switches one on", async () => {
    const r = (await kunal.get("/admin/billing/addons")).body;
    expect(r.addons.map((a: any) => a.key)).toEqual(["addon.ai_assistant", "addon.work_tools", "addon.face_kiosk", "addon.workflows"]);
    expect(r.addons.every((a: any) => !a.on)).toBe(true);
    expect(r.addons[0].monthly).toBe(r.seats * 30);
    expect((await features(priya))["addon.ai_assistant"]).toBe(false);
    expect((await priya.post("/admin/billing/addons/addon.ai_assistant", { on: true })).status).toBe(403);
    expect((await kunal.post("/admin/billing/addons/addon.ai_assistant", { on: true })).body.changed).toBe(true);
    expect((await kunal.post("/admin/billing/addons/addon.ai_assistant", { on: true })).body.changed).toBe(false);
    expect((await features(priya))["addon.ai_assistant"]).toBe(true);
    expect((await kunal.get("/admin/billing/addons")).body.addons[0]).toMatchObject({ on: true });
  });

  it("adds a line per add-on to the invoice", async () => {
    // switched on during the period, so the period is billed
    await sql`update tenant_addons set started_at = ${`${PERIOD}-10T00:00:00Z`} where tenant_id = ${tenantId}`;
    await platform.post(`/platform/billing/tenants/${tenantId}/addons/addon.face_kiosk`, { on: true });
    await sql`update tenant_addons set started_at = ${`${PERIOD}-15T00:00:00Z`} where tenant_id = ${tenantId} and addon_key = 'addon.face_kiosk'`;
    const d = (await platform.post("/platform/billing/run/preview", { period: PERIOD })).body.drafts.find((x: any) => x.tenantCode === "TN-0142");
    expect(d.addons.map((a: any) => [a.key, a.amount])).toEqual([["addon.ai_assistant", d.seats * 30], ["addon.face_kiosk", 999]]);
    expect(d.subtotal).toBe(d.planAmount + d.seats * 30 + 999);
    const run = await platform.post("/platform/billing/run", { period: PERIOD, tenantIds: [tenantId] });
    expect(run.status).toBe(201);
    const [inv] = (await sql`select lines, subtotal from invoices where tenant_id = ${tenantId} and period = ${PERIOD}`) as any;
    expect(inv.lines).toHaveLength(3);
    expect(inv.lines[2]).toMatchObject({ quantity: 1, rate: 999, amount: 999 });
    expect(inv.lines[1].description).toMatch(/^AI assistant add-on/);
  });

  it("lets the platform team change prices, and stops billing once switched off", async () => {
    expect((await kunal.req("PUT", "/platform/billing/addons/addon.ai_assistant", { name: "AI assistant", pricing: "per_employee", price: 25 })).status).toBe(403);
    expect((await platform.req("PUT", "/platform/billing/addons/addon.ai_assistant", { name: "AI assistant", pricing: "per_employee", price: 25, active: false })).status).toBe(200);
    expect((await platform.get("/platform/billing/addons")).body.find((a: any) => a.key === "addon.ai_assistant")).toMatchObject({ price: 25, companies: 1, active: false });
    // not on sale: nobody new can switch it on, but those who have it keep it
    expect((await kunal.post("/admin/billing/addons/addon.workflows", { on: true })).status).toBe(200);
    expect((await kunal.post("/admin/billing/addons/addon.ai_assistant", { on: false })).body.changed).toBe(true);
    expect((await kunal.post("/admin/billing/addons/addon.ai_assistant", { on: true })).status).toBe(400);
    expect((await features(priya))["addon.ai_assistant"]).toBe(false);
    const hist = (await platform.get(`/platform/billing/tenants/${tenantId}/addons`)).body;
    expect(hist.find((h: any) => h.addonKey === "addon.ai_assistant").endedAt).toBeTruthy();
  });
});
