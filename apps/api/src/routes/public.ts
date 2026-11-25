import { Hono, type Context } from "hono";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  adminInvites,
  departments,
  designations,
  branches,
  employees,
  memberships,
  onboardingInvites,
  roles,
  tenants,
} from "@hrms/db";
import { accountSignupSchema, onboardingAcceptSchema, randomToken, sha256Hex } from "@hrms/shared";
import { hashPassword } from "better-auth/crypto";
import { account, pendingSignups, user } from "@hrms/db";
import { z } from "zod";
import { layout } from "../lib/email";
import type { AppEnv } from "../env";
import { v } from "../lib/validate";
import { badRequest, conflict, notFound } from "../lib/errors";
import { claimLogin, findUserByEmail, upsertLogin } from "../services/users";
import { provisionTenant } from "../services/provisioning";
import { signInAndRespond } from "../lib/signin";
import { audit } from "../lib/audit";

export const publicRoutes = new Hono<AppEnv>();

const SIGNUP_LINK_HOURS = 24;

async function sendSignupLink(c: Context<AppEnv>, to: string, name: string, token: string) {
  const url = `${c.env.APP_URL}/signup/verify?token=${encodeURIComponent(token)}`;
  const { html, text } = layout({
    company: "Saralix",
    heading: "Confirm your email",
    paragraphs: [`Hi ${name},`, `Confirm this is your work email to finish creating your Saralix account. The link works for ${SIGNUP_LINK_HOURS} hours.`, "If you didn't sign up, ignore this email. No account is created until the link is opened."],
    cta: { label: "Confirm my email", url },
  });
  await c.get("mailer").send({ to, subject: "Confirm your email for Saralix", html, text });
}

/**
 * Self-serve sign-up, step 1: a work email and a password. Nothing is created until the email
 * link is opened; then the person signs in and sets up their company.
 */
publicRoutes.post("/signup", v("json", accountSignupSchema), async (c) => {
  const input = c.req.valid("json");
  const db = c.get("db");
  if (await findUserByEmail(db, input.email)) throw conflict("An account with this email already exists. Sign in instead.");
  const [recent] = await db.select({ at: pendingSignups.createdAt }).from(pendingSignups).where(and(eq(pendingSignups.email, input.email), isNull(pendingSignups.verifiedAt), gt(pendingSignups.createdAt, new Date(Date.now() - 60_000))));
  if (recent) throw badRequest("We've just sent you a link. Check your inbox, or try again in a minute.");
  // a new sign-up replaces any earlier link for the same email
  await db.delete(pendingSignups).where(and(eq(pendingSignups.email, input.email), isNull(pendingSignups.verifiedAt)));
  const token = randomToken(32);
  await db.insert(pendingSignups).values({ id: crypto.randomUUID(), email: input.email, name: input.name, phone: input.phone ?? null, passwordHash: await hashPassword(input.password), tokenHash: await sha256Hex(token), expiresAt: new Date(Date.now() + SIGNUP_LINK_HOURS * 3600_000) });
  await sendSignupLink(c, input.email, input.name, token);
  return c.json({ sent: true, email: input.email }, 201);
});

/** Send the link again. Answers the same whether or not there's a sign-up, so it doesn't reveal accounts. */
publicRoutes.post("/signup/resend", v("json", z.object({ email: z.string().trim().toLowerCase().email() })), async (c) => {
  const db = c.get("db");
  const { email } = c.req.valid("json");
  const [p] = await db.select().from(pendingSignups).where(and(eq(pendingSignups.email, email), isNull(pendingSignups.verifiedAt)));
  if (p && Date.now() - p.createdAt.getTime() > 60_000) {
    const token = randomToken(32);
    await db.update(pendingSignups).set({ tokenHash: await sha256Hex(token), expiresAt: new Date(Date.now() + SIGNUP_LINK_HOURS * 3600_000), createdAt: new Date() }).where(eq(pendingSignups.id, p.id));
    await sendSignupLink(c, email, p.name, token);
  }
  return c.json({ sent: true });
});

/** Step 2: the link from the email. Creates the login, already verified, with the password chosen at sign-up. */
publicRoutes.post("/signup/verify", v("json", z.object({ token: z.string().min(20).max(200) })), async (c) => {
  const db = c.get("db");
  const [p] = await db.select().from(pendingSignups).where(eq(pendingSignups.tokenHash, await sha256Hex(c.req.valid("json").token)));
  if (!p) throw badRequest("This link isn't valid. Sign up again to get a new one.");
  if (p.verifiedAt) return c.json({ verified: true, email: p.email });
  if (p.expiresAt < new Date()) throw badRequest("This link has expired. Sign up again to get a new one.");
  const existing = await findUserByEmail(db, p.email);
  await db.transaction(async (tx) => {
    if (!existing) {
      const id = crypto.randomUUID();
      await tx.insert(user).values({ id, email: p.email, name: p.name, emailVerified: true });
      await tx.insert(account).values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: p.passwordHash });
    }
    await tx.update(pendingSignups).set({ verifiedAt: new Date() }).where(eq(pendingSignups.id, p.id));
  });
  return c.json({ verified: true, email: p.email, existing: !!existing });
});

async function findInvite(c: Context<AppEnv>, token: string) {
  const db = c.get("db");
  const hash = await sha256Hex(token);
  const [row] = await db
    .select({ inv: onboardingInvites, emp: employees, tenant: tenants })
    .from(onboardingInvites)
    .innerJoin(employees, eq(employees.id, onboardingInvites.employeeId))
    .innerJoin(tenants, eq(tenants.id, onboardingInvites.tenantId))
    .where(eq(onboardingInvites.tokenHash, hash));
  return row ?? null;
}

