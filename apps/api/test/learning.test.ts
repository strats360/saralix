import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login, mailer } from "./helpers";
import { runLearningReminders } from "../src/routes/learning";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let nisha: Client, priya: Client, krupa: Client;
let tenantId = "", deptId = "", courseId = "", policyId = "", priyaId = "";

const COURSE = {
  title: "POSH basics",
  description: "What workplace harassment is, and how to raise a concern.",
  lessons: [
    { id: "l1", title: "What counts as harassment", body: "Unwelcome conduct of a sexual nature..." },
    { id: "l2", title: "How to raise a concern", body: "Write to the Internal Committee within three months." },
  ],
  quiz: [
    { id: "q1", question: "Who looks into a complaint?", options: ["Your manager", "The Internal Committee"], answer: 1 },
    { id: "q2", question: "Within how long should you complain?", options: ["Three months", "A year"], answer: 0 },
  ],
  passMark: 100,
};

beforeAll(async () => {
  [nisha, priya, krupa] = await Promise.all(["nisha.trivedi", "priya.vaghela", "krupa.joshi"].map((u) => login(`${u}@strats360.com`)));
  [{ tenant_id: tenantId, department_id: deptId, id: priyaId }] = (await sql`select tenant_id, department_id, id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  await sql`delete from courses where tenant_id = ${tenantId}`;
});
afterAll(async () => {
  await sql`delete from courses where tenant_id = ${tenantId}`;
  await sql.end();
});

describe("Learning", () => {
  it("lets HR publish a course to a team, emailing them", async () => {
    expect((await priya.post("/admin/learning", COURSE)).status).toBe(403);
    expect((await nisha.post("/admin/learning", { title: "Empty" })).status).toBe(422);
    courseId = (await nisha.post("/admin/learning", { ...COURSE, departmentIds: [deptId] })).body.id;
    expect((await priya.get("/ess/learning")).body).toEqual([]);
    const before = mailer.sent.length;
    const r = await nisha.post(`/admin/learning/${courseId}/publish`);
    expect(r.body.assigned).toBeGreaterThan(0);
    expect(mailer.sent.slice(before).some((m) => m.to === "priya.vaghela@strats360.com" && m.subject === "New course: POSH basics")).toBe(true);
    expect((await krupa.get("/ess/learning")).body.map((x: any) => x.id)).not.toContain(courseId);
  });

  it("takes someone through the lessons and the quiz", async () => {
    const list = (await priya.get("/ess/learning")).body;
    expect(list[0]).toMatchObject({ id: courseId, state: "not_started", lessons: 2, quiz: 2 });
    const one = (await priya.get(`/ess/learning/${courseId}`)).body;
    expect(one.quiz[0]).not.toHaveProperty("answer");
    expect((await priya.post(`/ess/learning/${courseId}/quiz`, { answers: { q1: 1, q2: 0 } })).status).toBe(400);
    await priya.post(`/ess/learning/${courseId}/lessons/l1`);
    expect((await priya.post(`/ess/learning/${courseId}/lessons/l2`)).body.completed).toBe(false);
    const fail = (await priya.post(`/ess/learning/${courseId}/quiz`, { answers: { q1: 0, q2: 0 } })).body;
    expect(fail).toMatchObject({ score: 50, passed: false, wrong: 1, completed: false });
    const pass = (await priya.post(`/ess/learning/${courseId}/quiz`, { answers: { q1: 1, q2: 0 } })).body;
    expect(pass).toMatchObject({ score: 100, passed: true, completed: true });
    const p = (await nisha.get(`/admin/learning/${courseId}/progress`)).body.find((x: any) => x.employeeId === priyaId);
    expect(p).toMatchObject({ state: "completed", score: 100, attempts: 2, lessonsDone: 2 });
    const row = (await nisha.get("/admin/learning")).body.find((x: any) => x.id === courseId);
    expect(row.done).toBe(1);
  });

  it("has everyone read and confirm a policy, including people who join later", async () => {
    policyId = (await nisha.post("/admin/learning", { kind: "policy", title: "Leave policy 2027", acknowledgement: "I've read the leave policy." })).body.id;
    expect((await nisha.post(`/admin/learning/${policyId}/publish`)).status).toBe(400);
    await nisha.req("PUT", `/admin/learning/${policyId}`, { kind: "policy", title: "Leave policy 2027", lessons: [{ id: "p", title: "The policy", body: "Casual leave is 10 days a year." }] });
    expect((await nisha.post(`/admin/learning/${policyId}/publish`)).status).toBe(200);
    // someone without an enrollment row yet gets it on first look
    await sql`delete from course_enrollments where course_id = ${policyId} and employee_id = (select id from employees where work_email = 'krupa.joshi@strats360.com')`;
    expect((await krupa.get("/ess/learning")).body.map((x: any) => x.id)).toContain(policyId);
    expect((await krupa.post(`/ess/learning/${courseId}/acknowledge`)).status).toBe(404);
    expect((await krupa.post(`/ess/learning/${policyId}/acknowledge`)).status).toBe(200);
    expect((await krupa.get("/ess/learning")).body.find((x: any) => x.id === policyId).state).toBe("completed");
  });

  it("reminds people two days before it's due, once", async () => {
    await sql`update course_enrollments set due_on = current_date + 1, reminder_sent_at = null where course_id = ${policyId} and completed_at is null`;
    const before = mailer.sent.length;
    await runLearningReminders(env);
    const sent = mailer.sent.slice(before).filter((m) => m.subject === "Due soon: Leave policy 2027").length;
    expect(sent).toBeGreaterThan(0);
    await runLearningReminders(env);
    expect(mailer.sent.slice(before).filter((m) => m.subject === "Due soon: Leave policy 2027").length).toBe(sent);
    expect((await nisha.req("DELETE", `/admin/learning/${policyId}`)).status).toBe(400);
  });
});
