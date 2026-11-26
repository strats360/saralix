import { z } from "zod";

/**
 * OKRs: objectives with measurable key results, for the company, a team or a person, by
 * quarter of the Indian financial year (Q1 is April to June). An objective can line up under
 * another one, so people see how their work feeds the company's goals.
 */

export const OKR_LEVELS = ["company", "team", "individual"] as const;
export type OkrLevel = (typeof OKR_LEVELS)[number];
export const OKR_LEVEL_LABEL: Record<OkrLevel, string> = { company: "Company", team: "Team", individual: "Personal" };

export const KR_KINDS = ["number", "percent", "currency", "done"] as const;
export type KrKind = (typeof KR_KINDS)[number];
export const KR_KIND_LABEL: Record<KrKind, string> = { number: "Number", percent: "Percentage", currency: "Amount in ₹", done: "Done or not" };

export const CONFIDENCE = ["on_track", "at_risk", "off_track"] as const;
export type Confidence = (typeof CONFIDENCE)[number];
export const CONFIDENCE_LABEL: Record<Confidence | "not_started" | "done", string> = { on_track: "On track", at_risk: "At risk", off_track: "Off track", not_started: "No check in yet", done: "Done" };

/** "FY2026-27 Q3" for October to December 2026. A whole year is "FY2026-27". */
export function periodOf(date: string, quarterly = true) {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const fy = m >= 4 ? y : y - 1;
  const name = `FY${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
  return quarterly ? `${name} Q${Math.floor(((m + 8) % 12) / 3) + 1}` : name;
}

/** First and last day of a period. */
export function periodRange(period: string): { start: string; end: string } {
  const m = /^FY(\d{4})-\d{2}(?: Q([1-4]))?$/.exec(period);
  if (!m) throw new Error(`Not a period: ${period}`);
  const fy = Number(m[1]);
  if (!m[2]) return { start: `${fy}-04-01`, end: `${fy + 1}-03-31` };
  const q = Number(m[2]);
  const startMonth = ((q - 1) * 3 + 3) % 12 + 1; // 4, 7, 10, 1
  const year = q === 4 ? fy + 1 : fy;
  const endMonth = startMonth + 2;
  const last = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  return { start: `${year}-${String(startMonth).padStart(2, "0")}-01`, end: `${year}-${String(endMonth).padStart(2, "0")}-${last}` };
}

/** The periods to offer: the year, and its four quarters, for this year and the next. */
export function periodChoices(today: string) {
  const fy = Number(periodOf(today, false).slice(2, 6));
  return [fy, fy + 1].flatMap((y) => {
    const name = `FY${y}-${String((y + 1) % 100).padStart(2, "0")}`;
    return [name, `${name} Q1`, `${name} Q2`, `${name} Q3`, `${name} Q4`];
  });
}

export interface KrValues {
  kind: KrKind;
  start: number;
  target: number;
  current: number;
}

/** How far a key result has got, 0 to 100. Works whether the target is above or below the start. */
export function krProgress(k: KrValues) {
  if (k.kind === "done") return k.current >= 1 ? 100 : 0;
  if (k.target === k.start) return k.current === k.target ? 100 : 0;
  const p = ((k.current - k.start) / (k.target - k.start)) * 100;
  return Math.round(Math.min(100, Math.max(0, p)));
}

/** An objective's progress: the average of its key results. */
export const objectiveProgress = (krs: KrValues[]) => (krs.length ? Math.round(krs.reduce((s, k) => s + krProgress(k), 0) / krs.length) : 0);

/** Shows a key result value the way it was set up: "42%", "₹12.5 L", "18", "Done". */
export function fmtKr(kind: KrKind, v: number, unit?: string | null) {
  if (kind === "done") return v >= 1 ? "Done" : "Not done";
  if (kind === "percent") return `${Math.round(v * 10) / 10}%`;
  if (kind === "currency") {
    if (Math.abs(v) >= 1e7) return `₹${Math.round(v / 1e5) / 100} Cr`;
    if (Math.abs(v) >= 1e5) return `₹${Math.round(v / 1e3) / 100} L`;
    return `₹${v.toLocaleString("en-IN")}`;
  }
  return `${v.toLocaleString("en-IN")}${unit ? ` ${unit}` : ""}`;
}

const periodSchema = z.string().regex(/^FY\d{4}-\d{2}( Q[1-4])?$/, "Pick a period");

export const keyResultSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().trim().min(3, "Describe the key result").max(200),
    kind: z.enum(KR_KINDS).default("number"),
    start: z.number().finite().default(0),
    target: z.number().finite(),
    unit: z.string().trim().max(20).nullable().default(null),
  })
  .refine((k) => k.kind === "done" || k.target !== k.start, { message: "The target has to differ from the start", path: ["target"] });

export const objectiveSchema = z
  .object({
    level: z.enum(OKR_LEVELS),
    title: z.string().trim().min(3, "Name the objective").max(200),
    description: z.string().trim().max(2000).default(""),
    period: periodSchema,
    ownerId: z.string().nullable().default(null),
    departmentId: z.string().nullable().default(null),
    parentId: z.string().nullable().default(null),
    keyResults: z.array(keyResultSchema).min(1, "Add at least one key result").max(6, "Keep it to 6 key results or fewer"),
  })
  .superRefine((o, ctx) => {
    if (o.level === "team" && !o.departmentId) ctx.addIssue({ code: "custom", path: ["departmentId"], message: "Pick the team" });
    if (o.level === "individual" && !o.ownerId) ctx.addIssue({ code: "custom", path: ["ownerId"], message: "Pick whose objective it is" });
  });
export type ObjectiveInput = z.infer<typeof objectiveSchema>;

export const checkinSchema = z.object({
  values: z.record(z.string(), z.number().finite()),
  confidence: z.enum(CONFIDENCE),
  note: z.string().trim().max(1000).default(""),
});
