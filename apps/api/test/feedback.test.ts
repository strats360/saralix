import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login, mailer } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let nisha: Client, hardik: Client, priya: Client, krupa: Client, kunal: Client;
let tenantId = "", priyaId = "", hardikId = "", krupaId = "", nishaId = "", kunalId = "", cycleId = "", reviewId = "";

beforeAll(async () => {
  [nisha, hardik, priya, krupa, kunal] = await Promise.all(["nisha.trivedi", "hardik.mehta", "priya.vaghela", "krupa.joshi", "kunal.shah"].map((u) => login(`${u}@strats360.com`)));
  const ids = Object.fromEntries((await sql`select work_email, id, tenant_id from employees where work_email in ('priya.vaghela@strats360.com','hardik.mehta@strats360.com','krupa.joshi@strats360.com','nisha.trivedi@strats360.com','kunal.shah@strats360.com')`).map((r: any) => [r.work_email.split(".")[0], r]));
  [priyaId, hardikId, krupaId, nishaId, kunalId, tenantId] = [ids.priya.id, ids.hardik.id, ids.krupa.id, ids.nisha.id, ids.kunal.id, ids.priya.tenant_id];
  await sql`delete from feedback where tenant_id = ${tenantId}`;
  [{ id: cycleId }] = (await sql`insert into review_cycles (id, tenant_id, name, period_start, period_end, self_due, manager_due, status) values (gen_random_uuid()::text, ${tenantId}, 'Feedback test cycle', current_date - 90, current_date, current_date + 7, current_date + 14, 'active') returning id`) as any;
  [{ id: reviewId }] = (await sql`insert into performance_reviews (id, tenant_id, cycle_id, employee_id, manager_id, stage) values (gen_random_uuid()::text, ${tenantId}, ${cycleId}, ${priyaId}, ${hardikId}, 'manager') returning id`) as any;
});
afterAll(async () => {
  await sql`delete from feedback where tenant_id = ${tenantId}`;
  await sql`delete from review_cycles where id = ${cycleId}`;
  await sql.end();
});

const answer = (c: Client, id: string, rating: number | null = 4) => c.post(`/ess/feedback/${id}/answer`, { strengths: "Clear thinking and calm under pressure.", improvements: "Share plans earlier.", rating });

describe("Feedback", () => {
  it("lets someone give feedback, seen by the person and their manager", async () => {
    expect((await krupa.post("/ess/feedback/give", { aboutEmployeeId: krupaId, strengths: "I am great at my job" })).status).toBe(400);
    const before = mailer.sent.length;
    expect((await krupa.post("/ess/feedback/give", { aboutEmployeeId: priyaId, strengths: "Your payslip work saved us a week." })).status).toBe(201);
    expect(mailer.sent.slice(before).map((m) => m.subject)).toEqual(expect.arrayContaining(["Krupa Joshi gave you feedback", "Feedback on Priya Vaghela"]));
    await krupa.post("/ess/feedback/give", { aboutEmployeeId: priyaId, strengths: "Only for the manager to read.", visibility: "manager" });
    const p = (await priya.get("/ess/feedback")).body;
    expect(p.received.map((f: any) => f.strengths)).toEqual(["Your payslip work saved us a week."]);
    expect(p.received[0].from.name).toBe("Krupa Joshi");
    const h = (await hardik.get("/ess/feedback")).body;
    expect(h.team.map((f: any) => f.strengths).sort()).toEqual(["Only for the manager to read.", "Your payslip work saved us a week."]);
    expect((await nisha.get("/ess/feedback")).body.team.map((f: any) => f.about.id)).not.toContain(priyaId);
  });

  it("lets someone ask for feedback and see who answered", async () => {
    expect((await priya.post("/ess/feedback/ask", { fromEmployeeIds: [priyaId] })).status).toBe(400);
    const r = await priya.post("/ess/feedback/ask", { fromEmployeeIds: [krupaId, nishaId], prompt: "How did the payslip launch go from your side?" });
    expect(r.body.asked).toBe(2);
    expect((await priya.post("/ess/feedback/ask", { fromEmployeeIds: [krupaId] })).body.asked).toBe(0);
    const k = (await krupa.get("/ess/feedback")).body.toAnswer[0];
    expect(k).toMatchObject({ kind: "request", about: { name: "Priya Vaghela" }, prompt: "How did the payslip launch go from your side?" });
    expect((await answer(priya, k.id)).status).toBe(404);
    expect((await answer(krupa, k.id, null)).status).toBe(200);
    expect((await answer(krupa, k.id, null)).status).toBe(400);
    const n = (await nisha.get("/ess/feedback")).body.toAnswer.find((x: any) => x.kind === "request");
    expect((await nisha.post(`/ess/feedback/${n.id}/decline`)).status).toBe(200);
    const p = (await priya.get("/ess/feedback")).body;
    expect(p.received.find((f: any) => f.kind === "request")).toMatchObject({ from: { name: "Krupa Joshi" }, strengths: "Clear thinking and calm under pressure." });
  });

  it("gathers 360 feedback for a review, hidden from the person until it's shared", async () => {
    expect((await krupa.post(`/admin/review-feedback/${reviewId}`, { fromEmployeeIds: [nishaId] })).status).toBe(404);
    expect((await hardik.post(`/admin/review-feedback/${reviewId}`, { fromEmployeeIds: [priyaId] })).status).toBe(400);
    expect((await hardik.post(`/admin/review-feedback/${reviewId}`, { fromEmployeeIds: [krupaId, nishaId, kunalId], prompt: "How has Priya been to work with this year?" })).body.asked).toBe(3);
    for (const c of [krupa, nisha]) {
      const req = (await c.get("/ess/feedback")).body.toAnswer.find((x: any) => x.kind === "review");
      expect(req.from).toBeNull();
      expect((await answer(c, req.id, null)).status).toBe(400);
      expect((await answer(c, req.id, 4)).status).toBe(200);
    }
    const list = (await hardik.get(`/admin/review-feedback/${reviewId}`)).body;
    expect(list.filter((f: any) => f.status === "submitted").map((f: any) => f.from.name).sort()).toEqual(["Krupa Joshi", "Nisha Trivedi"]);
    // not shared yet, and only two answers: nothing for Priya
    await sql`update performance_reviews set stage = 'shared' where id = ${reviewId}`;
    expect((await priya.get("/ess/feedback")).body.received.filter((f: any) => f.kind === "review")).toHaveLength(0);
    await sql`update performance_reviews set stage = 'manager' where id = ${reviewId}`;
    const last = (await kunal.get("/ess/feedback")).body.toAnswer.find((x: any) => x.kind === "review");
    expect((await answer(kunal, last.id, 5)).status).toBe(200);
    expect((await priya.get("/ess/feedback")).body.received.filter((f: any) => f.kind === "review")).toHaveLength(0);
    await sql`update performance_reviews set stage = 'shared' where id = ${reviewId}`;
    const mine = (await priya.get("/ess/feedback")).body.received.filter((f: any) => f.kind === "review");
    expect(mine).toHaveLength(3);
    expect(mine.every((f: any) => f.from === null)).toBe(true);
    expect((await hardik.post(`/admin/review-feedback/${reviewId}`, { fromEmployeeIds: [krupaId] })).status).toBe(400);
  });
});
