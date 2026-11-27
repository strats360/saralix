import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login, mailer } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let nisha: Client, priya: Client, hardik: Client, krupa: Client;
let tenantId = "", formId = "", kunalId = "", reqId = "";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);

beforeAll(async () => {
  [nisha, priya, hardik, krupa] = await Promise.all(["nisha.trivedi", "priya.vaghela", "hardik.mehta", "krupa.joshi"].map((u) => login(`${u}@strats360.com`)));
  [{ tenant_id: tenantId }] = (await sql`select tenant_id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  [{ id: kunalId }] = (await sql`select id from employees where work_email = 'kunal.shah@strats360.com'`) as any;
  await sql`delete from forms where tenant_id = ${tenantId}`;
  await sql`delete from tenant_addons where tenant_id = ${tenantId}`;
});
afterAll(async () => {
  await sql`delete from forms where tenant_id = ${tenantId}`;
  await sql`delete from tenant_addons where tenant_id = ${tenantId}`;
  await sql.end();
});

const FORM = {
  title: "Laptop request",
  description: "Ask for a new or replacement laptop.",
  fields: [
    { id: "kind", label: "What do you need", type: "select", required: true, options: ["New laptop", "Replacement"] },
    { id: "why", label: "Why", type: "textarea", required: true },
    { id: "budget", label: "Budget", type: "number" },
    { id: "quote", label: "Quote", type: "file" },
  ],
  steps: [] as { id: string; kind: string; employeeId?: string }[],
};

function submit(c: Client, answers: Record<string, unknown>, file = false) {
  const fd = new FormData();
  fd.append("answers", JSON.stringify(answers));
  if (file) fd.append("file:quote", new File([PDF], "quote.pdf", { type: "application/pdf" }));
  return c.req("POST", `/ess/forms/form/${formId}`, fd);
}

describe("Forms and workflows", () => {
  it("is off until the company has the add-on", async () => {
    expect((await nisha.get("/admin/forms")).status).toBe(403);
    await sql`insert into tenant_addons (id, tenant_id, addon_key) values (gen_random_uuid()::text, ${tenantId}, 'addon.workflows')`;
    expect((await nisha.get("/admin/forms")).status).toBe(200);
  });

  it("lets HR build and publish a form with approval steps", async () => {
    expect((await priya.post("/admin/forms", FORM)).status).toBe(403);
    expect((await nisha.post("/admin/forms", { ...FORM, steps: [{ id: "s", kind: "person" }] })).status).toBe(422);
    const r = await nisha.post("/admin/forms", { ...FORM, steps: [{ id: "s1", kind: "manager" }, { id: "s2", kind: "person", employeeId: kunalId }, { id: "s3", kind: "hr" }] });
    expect(r.status).toBe(201);
    formId = r.body.id;
    expect((await priya.get("/ess/forms")).body.forms).toEqual([]);
    await nisha.post(`/admin/forms/${formId}/publish`);
    expect((await priya.get("/ess/forms")).body.forms.map((f: any) => f.id)).toContain(formId);
  });

  it("checks answers and sends the request to the manager", async () => {
    const bad = await submit(priya, { kind: "Tablet" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.details.fields).sort()).toEqual(["kind", "why"]);
    const before = mailer.sent.length;
    const r = await submit(priya, { kind: "Replacement", why: "Battery lasts 20 minutes", budget: "85,000" }, true);
    expect(r.status).toBe(201);
    reqId = r.body.id;
    expect(r.body.status).toBe("pending");
    expect(mailer.sent.slice(before).some((m) => m.to === "hardik.mehta@strats360.com" && m.subject === "Laptop request from Priya Vaghela")).toBe(true);
    const mine = (await priya.get(`/ess/forms/requests/${reqId}`)).body;
    expect(mine).toMatchObject({ status: "pending", stepIndex: 0, approver: { name: "Hardik Mehta" }, answers: { budget: 85000 }, files: { quote: { name: "quote.pdf" } } });
    expect((await krupa.get(`/ess/forms/requests/${reqId}`)).status).toBe(404);
  });

  it("walks the steps: manager, then a named person, then HR", async () => {
    expect((await krupa.post(`/ess/forms/requests/${reqId}/decision`, { decision: "approve" })).status).toBe(404);
    expect((await hardik.get("/ess/forms/approvals")).body.waiting.map((x: any) => x.id)).toContain(reqId);
    expect((await hardik.get(`/ess/forms/requests/${reqId}/files/quote`)).status).toBe(200);
    expect((await hardik.post(`/ess/forms/requests/${reqId}/decision`, { decision: "reject" })).status).toBe(422);
    const a = (await hardik.post(`/ess/forms/requests/${reqId}/decision`, { decision: "approve" })).body;
    expect(a).toMatchObject({ status: "pending", stepIndex: 1, approver: { id: kunalId } });
    // HR can't jump in before its own step
    expect((await nisha.post(`/admin/forms/requests/${reqId}/decision`, { decision: "approve" })).status).toBe(403);
    const kunal = await login("kunal.shah@strats360.com");
    await kunal.post(`/ess/forms/requests/${reqId}/decision`, { decision: "approve", note: "Fine by finance" });
    expect((await nisha.get("/admin/forms/requests?queue=1")).body.map((x: any) => x.id)).toContain(reqId);
    const before = mailer.sent.length;
    const done = (await nisha.post(`/admin/forms/requests/${reqId}/decision`, { decision: "approve" })).body;
    expect(done.status).toBe("approved");
    expect(done.history.map((h: any) => h.decision)).toEqual(["approve", "approve", "approve"]);
    expect(mailer.sent.slice(before).some((m) => m.to === "priya.vaghela@strats360.com" && m.subject === "Laptop request approved")).toBe(true);
    // the manager can still see what they decided
    expect((await hardik.get("/ess/forms/approvals")).body.decided.map((x: any) => x.id)).toContain(reqId);
  });

  it("lets people withdraw, records rejections, and exports", async () => {
    const r = (await submit(priya, { kind: "New laptop", why: "Joining the design team" })).body;
    await hardik.post(`/ess/forms/requests/${r.id}/decision`, { decision: "reject", note: "Use the spare one in the office" });
    expect((await priya.get(`/ess/forms/requests/${r.id}`)).body.status).toBe("rejected");
    expect((await priya.post(`/ess/forms/requests/${r.id}/withdraw`)).status).toBe(409);
    const w = (await submit(priya, { kind: "New laptop", why: "Second try" })).body;
    expect((await priya.post(`/ess/forms/requests/${w.id}/withdraw`)).status).toBe(200);
    const csv = await nisha.get(`/admin/forms/${formId}/export`);
    expect(String(csv.body)).toContain("Battery lasts 20 minutes");
    expect((await nisha.del(`/admin/forms/${formId}`)).status).toBe(409);
  });

  it("approves straight away when no step applies", async () => {
    const f = (await nisha.post("/admin/forms", { title: "Desk move", fields: [{ id: "x", label: "Where to", type: "text", required: true }], steps: [{ id: "s", kind: "manager" }] })).body;
    await nisha.post(`/admin/forms/${f.id}/publish`);
    // Kunal has no manager, so the only step is skipped
    const kunal = await login("kunal.shah@strats360.com");
    const fd = new FormData();
    fd.append("answers", JSON.stringify({ x: "Second floor" }));
    const r = await kunal.req("POST", `/ess/forms/form/${f.id}`, fd);
    expect(r.body.status).toBe("approved");
  });
});
