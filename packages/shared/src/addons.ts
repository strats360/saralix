import { z } from "zod";

/**
 * Paid add-ons on top of a plan. Each one is a feature key that is off unless the company has
 * switched the add-on on (or the platform team grants it with a feature flag, say for a pilot).
 * Active add-ons are a line each on the monthly invoice.
 */
export const ADDON_KEYS = ["addon.ai_assistant", "addon.work_tools", "addon.face_kiosk", "addon.workflows"] as const;
export type AddonKey = (typeof ADDON_KEYS)[number];
export const ADDON_PRICING = ["per_employee", "flat"] as const;
export type AddonPricing = (typeof ADDON_PRICING)[number];

/** Starting catalogue. The platform team sets the real names and prices in the console. */
export const DEFAULT_ADDONS: { key: AddonKey; name: string; description: string; pricing: AddonPricing; price: number }[] = [
  { key: "addon.ai_assistant", name: "AI assistant", description: "Answers employees' questions about leave, pay and policies, explains payslips, and applies for leave for them.", pricing: "per_employee", price: 30 },
  { key: "addon.work_tools", name: "Sign in and work tools", description: "Sign in with Google or Microsoft, approvals and alerts in Slack and Microsoft Teams, and a connector for AI tools.", pricing: "per_employee", price: 20 },
  { key: "addon.face_kiosk", name: "Face attendance kiosk", description: "A shared tablet at the entrance that recognises faces for punch in and out.", pricing: "flat", price: 999 },
  { key: "addon.workflows", name: "Forms and workflows", description: "Your own request forms with approval steps, for anything HR doesn't cover out of the box.", pricing: "per_employee", price: 15 },
];

export const isAddonKey = (k: string): k is AddonKey => (ADDON_KEYS as readonly string[]).includes(k);

/** What an add-on costs for a month, before tax. */
export function addonCharge(a: { pricing: string; price: number }, seats: number, decimals = 2) {
  const raw = a.pricing === "flat" ? a.price : a.price * seats;
  return Math.round(raw * 10 ** decimals) / 10 ** decimals;
}

/** Billed for a period if it was on at any point in that month. */
export function addonBilledIn(t: { startedAt: Date | string; endedAt: Date | string | null }, period: string) {
  const start = `${period}-01`;
  const [y, m] = period.split("-").map(Number) as [number, number];
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const s = new Date(t.startedAt).toISOString().slice(0, 10);
  const e = t.endedAt ? new Date(t.endedAt).toISOString().slice(0, 10) : null;
  return s <= end && (!e || e >= start);
}

export const addonSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(""),
  pricing: z.enum(ADDON_PRICING),
  price: z.number().min(0).max(1_000_000),
  active: z.boolean().default(true),
});
