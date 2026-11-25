import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, lastEmailTo, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const email = `owner-${Date.now()}@acme-signup.in`;
const password = "AcmeSignup#2026";

afterAll(async () => {
  await sql`delete from tenants where id in (select m.tenant_id from memberships m join auth_user u on u.id = m.user_id where u.email = ${email})`;
  await sql`delete from auth_user where email = ${email}`;
  await sql`delete from pending_signups where email = ${email}`;
  await sql.end();
});

describe("company sign-up", () => {
  const anon = new Client();

  it("needs a work email", async () => {
    const r = await anon.post("/public/signup", { name: "Asha Mehta", email: "asha.mehta@gmail.com", password });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toMatch(/work email/);
    expect((await anon.post("/public/signup", { name: "Asha", email: "x@mailinator.com", password })).status).toBe(422);
  });

  it("creates nothing until the email is confirmed", async () => {
    const r = await anon.post("/public/signup", { name: "Asha Mehta", email, password, phone: "+91 98240 11872" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await sql`select count(*)::int as n from auth_user where email = ${email}`)[0]!.n).toBe(0);
    // can't sign in yet
    expect((await new Client().post("/auth/sign-in/email", { email, password })).status).not.toBe(200);
    // a second try within a minute is held back
    expect((await anon.post("/public/signup", { name: "Asha Mehta", email, password })).status).toBe(400);
    expect((await anon.post("/public/signup/verify", { token: "not-a-real-token-at-all-12345" })).status).toBe(400);
  });

  it("verifies, signs in, then creates the company with no forced wizard", async () => {
    const mail = lastEmailTo(email);
    expect(mail?.subject).toBe("Confirm your email for Saralix");
    const token = decodeURIComponent(mail!.text.match(/token=([A-Za-z0-9_%-]+)/)![1]!);
    const v = await anon.post("/public/signup/verify", { token });
    expect(v.body).toMatchObject({ verified: true, email });
    expect((await anon.post("/public/signup/verify", { token })).body.verified).toBe(true);

    const c = await login(email, password);
    const me = (await c.get("/me")).body;
    expect(me).toMatchObject({ canCreateCompany: true, user: { emailVerified: true }, memberships: [] });
    const co = await c.post("/me/company", { companyName: "Acme Signup Pvt Ltd", state: "Gujarat", companySize: "21–100" });
    expect(co.status, JSON.stringify(co.body)).toBe(201);
    expect((await c.post("/me/company", { companyName: "Second", state: "Gujarat" })).status).toBe(400);
    c.tenantId = co.body.tenantId;
    const after = (await c.get("/me")).body;
    expect(after.canCreateCompany).toBe(false);
    expect(after.memberships[0]).toMatchObject({ tenantName: "Acme Signup Pvt Ltd", roleName: "Super admin" });
    expect((await anon.post("/public/signup", { name: "Again", email, password })).status).toBe(409);
  });

  it("lists what's left on the dashboard instead of forcing a wizard", async () => {
    const c = await login(email, password);
    c.tenantId = (await c.get("/me")).body.memberships[0].tenantId;
    const s = (await c.get("/admin/dashboard/setup")).body;
    expect(s).toMatchObject({ requiredDone: 0, requiredTotal: 5, complete: false, hidden: false });
    expect(s.items.map((i: any) => i.key)).toEqual(["company", "statutory", "payroll", "employees", "salaries", "admins", "bank", "leave", "holidays", "security"]);
    expect((await c.post("/admin/dashboard/setup/company", { done: true })).status).toBe(400);
    expect((await c.post("/admin/dashboard/setup/holidays", { done: true })).status).toBe(200);
    expect((await c.patch("/admin/org/tenant", { pan: "AAACA1234Q", registeredAddress: "1 Ring Road, Surat" })).status).toBe(200);
    const after = (await c.get("/admin/dashboard/setup")).body;
    expect(after.requiredDone).toBe(1);
    expect(after.items.find((i: any) => i.key === "holidays").done).toBe(true);
    expect((await c.post("/admin/dashboard/setup-finish", { hideOnly: true })).status).toBe(200);
    expect((await c.get("/admin/dashboard/setup")).body).toMatchObject({ hidden: true, complete: false });
  });
});
