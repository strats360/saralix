import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDb } from "@hrms/db";
import { DEFAULT_VALUES } from "@hrms/shared";
import { Client, env, login, mailer } from "./helpers";
import { runSurveyJobs } from "../src/services/engagement";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const db = createDb(env.DATABASE_URL!, { max: 1 });
let nisha: Client, hardik: Client, priya: Client;
let tenantId = "", deptId = "", otherDept = "", hardikId = "", priyaId = "", pulseId = "";

const PULSE = {
  title: "December pulse",
  kind: "pulse",
  anonymous: true,
  questions: [
    { id: "q1", type: "scale", text: "I feel good about my work this month." },
    { id: "q2", type: "enps", text: "Would you recommend working here?" },
    { id: "q3", type: "text", text: "Anything we could do better?", required: false },
  ],
};

beforeAll(async () => {
  [nisha, hardik, priya] = await Promise.all(["nisha.trivedi", "hardik.mehta", "priya.vaghela"].map((u) => login(`${u}@strats360.com`)));
  [{ tenant_id: tenantId, department_id: deptId, id: priyaId }] = (await sql`select tenant_id, department_id, id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  [{ id: hardikId }] = (await sql`select id from employees where work_email = 'hardik.mehta@strats360.com'`) as any;
  [{ id: otherDept }] = (await sql`select id from departments where tenant_id = ${tenantId} and id <> ${deptId} limit 1`) as any;
  // start clean: the demo seed adds sample surveys and kudos
  await sql`delete from surveys where tenant_id = ${tenantId}`;
  await sql`delete from kudos where tenant_id = ${tenantId}`;
});
afterAll(async () => {
  await sql`delete from surveys where tenant_id = ${tenantId}`;
  await sql`delete from kudos where tenant_id = ${tenantId}`;
  await sql`delete from engagement_settings where tenant_id = ${tenantId}`;
  await sql.end();
  await db.$client.end();
});

describe("Surveys", () => {
  it("lets HR open an anonymous pulse for everyone and emails them", async () => {
    expect((await priya.post("/admin/engagement/surveys", PULSE)).status).toBe(403);
    const before = mailer.sent.length;
    const r = await nisha.post("/admin/engagement/surveys", { ...PULSE, open: true });
    expect(r.status).toBe(201);
    pulseId = r.body.id;
    expect(r.body).toMatchObject({ status: "open" });
    expect(r.body.invited).toBeGreaterThan(100);
    expect(mailer.sent.slice(before).some((m) => m.to === "priya.vaghela@strats360.com" && m.subject === "Your view: December pulse")).toBe(true);
    // once open, the questions are fixed
    await nisha.req("PUT", `/admin/engagement/surveys/${pulseId}`, { ...PULSE, questions: [PULSE.questions[0]] });
    expect((await nisha.get(`/admin/engagement/surveys/${pulseId}`)).body.questions).toHaveLength(3);
  });

  it("takes one answer per person, without storing who gave it", async () => {
    const list = (await priya.get("/ess/engagement/surveys")).body;
    expect(list.find((s: any) => s.id === pulseId)).toMatchObject({ answered: false, anonymous: true, questions: 3 });
    expect((await priya.post(`/ess/engagement/surveys/${pulseId}/respond`, { answers: { q1: 7, q2: 9 } })).status).toBe(400);
    expect((await priya.post(`/ess/engagement/surveys/${pulseId}/respond`, { answers: { q2: 9 } })).status).toBe(400);
    expect((await priya.post(`/ess/engagement/surveys/${pulseId}/respond`, { answers: { q1: 4, q2: 9, q3: "More team lunches" } })).status).toBe(200);
    expect((await priya.post(`/ess/engagement/surveys/${pulseId}/respond`, { answers: { q1: 4, q2: 9 } })).status).toBe(400);
    const rows = await sql`select employee_id, department_id from survey_responses where survey_id = ${pulseId}`;
    expect(rows).toEqual([{ employee_id: null, department_id: deptId }]);
    expect((await priya.get(`/ess/engagement/surveys/${pulseId}`)).body.answered).toBe(true);
    expect((await sql`select count(*)::int as n from audit_logs where entity_id = ${pulseId} and action = 'survey.respond'`)[0]!.n).toBe(0);
  });

  it("holds back anonymous results until three people have answered", async () => {
    const early = (await nisha.get(`/admin/engagement/surveys/${pulseId}/results`)).body;
    expect(early).toMatchObject({ responses: 1, hidden: true, questions: null });
    await hardik.post(`/ess/engagement/surveys/${pulseId}/respond`, { answers: { q1: 2, q2: 3 } });
    await nisha.post(`/ess/engagement/surveys/${pulseId}/respond`, { answers: { q1: 5, q2: 10, q3: "All good" } });
    const r = (await nisha.get(`/admin/engagement/surveys/${pulseId}/results`)).body;
    expect(r.hidden).toBe(false);
    expect(r.questions[0]).toMatchObject({ average: 3.7, answered: 3 });
    expect(r.questions[1]).toMatchObject({ score: 33, promoters: 2, detractors: 1 });
    expect(r.questions[2].comments.sort()).toEqual(["All good", "More team lunches"]);
    // every team here has fewer than three answers, so none is shown on its own
    expect(r.breakdown.length).toBeGreaterThan(0);
    expect(r.breakdown.every((b: any) => b.hidden && b.headlines.length === 0)).toBe(true);
    expect((await nisha.get(`/admin/engagement/surveys/${pulseId}/pending`)).status).toBe(400);
    const list = (await nisha.get("/admin/engagement/surveys")).body.find((s: any) => s.id === pulseId);
    expect(list.responses).toBe(3);
  });

  it("keeps a poll for another team out of sight, and names who hasn't answered", async () => {
    const r = await nisha.post("/admin/engagement/surveys", { title: "Team outing", kind: "poll", anonymous: false, departmentIds: [otherDept], questions: [{ id: "q1", type: "choice", text: "Where to?", options: ["Lonavala", "Alibaug"] }], open: true });
    expect(r.status).toBe(201);
    expect((await priya.get("/ess/engagement/surveys")).body.map((s: any) => s.id)).not.toContain(r.body.id);
    expect((await priya.get(`/ess/engagement/surveys/${r.body.id}`)).status).toBe(404);
    const pending = (await nisha.get(`/admin/engagement/surveys/${r.body.id}/pending`)).body;
    expect(pending.length).toBe(r.body.invited);
  });

  it("closes, shares results with staff, and closes overdue surveys on its own", async () => {
    await nisha.req("PUT", `/admin/engagement/surveys/${pulseId}`, { ...PULSE, shareResults: true });
    expect((await nisha.post(`/admin/engagement/surveys/${pulseId}/close`)).status).toBe(200);
    expect((await hardik.post(`/ess/engagement/surveys/${pulseId}/respond`, { answers: { q1: 2, q2: 3 } })).status).toBe(400);
    const shared = (await priya.get(`/ess/engagement/surveys/${pulseId}/results`)).body;
    expect(shared.questions[0].average).toBe(3.7);
    expect(shared.breakdown).toEqual([]);

    const draft = await nisha.post("/admin/engagement/surveys", { ...PULSE, title: "Old one" });
    expect(draft.body.status).toBe("draft");
    expect((await priya.get(`/ess/engagement/surveys/${draft.body.id}`)).status).toBe(404);
    await nisha.post(`/admin/engagement/surveys/${draft.body.id}/open`);
    await sql`update surveys set closes_on = current_date - 1 where id = ${draft.body.id}`;
    const jobs = await runSurveyJobs(db, env);
    expect(jobs.closed).toBeGreaterThanOrEqual(1);
    expect((await nisha.get(`/admin/engagement/surveys/${draft.body.id}`)).body.status).toBe("closed");
    expect((await nisha.req("DELETE", `/admin/engagement/surveys/${draft.body.id}`)).status).toBe(400);
  });
});

describe("Kudos", () => {
  let kudosId = "";
  it("lets colleagues give kudos for a company value, and emails the person", async () => {
    expect((await priya.get("/ess/engagement/settings")).body.values).toEqual(DEFAULT_VALUES);
    const people = (await priya.get("/ess/engagement/people")).body;
    expect(people.find((p: any) => p.id === priyaId)).toBeUndefined();
    expect(people.find((p: any) => p.id === hardikId)).toBeTruthy();
    expect((await priya.post("/ess/engagement/kudos", { toEmployeeIds: [priyaId], value: "teamwork", message: "Well done me" })).status).toBe(400);
    expect((await priya.post("/ess/engagement/kudos", { toEmployeeIds: [hardikId], value: "nope", message: "Thanks for the help" })).status).toBe(400);
    const before = mailer.sent.length;
    const r = await priya.post("/ess/engagement/kudos", { toEmployeeIds: [hardikId], value: "teamwork", message: "Thanks for staying late to fix the payroll export." });
    expect(r.status).toBe(201);
    kudosId = r.body.id;
    expect(mailer.sent.slice(before).some((m) => m.to === "hardik.mehta@strats360.com" && m.subject === "Priya Vaghela gave you kudos")).toBe(true);
  });

  it("shows them on the wall with cheers", async () => {
    const feed = (await hardik.get("/ess/engagement/kudos")).body;
    expect(feed.items[0]).toMatchObject({ id: kudosId, value: "teamwork", cheers: 0, cheered: false, mine: false, from: { name: "Priya Vaghela" } });
    expect((await hardik.post(`/ess/engagement/kudos/${kudosId}/cheer`)).body.cheered).toBe(true);
    expect((await hardik.get("/ess/engagement/kudos")).body.items[0]).toMatchObject({ cheers: 1, cheered: true });
    expect((await hardik.post(`/ess/engagement/kudos/${kudosId}/cheer`)).body.cheered).toBe(false);
    expect((await hardik.get(`/ess/engagement/kudos?employeeId=${hardikId}`)).body.items.map((k: any) => k.id)).toContain(kudosId);
  });

  it("lets HR see the numbers and hide a post", async () => {
    const rep = (await nisha.get("/admin/engagement/kudos?days=7")).body;
    expect(rep).toMatchObject({ total: 1, givers: 1 });
    expect(rep.received[0]).toMatchObject({ employeeId: hardikId, count: 1 });
    expect(rep.byValue).toEqual([{ value: "teamwork", count: 1 }]);
    await nisha.post(`/admin/engagement/kudos/${kudosId}/hide`, { hidden: true });
    expect((await hardik.get("/ess/engagement/kudos")).body.items.map((k: any) => k.id)).not.toContain(kudosId);
    expect((await nisha.get("/admin/engagement/kudos")).body.items[0]).toMatchObject({ id: kudosId, hidden: true });
  });

  it("uses the company's own values, and can be switched off", async () => {
    expect((await priya.req("PUT", "/admin/engagement/settings", { values: DEFAULT_VALUES })).status).toBe(403);
    const values = [{ key: "integrity", label: "Integrity", emoji: "🛡️" }];
    expect((await nisha.req("PUT", "/admin/engagement/settings", { values, kudosEnabled: true })).status).toBe(200);
    expect((await priya.post("/ess/engagement/kudos", { toEmployeeIds: [hardikId], value: "teamwork", message: "Thanks for the help" })).status).toBe(400);
    expect((await priya.post("/ess/engagement/kudos", { toEmployeeIds: [hardikId], value: "integrity", message: "Thanks for flagging the error" })).status).toBe(201);
    await nisha.req("PUT", "/admin/engagement/settings", { values, kudosEnabled: false });
    expect((await priya.post("/ess/engagement/kudos", { toEmployeeIds: [hardikId], value: "integrity", message: "Thanks again for that" })).status).toBe(400);
  });
});