/** Details shown on the invite landing page. Marks the invite as opened. */
publicRoutes.get("/onboarding/:token", async (c) => {
  const row = await findInvite(c, c.req.param("token"));
  if (!row) throw notFound("Invite");
  const db = c.get("db");
  const expired = row.inv.expiresAt < new Date();
  if (!expired && row.inv.status === "invited") {
    await db.update(onboardingInvites).set({ status: "opened", openedAt: new Date() }).where(eq(onboardingInvites.id, row.inv.id));
  }
  const [dept] = row.emp.departmentId ? await db.select().from(departments).where(eq(departments.id, row.emp.departmentId)) : [];
  const [desig] = row.emp.designationId ? await db.select().from(designations).where(eq(designations.id, row.emp.designationId)) : [];
  const [branch] = row.emp.branchId ? await db.select().from(branches).where(eq(branches.id, row.emp.branchId)) : [];
  const [mgr] = row.emp.managerId ? await db.select({ name: employees.fullName }).from(employees).where(eq(employees.id, row.emp.managerId)) : [];
  return c.json({
    companyName: row.tenant.name,
    employeeName: row.emp.fullName,
    firstName: row.emp.firstName,
    email: row.inv.email,
    designation: desig?.name ?? null,
    department: dept?.name ?? null,
    branch: branch?.name ?? null,
    manager: mgr?.name ?? null,
    dateOfJoining: row.emp.dateOfJoining,
    expiresAt: row.inv.expiresAt,
    expired,
    status: row.inv.status,
    hasAccount: !!(await findUserByEmail(db, row.inv.email)),
  });
});

/** Accept invite: set a password, create the login and link it to the employee. */
publicRoutes.post("/onboarding/accept", v("json", onboardingAcceptSchema), async (c) => {
  const { token, password } = c.req.valid("json");
  const row = await findInvite(c, token);
  if (!row) throw notFound("Invite");
  if (row.inv.expiresAt < new Date()) throw badRequest("This invite has expired. Ask HR to resend it.");
  if (row.inv.status === "verified") throw badRequest("You've already completed onboarding. Sign in instead.");
  const db = c.get("db");
  const userId = await claimLogin(db, { email: row.inv.email, name: row.emp.fullName, password, verified: true });
  await db.update(employees).set({ userId }).where(eq(employees.id, row.emp.id));
  const [existing] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.tenantId, row.tenant.id), eq(memberships.userId, userId)));
  if (existing) {
    await db.update(memberships).set({ employeeId: row.emp.id, status: "active" }).where(eq(memberships.id, existing.id));
  } else {
    await db.insert(memberships).values({ tenantId: row.tenant.id, userId, employeeId: row.emp.id, status: "active" });
  }
  const steps = new Set(row.inv.completedSteps);
  steps.add("account");
  await db
    .update(onboardingInvites)
    .set({
      status: row.inv.status === "submitted" ? "submitted" : "in_progress",
      completedSteps: [...steps],
      progress: Math.max(row.inv.progress, 15),
    })
    .where(eq(onboardingInvites.id, row.inv.id));
  return signInAndRespond(c, row.inv.email, password, { tenantId: row.tenant.id });
});

/** Admin invites (e.g. an external CA or a new HR user). */
publicRoutes.get("/admin-invite/:token", async (c) => {
  const db = c.get("db");
  const hash = await sha256Hex(c.req.param("token"));
  const [row] = await db
    .select({ inv: adminInvites, tenantName: tenants.name, roleName: roles.name })
    .from(adminInvites)
    .innerJoin(tenants, eq(tenants.id, adminInvites.tenantId))
    .leftJoin(roles, eq(roles.id, adminInvites.roleId))
    .where(and(eq(adminInvites.tokenHash, hash), isNull(adminInvites.acceptedAt), gt(adminInvites.expiresAt, new Date())));
  if (!row) throw notFound("Invite");
  const existing = await findUserByEmail(db, row.inv.email);
  return c.json({ companyName: row.tenantName, role: row.roleName, name: row.inv.name, email: row.inv.email, hasAccount: !!existing });
});

publicRoutes.post("/admin-invite/accept", v("json", onboardingAcceptSchema), async (c) => {
  const { token, password } = c.req.valid("json");
  const db = c.get("db");
  const hash = await sha256Hex(token);
  const [inv] = await db
    .select()
    .from(adminInvites)
    .where(and(eq(adminInvites.tokenHash, hash), isNull(adminInvites.acceptedAt), gt(adminInvites.expiresAt, new Date())));
  if (!inv) throw notFound("Invite");
  const userId = await claimLogin(db, { email: inv.email, name: inv.name, password, verified: true });
  const [m] = await db.select().from(memberships).where(and(eq(memberships.tenantId, inv.tenantId), eq(memberships.userId, userId)));
  if (m) {
    await db.update(memberships).set({ roleId: inv.roleId, status: "active", scope: inv.scope }).where(eq(memberships.id, m.id));
  } else {
    const [emp] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.tenantId, inv.tenantId), eq(employees.workEmail, inv.email)));
    await db.insert(memberships).values({ tenantId: inv.tenantId, userId, roleId: inv.roleId, scope: inv.scope, employeeId: emp?.id ?? null, status: "active" });
  }
  await db.update(adminInvites).set({ acceptedAt: new Date() }).where(eq(adminInvites.id, inv.id));
  return signInAndRespond(c, inv.email, password, { tenantId: inv.tenantId });
});
