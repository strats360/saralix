import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { periodOf, todayLocal } from "@hrms/shared";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let nisha: Client, hardik: Client, priya: Client, ravi: Client;
let tenantId = "", deptId = "", priyaId = "", hardikId = "", companyId = "", teamId = "", mineId = "";
const period = periodOf(todayLocal());

beforeAll(async () => {
  [nisha, hardik, priya, ravi] = await Promise.all(["nisha.trivedi", "hardik.mehta", "priya.vaghela", "krupa.joshi"].map((u) => login(`${u}@strats360.com`)));
  [{ tenant_id: tenantId, department_id: deptId, id: priyaId }] = (await sql`select tenant_id, department_id, id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  [{ id: hardikId }] = (await sql`select id from employees where work_email = 'hardik.mehta@strats360.com'`) as any;
  await sql`delete from objectives where tenant_id = ${tenantId}`;
});
afterAll(async () => {
  await sql`delete from objectives where tenant_id = ${tenantId}`;
  await sql.end();
});

describe("OKRs", () => {
  it("lets HR set company and team objectives", async () => {
    const body = { level: "company", title: "Grow revenue profitably", period, keyResults: [{ title: "Reach ₹12 Cr ARR", kind: "currency", start: 80000000, target: 120000000 }, { title: "Cut churn to 2%", kind: "percent", start: 4, target: 2 }] };
    expect((await priya.post("/admin/okrs", body)).status).toBe(403);
    const r = await nisha.post("/admin/okrs", body);
    expect(r.status).toBe(201);
    companyId = r.body.id;
    expect((await nisha.post("/admin/okrs", { ...body, level: "team" })).status).toBe(422);
    teamId = (await nisha.post("/admin/okrs", { level: "team", departmentId: deptId, ownerId: hardikId, parentId: companyId, title: "Ship the payroll engine v2", period, keyResults: [{ title: "Launch v2", kind: "done", target: 1 }, { title: "Run 500 payrolls on v2", start: 0, target: 500, unit: "payrolls" }] })).body.id;
    const list = (await nisha.get(`/admin/okrs?period=${encodeURIComponent(period)}`)).body;
    expect(list.objectives.find((o: any) => o.id === teamId)).toMatchObject({ level: "team", progress: 0, owner: { name: "Hardik Mehta" }, parentId: companyId });
  });

  it("lets people add their own and line them up under a team objective", async () => {
    expect((await priya.post("/ess/okrs", { level: "company", title: "Mine", period, keyResults: [{ title: "x x x", target: 1 }] })).status).toBe(403);
    expect((await priya.post("/ess/okrs", { level: "individual", ownerId: hardikId, title: "Not mine", period, keyResults: [{ title: "x x x", target: 1 }] })).status).toBe(403);
    const r = await priya.post("/ess/okrs", { level: "individual", ownerId: priyaId, parentId: teamId, title: "Make payslips faster", period, keyResults: [{ title: "Payslip PDF under 1 second", kind: "number", start: 4, target: 1, unit: "seconds" }] });
    expect(r.status).toBe(201);
    mineId = r.body.id;
    const feed = (await priya.get("/ess/okrs")).body;
    expect(feed.objectives.map((o: any) => o.id).sort()).toEqual([companyId, teamId, mineId].sort());
    expect(feed.objectives.find((o: any) => o.id === mineId).canEdit).toBe(true);
    expect(feed.objectives.find((o: any) => o.id === teamId).canEdit).toBe(false);
  });

  it("keeps personal objectives between the person and their manager", async () => {
    expect((await ravi.get("/ess/okrs")).body.objectives.map((o: any) => o.id)).not.toContain(mineId);
    expect((await ravi.get(`/ess/okrs/${mineId}`)).status).toBe(404);
    const boss = (await hardik.get("/ess/okrs")).body.objectives.find((o: any) => o.id === mineId);
    expect(boss.canEdit).toBe(true);
  });

  it("records check ins and updates progress", async () => {
    const one = (await priya.get(`/ess/okrs/${mineId}`)).body;
    const kr = one.keyResults[0].id;
    expect((await ravi.post(`/ess/okrs/${teamId}/checkin`, { values: {}, confidence: "on_track" })).status).toBe(403);
    expect((await priya.post(`/ess/okrs/${mineId}/checkin`, { values: { nope: 2 }, confidence: "on_track" })).status).toBe(400);
    expect((await priya.post(`/ess/okrs/${mineId}/checkin`, { values: { [kr]: 2.5 }, confidence: "at_risk", note: "Caching helped, fonts are next" })).body.progress).toBe(50);
    const after = (await priya.get(`/ess/okrs/${mineId}`)).body;
    expect(after).toMatchObject({ progress: 50, confidence: "at_risk", parent: { id: teamId } });
    expect(after.history[0]).toMatchObject({ progress: 50, confidence: "at_risk", note: "Caching helped, fonts are next", byName: "Priya Vaghela" });
    // the team lead checks in on the team objective
    const team = (await hardik.get(`/ess/okrs/${teamId}`)).body;
    expect(team.children.map((x: any) => x.id)).toEqual([mineId]);
    await hardik.post(`/ess/okrs/${teamId}/checkin`, { values: { [team.keyResults[0].id]: 1, [team.keyResults[1].id]: 125 }, confidence: "on_track" });
    expect((await nisha.get(`/admin/okrs/${teamId}`)).body.progress).toBe(63);
  });

  it("stops loops and archives", async () => {
    const co = (await nisha.get(`/admin/okrs/${companyId}`)).body;
    const body = { level: "company", title: co.title, period, parentId: mineId, keyResults: co.keyResults };
    expect((await nisha.req("PUT", `/admin/okrs/${companyId}`, body)).status).toBe(400);
    expect((await priya.post(`/ess/okrs/${mineId}/archive`)).status).toBe(200);
    expect((await priya.get("/ess/okrs")).body.objectives.map((o: any) => o.id)).not.toContain(mineId);
    expect((await priya.post(`/ess/okrs/${teamId}/archive`)).status).toBe(403);
  });
});
