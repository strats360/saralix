import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { employees, legalEntities, memberships, platformStaff, roles, tenants, user } from "@hrms/db";
import type { AppEnv } from "../env";
import { v } from "../lib/validate";
import { badRequest, forbidden } from "../lib/errors";
import { audit } from "../lib/audit";
import { provisionTenant } from "../services/provisioning";
import { loadFlags } from "../services/flags";
import { activeAccess } from "../services/support";
import { companyCreateSchema, evaluateFlags, readTwoFactorPolicy, twoFactorRequired } from "@hrms/shared";

export const meRoutes = new Hono<AppEnv>();

/** Who am I: memberships (tenants + role permissions) and platform staff role. */
meRoutes.get("/", async (c) => {
  const s = c.get("session")!;
  const db = c.get("db");
  const rows = await db
    .select({
      membershipId: memberships.id,
      status: memberships.status,
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantCode: tenants.code,
      tenantStatus: tenants.status,
      plan: tenants.plan,
      settings: tenants.settings,
      setupCompletedAt: tenants.setupCompletedAt,
      kycStatus: tenants.kycStatus,
      roleId: roles.id,
      roleName: roles.name,
      permissions: roles.permissions,
      employeeId: memberships.employeeId,
      employeeName: employees.fullName,
      employeeCode: employees.employeeCode,
      designationId: employees.designationId,
      timeZone: legalEntities.timeZone,
      currency: legalEntities.currency,
      country: legalEntities.country,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .leftJoin(roles, eq(roles.id, memberships.roleId))
    .leftJoin(employees, eq(employees.id, memberships.employeeId))
    // the default entity's zone and currency drive dates and money in the app
    .leftJoin(legalEntities, and(eq(legalEntities.tenantId, tenants.id), eq(legalEntities.isDefault, true)))
    .where(eq(memberships.userId, s.userId));
  const [staff] = await db.select().from(platformStaff).where(eq(platformStaff.userId, s.userId));
  const [u] = await db.select({ emailVerified: user.emailVerified }).from(user).where(eq(user.id, s.userId));

  const flags = await loadFlags(db);

  // touch last-active (best effort)
  await db.update(memberships).set({ lastActiveAt: new Date() }).where(eq(memberships.userId, s.userId));

  // platform support: running read-only sessions show up as extra (view-only) companies
  const support = staff?.status === "active" ? await activeAccess(db, s.userId) : [];
  const supportTenants = support.length ? await db.select({ id: tenants.id, name: tenants.name, code: tenants.code, status: tenants.status, plan: tenants.plan }).from(tenants) : [];
  return c.json({
    user: { id: s.userId, name: s.name, email: s.email, twoFactorEnabled: s.twoFactorEnabled, emailVerified: !!u?.emailVerified },
    // a verified sign-up with no company yet goes on to create one
    canCreateCompany: !!u?.emailVerified && !rows.length && staff?.status !== "active",
    supportSessions: support.map((a) => {
      const t = supportTenants.find((x) => x.id === a.access.tenantId)!;
      return { tenantId: t.id, tenantName: t.name, tenantCode: t.code, tenantStatus: t.status, plan: t.plan, features: evaluateFlags(flags, { id: t.id, plan: t.plan }), ticketId: a.access.ticketId, ticketNumber: a.number, accessId: a.access.id, expiresAt: a.access.expiresAt };
    }),
    platformRole: staff?.status === "active" ? staff.role : null,
    // which site this is, so platform staff know whose customers they're looking at
    instance: staff?.status === "active" ? { key: c.env.INSTANCE_KEY ?? "local", name: c.env.INSTANCE_NAME ?? "Saralix (local)", region: c.env.INSTANCE_REGION ?? null } : undefined,
    memberships: rows
      .filter((r) => r.status === "active")
      .map((r) => ({
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        tenantCode: r.tenantCode,
        tenantStatus: r.tenantStatus,
        setupComplete: !!r.setupCompletedAt,
        kycStatus: r.kycStatus,
        roleId: r.roleId,
        roleName: r.roleName,
        permissions: r.permissions ?? {},
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        employeeCode: r.employeeCode,
        plan: r.plan,
        timeZone: r.timeZone ?? "Asia/Kolkata",
        currency: r.currency ?? "INR",
        country: r.country ?? "IN",
        features: evaluateFlags(flags, { id: r.tenantId, plan: r.plan }),
        twoFactorRequired: twoFactorRequired(readTwoFactorPolicy(r.settings), !!r.roleId),
      })),
  });
});

/**
 * Sign-up, step 3: a signed-in person with a verified email and no company creates theirs and
 * becomes its super admin. Everything else is set up later from the dashboard checklist.
 */
meRoutes.post("/company", v("json", companyCreateSchema), async (c) => {
  const s = c.get("session")!;
  const db = c.get("db");
  const b = c.req.valid("json");
  const [u] = await db.select({ emailVerified: user.emailVerified }).from(user).where(eq(user.id, s.userId));
  if (!u?.emailVerified) throw forbidden("Confirm your email first. Check your inbox for the link.");
  const [existing] = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, s.userId)).limit(1);
  if (existing) throw badRequest("You already belong to a company. Ask its admin, or contact Saralix support to add another.");
  const { tenant } = await provisionTenant(db, { name: b.companyName, legalName: b.legalName ?? b.companyName, state: b.state, ownerUserId: s.userId });
  await db
    .update(tenants)
    .set({ contactEmail: s.email, kycStatus: "draft", settings: sql`${tenants.settings} || ${JSON.stringify({ signup: { role: b.role ?? null, companySize: b.companySize ?? null } })}::jsonb` })
    .where(eq(tenants.id, tenant.id));
  await audit(c, { tenantId: tenant.id, action: "tenant.signup", entity: "tenant", entityId: tenant.id, summary: `${b.companyName} signed up` });
  return c.json({ tenantId: tenant.id }, 201);
});
