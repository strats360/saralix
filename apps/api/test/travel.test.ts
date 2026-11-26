import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login, mailer } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let hardik: Client, priya: Client, kunal: Client;
let tenantId = "", priyaId = "", tripId = "", travelCat = "";
const day = (d: number) => new Date(Date.now() + (d * 86_400_000) + 5.5 * 3_600_000).toISOString().slice(0, 10);

const claim = (expenseDate: string, amount: number) => {
  const fd = new FormData();
  fd.append("data", JSON.stringify({ categoryId: travelCat, expenseDate, amount, description: "Cab to the client office", travelRequestId: tripId }));
  return priya.post("/ess/claims", fd);
};

beforeAll(async () => {
  [hardik, priya, kunal] = await Promise.all(["hardik.mehta", "priya.vaghela", "kunal.shah"].map((u) => login(`${u}@strats360.com`)));
  [{ tenant_id: tenantId, id: priyaId }] = (await sql`select tenant_id, id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  [{ id: travelCat }] = (await sql`select id from reimbursement_categories where tenant_id = ${tenantId} and name = 'Travel'`) as any;
});
afterAll(async () => {
  await sql`delete from reimbursement_claims where travel_request_id is not null and tenant_id = ${tenantId}`;
  await sql`delete from employee_loans where paid_method = 'travel_advance' and tenant_id = ${tenantId}`;
  await sql`delete from travel_requests where tenant_id = ${tenantId}`;
  await sql.end();
});

describe("Travel", () => {
  it("asks the manager, then finance for an advance", async () => {
    expect((await priya.post("/ess/travel", { purpose: "Client workshop", fromCity: "Bhavnagar", toCity: "Mumbai", startDate: day(-10), endDate: day(-12), estimatedCost: 12000 })).status).toBe(422);
    expect((await priya.post("/ess/travel", { purpose: "Client workshop", fromCity: "Bhavnagar", toCity: "Mumbai", startDate: day(-10), endDate: day(-6), estimatedCost: 12000, advanceAmount: 20000 })).status).toBe(422);
    const before = mailer.sent.length;
    const r = await priya.post("/ess/travel", { purpose: "Client workshop at Tata Steel", fromCity: "Bhavnagar", toCity: "Mumbai", startDate: day(-10), endDate: day(-6), mode: "flight", estimatedCost: 12000, advanceAmount: 5000 });
    expect(r.status).toBe(201);
    tripId = r.body.id;
    expect(r.body).toMatchObject({ status: "pending_manager" });
    expect(r.body.code).toMatch(/^TR-\d+$/);
    expect(mailer.sent.slice(before).some((m) => m.to === "hardik.mehta@strats360.com" && m.subject === "Priya Vaghela asked to travel")).toBe(true);
    expect((await priya.post(`/admin/travel/${tripId}/decision`, { decision: "approve" })).status).toBe(403);
    expect((await hardik.post(`/admin/travel/${tripId}/decision`, { decision: "approve" })).status).toBe(200);
    const list = (await kunal.get("/admin/travel")).body.find((t: any) => t.id === tripId);
    expect(list).toMatchObject({ status: "pending_finance", canFinance: true });
    expect((await kunal.post(`/admin/travel/${tripId}/decision`, { decision: "approve" })).status).toBe(200);
    expect((await priya.get("/ess/travel")).body[0]).toMatchObject({ status: "approved", advanceAmount: 5000 });
  });

  it("links claims to the trip and settles the advance through payroll", async () => {
    expect((await kunal.post(`/admin/travel/${tripId}/advance-paid`, { paidOn: day(-11), reference: "NEFT 88231" })).status).toBe(200);
    const a = await claim(day(-9), 450);
    expect(a.status).toBe(201);
    const b = await claim(day(-8), 380);
    expect(b.status).toBe(201);
    expect((await priya.post(`/ess/travel/${tripId}/cancel`)).status).toBe(400);
    expect((await kunal.post(`/admin/travel/${tripId}/settle`)).status).toBe(400);
    for (const id of [a.body.id ?? a.body.claim?.id, b.body.id ?? b.body.claim?.id]) {
      await hardik.post(`/admin/reimbursements/claims/${id}/decision`, { decision: "approved" });
      await kunal.post(`/admin/reimbursements/claims/${id}/decision`, { decision: "approved" });
    }
    const t = (await priya.get("/ess/travel")).body[0];
    expect(t.claims).toMatchObject({ claimed: 830, open: 0, count: 2 });
    expect(t.settlement).toEqual({ advance: 5000, claimed: 830, net: -4170 });
    const s = await kunal.post(`/admin/travel/${tripId}/settle`);
    expect(s.status).toBe(200);
    const [loan] = await sql`select type, amount, months, status, reason from employee_loans where id = ${s.body.recoveryLoanId}`;
    expect(loan).toMatchObject({ type: "advance", amount: "5000.000", months: 1, status: "active" });
    expect(loan!.reason).toMatch(/^Travel advance for TR-/);
    expect((await priya.get("/ess/travel")).body[0].status).toBe("settled");
    // a settled trip takes no more claims
    expect((await claim(day(-7), 300)).status).toBe(400);
  });
});
