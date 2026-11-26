import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import postgres from "postgres";
import { buildApp } from "../src/app";
import { Client, env, login, mailer } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const app = buildApp();
let kunal: Client;
let server: Server;
let port = 0;
const received: any[] = [];
let tid = "", key = "", readOnly = "";
const EMAIL = "zapier.joiner@strats360.com";

const v1 = async (method: string, path: string, k: string, body?: unknown) => {
  const r = await app.fetch(new Request(`${env.APP_URL}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${k}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
};

beforeAll(async () => {
  kunal = await login("kunal.shah@strats360.com");
  [{ tid }] = (await sql`select tenant_id as tid from employees where work_email = 'kunal.shah@strats360.com'`) as any;
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => (received.push(JSON.parse(body)), res.end("ok")));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
  key = (await kunal.post("/admin/integrations/keys", { name: "Zapier", scopes: ["employees:read", "employees:write", "webhooks:manage"] })).body.key;
  readOnly = (await kunal.post("/admin/integrations/keys", { name: "BI", scopes: ["employees:read"] })).body.key;
});
afterAll(async () => {
  await sql`delete from employees where work_email = ${EMAIL}`;
  await sql`delete from api_keys where tenant_id = ${tid} and name in ('Zapier', 'BI')`;
  await sql`delete from webhooks where tenant_id = ${tid} and created_by like 'api_key:%'`;
  server.close();
  await sql.end();
});

describe("Zapier", () => {
  it("tests the connection", async () => {
    const r = await v1("GET", "/me", key);
    expect(r.body).toMatchObject({ company: { name: "Strats360 Technolabs LLP" }, key: { name: "Zapier" } });
  });

  it("subscribes to an event, gets it, and unsubscribes", async () => {
    expect((await v1("POST", "/hooks", readOnly, { url: `http://127.0.0.1:${port}/z`, event: "employee.created" })).status).toBe(403);
    expect((await v1("POST", "/hooks", key, { url: "http://10.0.0.5/z", event: "employee.created" })).status).toBe(400);
    const sub = await v1("POST", "/hooks", key, { url: `http://127.0.0.1:${port}/z`, event: "employee.created" });
    expect(sub.status).toBe(201);
    const samples = await v1("GET", "/events/employee.created/samples", key);
    expect(samples.body.length).toBeGreaterThan(0);
    expect(samples.body[0]).toHaveProperty("employeeCode");

    expect((await v1("POST", "/employees", readOnly, { firstName: "Zap", workEmail: EMAIL, dateOfJoining: "2026-12-01" })).status).toBe(403);
    expect((await v1("POST", "/employees", key, { firstName: "Zap", workEmail: EMAIL, dateOfJoining: "2026-12-01", department: "Underwater basket weaving" })).status).toBe(400);
    const before = mailer.sent.length;
    const r = await v1("POST", "/employees", key, { firstName: "Zap", lastName: "Joiner", workEmail: EMAIL, dateOfJoining: "2026-12-01", department: "engineering", designation: "Software Engineer" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ fullName: "Zap Joiner", status: "onboarding", invited: true });
    expect(mailer.sent.slice(before).some((m) => m.to === EMAIL)).toBe(true);
    expect((await v1("POST", "/employees", key, { firstName: "Zap", workEmail: EMAIL, dateOfJoining: "2026-12-01" })).status).toBe(409);
    expect(received.some((p) => JSON.stringify(p).includes("Zap Joiner"))).toBe(true);
    const [row] = await sql`select d.name as dept from employees e left join departments d on d.id = e.department_id where e.work_email = ${EMAIL}`;
    expect(row!.dept).toBe("Engineering");

    // another integration can't remove this one's subscription
    const other = (await kunal.post("/admin/integrations/keys", { name: "BI", scopes: ["webhooks:manage"] })).body.key;
    expect((await v1("DELETE", `/hooks/${sub.body.id}`, other)).status).toBe(404);
    expect((await v1("DELETE", `/hooks/${sub.body.id}`, key)).status).toBe(200);
    expect((await sql`select count(*)::int as n from webhooks where id = ${sub.body.id}`)[0]!.n).toBe(0);
  });
});
