import { and, inArray, isNull } from "drizzle-orm";
import { featureFlags, tenantAddons, type Database } from "@hrms/db";
import { evaluateFlags, type FlagRule } from "@hrms/shared";

/** Flags change rarely; cache them per isolate for a short time. Writes clear the cache. */
let cache: { at: number; flags: FlagRule[] } | null = null;
const TTL = 30_000;

export function invalidateFlags() {
  cache = null;
}

export async function loadFlags(db: Database): Promise<FlagRule[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.flags;
  const rows = await db.select().from(featureFlags);
  cache = { at: Date.now(), flags: rows };
  return rows;
}

/** Add-ons each tenant has switched on. */
export async function activeAddons(db: Database, tenantIds: string[]) {
  const out = new Map<string, string[]>();
  if (!tenantIds.length) return out;
  const rows = await db.select({ t: tenantAddons.tenantId, k: tenantAddons.addonKey }).from(tenantAddons).where(and(inArray(tenantAddons.tenantId, tenantIds), isNull(tenantAddons.endedAt)));
  for (const r of rows) out.set(r.t, [...(out.get(r.t) ?? []), r.k]);
  return out;
}

export async function featuresFor(db: Database, tenant: { id: string; plan: string }) {
  const [flags, addons] = await Promise.all([loadFlags(db), activeAddons(db, [tenant.id])]);
  return evaluateFlags(flags, tenant, addons.get(tenant.id) ?? []);
}
