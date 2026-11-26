import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login, mailer } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let hardik: Client, priya: Client, krupa: Client;
let tenantId = "", priyaId = "", hardikId = "", krupaId = "", id = "";
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

beforeAll(async () => {
  [hardik, priya, krupa] = await Promise.all(["hardik.mehta", "priya.vaghela", "krupa.joshi"].map((u) => login(`${u}@strats360.com`)));
  const r = Object.fromEntries((await sql`select work_email, id, tenant_id from employees where work_email in ('priya.vaghela@strats360.com','hardik.mehta@strats360.com','krupa.joshi@strats360.com')`).map((x: any) => [x.work_email.split(".")[0], x]));
  [priyaId, hardikId, krupaId, tenantId] = [r.priya.id, r.hardik.id, r.krupa.id, r.priya.tenant_id];
  await sql`delete from one_on_ones where tenant_id = ${tenantId}`;
});
afterAll(async () => {
  await sql`delete from one_on_ones where tenant_id = ${tenantId}`;
  await sql.end();
});

describe("1:1s", () => {
  it("lets a manager book a repeating 1:1 with a report, and emails them", async () => {
    expect((await hardik.post("/ess/one-on-ones", { withEmployeeId: krupaId, scheduledFor: inDays(2) })).status).toBe(400);
    expect((await hardik.post("/ess/one-on-ones", { withEmployeeId: priyaId, scheduledFor: inDays(-3) })).status).toBe(400);
    const before = mailer.sent.length;
    const r = await hardik.post("/ess/one-on-ones", { withEmployeeId: priyaId, scheduledFor: inDays(2), repeat: "weekly", agenda: ["How is the payslip work going?"] });
    expect(r.status).toBe(201);
    id = r.body.id;
    expect(mailer.sent.slice(before).some((m) => m.to === "priya.vaghela@strats360.com" && m.subject.startsWith("1:1 with Hardik Mehta"))).toBe(true);
    const p = (await priya.get("/ess/one-on-ones")).body;
    expect(p.upcoming[0]).toMatchObject({ id, role: "employee", with: { name: "Hardik Mehta" }, repeat: "weekly" });
    expect(p.people[0]).toEqual({ id: hardikId, name: "Hardik Mehta", relation: "manager" });
    expect((await hardik.get("/ess/one-on-ones")).body.people.some((x: any) => x.id === priyaId && x.relation === "report")).toBe(true);
    expect((await krupa.get(`/ess/one-on-ones/${id}`)).status).toBe(404);
  });

  it("keeps each side's private notes private", async () => {
    const m = (await priya.get(`/ess/one-on-ones/${id}`)).body;
    const agenda = [...m.agenda, { id: "p1", text: "I'd like to talk about growth", by: "employee", done: false }];
    await priya.patch(`/ess/one-on-ones/${id}`, { agenda, myNotes: "Ask about the tech lead role" });
    await hardik.patch(`/ess/one-on-ones/${id}`, { myNotes: "She's ready for more scope", sharedNotes: "Agreed to pair on the v2 launch." });
    expect((await priya.get(`/ess/one-on-ones/${id}`)).body).toMatchObject({ myNotes: "Ask about the tech lead role", sharedNotes: "Agreed to pair on the v2 launch." });
    const h = (await hardik.get(`/ess/one-on-ones/${id}`)).body;
    expect(h.myNotes).toBe("She's ready for more scope");
    expect(JSON.stringify(h)).not.toContain("tech lead role");
    expect(h.agenda).toHaveLength(2);
  });

  it("books the next one with what wasn't covered", async () => {
    const m = (await hardik.get(`/ess/one-on-ones/${id}`)).body;
    await hardik.patch(`/ess/one-on-ones/${id}`, {
      agenda: m.agenda.map((a: any, i: number) => ({ ...a, done: i === 0 })),
      actions: [{ id: "a1", text: "Share the v2 plan", owner: "employee", due: null, done: false }, { id: "a2", text: "Book the AWS course", owner: "manager", due: null, done: true }],
    });
    const r = await priya.post(`/ess/one-on-ones/${id}/complete`);
    expect(r.body.nextId).toBeTruthy();
    const next = (await priya.get(`/ess/one-on-ones/${r.body.nextId}`)).body;
    expect(next.agenda.map((a: any) => a.text)).toEqual(["I'd like to talk about growth"]);
    expect(next.actions.map((a: any) => a.text)).toEqual(["Share the v2 plan"]);
    expect(new Date(next.scheduledFor).getTime() - new Date(m.scheduledFor).getTime()).toBe(7 * 86_400_000);
    expect(next.sharedNotes).toBe("");
    expect((await priya.post(`/ess/one-on-ones/${id}/complete`)).status).toBe(400);
    expect((await hardik.post(`/ess/one-on-ones/${r.body.nextId}/cancel`)).status).toBe(200);
    const list = (await priya.get("/ess/one-on-ones")).body;
    expect(list.upcoming).toHaveLength(0);
    expect(list.past.map((x: any) => x.status)).toEqual(["cancelled", "done"]);
  });
});
