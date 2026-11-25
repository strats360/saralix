import { buildApp } from "../src/app";
import { getDevMailer } from "../src/lib/context";
import type { Env } from "../src/env";

export const env: Env = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://hrms:hrms@localhost:5432/hrms_test",
  APP_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? btoa("k".repeat(32)),
  ENVIRONMENT: "test",
};

const app = buildApp();
export const mailer = getDevMailer();
export const PASSWORD = "Demo@12345";

export class Client {
  cookie = "";
  tenantId?: string;
  async req(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { Origin: env.APP_URL, ...extra };
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.tenantId) headers["X-Tenant-Id"] = this.tenantId;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await app.fetch(new Request(env.APP_URL + "/api" + path, { method, headers, body: payload }), env);
    const set = res.headers.getSetCookie();
    if (set.length) {
      const jar = new Map(this.cookie ? this.cookie.split("; ").map((c) => c.split("=") as [string, string]) : []);
      for (const s of set) {
        const [kv] = s.split(";");
        const [k, ...v] = kv!.split("=");
        jar.set(k!, v.join("="));
      }
      this.cookie = [...jar].filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("; ");
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  }
  /** GET a file: the raw response, for binary bodies (PDF, ZIP). */
  async file(path: string) {
    const headers: Record<string, string> = { Origin: env.APP_URL };
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.tenantId) headers["X-Tenant-Id"] = this.tenantId;
    const res = await app.fetch(new Request(env.APP_URL + "/api" + path, { headers }), env);
    return { status: res.status, headers: res.headers, raw: res };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown) => this.req("POST", p, b ?? {});
  patch = (p: string, b: unknown) => this.req("PATCH", p, b);
  del = (p: string) => this.req("DELETE", p);
}

export async function login(email: string, password = PASSWORD) {
  const c = new Client();
  const r = await c.post("/auth/sign-in/email", { email, password });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return c;
}

export function lastEmailTo(to: string) {
  return [...mailer.sent].reverse().find((m) => m.to === to);
}

/** The full self-serve sign-up: work email, the link from the email, sign in, then the company. */
export async function signUpCompany(input: { name: string; email: string; password: string; companyName: string; state?: string }) {
  const anon = new Client();
  const r = await anon.post("/public/signup", { name: input.name, email: input.email, password: input.password });
  if (r.status !== 201) throw new Error(`signup failed: ${r.status} ${JSON.stringify(r.body)}`);
  const mail = lastEmailTo(input.email.toLowerCase());
  const token = mail?.text.match(/token=([A-Za-z0-9_%-]+)/)?.[1];
  if (!token) throw new Error("no verification email");
  const ver = await anon.post("/public/signup/verify", { token: decodeURIComponent(token) });
  if (ver.status !== 200) throw new Error(`verify failed: ${ver.status} ${JSON.stringify(ver.body)}`);
  const c = await login(input.email, input.password);
  const co = await c.post("/me/company", { companyName: input.companyName, state: input.state ?? "Gujarat" });
  if (co.status !== 201) throw new Error(`company failed: ${co.status} ${JSON.stringify(co.body)}`);
  c.tenantId = co.body.tenantId;
  return c;
}
