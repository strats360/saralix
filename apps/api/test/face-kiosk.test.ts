import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let kunal: Client, priya: Client, krupa: Client;
let tenantId = "", priyaId = "", krupaId = "", kioskId = "", key = "", eventId = "";
const anon = new Client();

const vec = (seed: number, jitter = 0) => Array.from({ length: 128 }, (_, i) => Math.sin(seed * 7.3 + i) * 0.1 + (jitter ? Math.cos(i * jitter) * 0.004 : 0));
const samples = (seed: number) => [vec(seed), vec(seed, 1), vec(seed, 2)];
const asKiosk = (path: string, body?: unknown) => anon.req(body === undefined ? "GET" : "POST", `/public/kiosk${path}`, body, { Authorization: `Bearer ${key}` });

beforeAll(async () => {
  [kunal, priya, krupa] = await Promise.all(["kunal.shah", "priya.vaghela", "krupa.joshi"].map((u) => login(`${u}@strats360.com`)));
  [{ tenant_id: tenantId, id: priyaId }] = (await sql`select tenant_id, id from employees where work_email = 'priya.vaghela@strats360.com'`) as any;
  [{ id: krupaId }] = (await sql`select id from employees where work_email = 'krupa.joshi@strats360.com'`) as any;
  await sql`delete from tenant_addons where tenant_id = ${tenantId}`;
  await sql`delete from attendance_devices where tenant_id = ${tenantId} and kind = 'kiosk'`;
  await sql`delete from face_templates where tenant_id = ${tenantId}`;
});
afterAll(async () => {
  await sql`delete from attendance_punches where tenant_id = ${tenantId} and device_id = ${kioskId}`;
  await sql`delete from attendance_devices where tenant_id = ${tenantId} and kind = 'kiosk'`;
  await sql`delete from face_templates where tenant_id = ${tenantId}`;
  await sql`delete from tenant_addons where tenant_id = ${tenantId}`;
  await sql.end();
});

describe("Face kiosk", () => {
  it("is off until the company has the add-on", async () => {
    expect((await kunal.get("/admin/face-kiosk/kiosks")).status).toBe(403);
    await sql`insert into tenant_addons (id, tenant_id, addon_key) values (gen_random_uuid()::text, ${tenantId}, 'addon.face_kiosk')`;
    expect((await kunal.get("/admin/face-kiosk/kiosks")).status).toBe(200);
  });

  it("pairs a tablet with a one-time code", async () => {
    expect((await priya.post("/admin/face-kiosk/kiosks", { name: "Front door" })).status).toBe(403);
    const r = await kunal.post("/admin/face-kiosk/kiosks", { name: "Front door" });
    expect(r.status).toBe(201);
    kioskId = r.body.id;
    expect(r.body.code).toMatch(/^[A-Z0-9]{8}$/);
    expect((await anon.post("/public/kiosk/pair", { code: "WRONG123" })).status).toBe(400);
    const p = await anon.post("/public/kiosk/pair", { code: r.body.code.toLowerCase() });
    expect(p.status).toBe(200);
    key = p.body.key;
    // the code works once
    expect((await anon.post("/public/kiosk/pair", { code: r.body.code })).status).toBe(400);
    expect((await asKiosk("/me")).body).toMatchObject({ name: "Front door", company: expect.any(String) });
  });

  it("enrols faces with consent, from the app or by HR", async () => {
    expect((await priya.post("/ess/face", { descriptors: samples(1), consent: false })).status).toBe(422);
    expect((await priya.post("/ess/face", { descriptors: [vec(1), vec(2), vec(1, 1)], consent: true })).status).toBe(400);
    expect((await priya.post("/ess/face", { descriptors: samples(1), consent: true })).status).toBe(200);
    expect((await priya.get("/ess/face")).body).toMatchObject({ enrolled: true, via: "self" });
    expect((await kunal.post(`/admin/face-kiosk/people/${krupaId}`, { descriptors: samples(2), consent: true })).status).toBe(200);
    const people = (await kunal.get("/admin/face-kiosk/people")).body;
    expect(people.find((p: any) => p.id === krupaId)).toMatchObject({ via: "hr" });
  });

  it("punches the right person, ignores a quick repeat, and lets them undo", async () => {
    const photo = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]).toString("base64");
    const r = await asKiosk("/punch", { descriptor: vec(1, 3), photo });
    expect(r.body).toMatchObject({ result: "punched", name: "Priya Vaghela", direction: expect.stringMatching(/in|out/) });
    eventId = r.body.eventId;
    const [{ n }] = (await sql`select count(*)::int as n from attendance_punches where device_id = ${kioskId} and employee_id = ${priyaId}`) as any;
    expect(n).toBe(1);
    expect((await asKiosk("/punch", { descriptor: vec(1, 4) })).body.result).toBe("repeat");
    expect((await asKiosk("/punch", { descriptor: vec(9) })).body.result).toBe("unknown");
    expect((await asKiosk("/undo", { eventId })).status).toBe(200);
    const [{ m }] = (await sql`select count(*)::int as m from attendance_punches where device_id = ${kioskId} and employee_id = ${priyaId}`) as any;
    expect(m).toBe(0);
    const events = (await kunal.get("/admin/face-kiosk/events")).body;
    expect(events.map((e: any) => e.result)).toEqual(expect.arrayContaining(["undone", "repeat", "unknown"]));
    const shot = events.find((e: any) => e.result === "undone");
    expect(shot.hasPhoto).toBe(true);
    expect((await kunal.get(`/admin/face-kiosk/events/${shot.id}/photo`)).status).toBe(200);
  });

  it("stops when HR turns the kiosk off or the person removes their face", async () => {
    await priya.del("/ess/face");
    expect((await asKiosk("/punch", { descriptor: vec(1, 3) })).body.result).toBe("unknown");
    await kunal.req("PATCH", `/admin/face-kiosk/kiosks/${kioskId}`, { active: false });
    expect((await asKiosk("/punch", { descriptor: vec(2, 3) })).status).toBe(403);
    await kunal.req("PATCH", `/admin/face-kiosk/kiosks/${kioskId}`, { active: true });
    await sql`delete from tenant_addons where tenant_id = ${tenantId}`;
    expect((await asKiosk("/me")).status).toBe(403);
  });

  it("unpairs the old tablet when a new code is used", async () => {
    await sql`insert into tenant_addons (id, tenant_id, addon_key) values (gen_random_uuid()::text, ${tenantId}, 'addon.face_kiosk')`;
    const { code } = (await kunal.post(`/admin/face-kiosk/kiosks/${kioskId}/pair`)).body;
    const old = key;
    key = (await anon.post("/public/kiosk/pair", { code })).body.key;
    expect((await asKiosk("/me")).status).toBe(200);
    key = old;
    expect((await asKiosk("/me")).status).toBe(401);
  });
});
