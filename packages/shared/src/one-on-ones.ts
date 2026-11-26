import { z } from "zod";

/**
 * 1:1 meetings between a manager and someone who reports to them. Both add to the agenda and
 * the shared notes; each also has private notes the other never sees. Action items have an
 * owner, and anything not done carries over to the next meeting when it repeats.
 */
export const ONE_ON_ONE_REPEAT = ["none", "weekly", "biweekly", "monthly"] as const;
export type OneOnOneRepeat = (typeof ONE_ON_ONE_REPEAT)[number];
export const ONE_ON_ONE_REPEAT_LABEL: Record<OneOnOneRepeat, string> = { none: "Just once", weekly: "Every week", biweekly: "Every two weeks", monthly: "Every month" };

export interface AgendaItem { id: string; text: string; by: "manager" | "employee"; done: boolean }
export interface ActionItem { id: string; text: string; owner: "manager" | "employee"; due: string | null; done: boolean }

/** When the next meeting in a series falls. */
export function nextMeeting(at: Date, repeat: OneOnOneRepeat): Date | null {
  if (repeat === "none") return null;
  const d = new Date(at);
  if (repeat === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (repeat === "biweekly") d.setUTCDate(d.getUTCDate() + 14);
  else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d;
}

/** What carries over to the next meeting: agenda items not covered, and actions not done. */
export function carryOver(agenda: AgendaItem[], actions: ActionItem[]) {
  return { agenda: agenda.filter((a) => !a.done), actions: actions.filter((a) => !a.done) };
}

const item = z.string().trim().min(2, "Write something").max(500);
export const agendaSchema = z.array(z.object({ id: z.string().min(1).max(40), text: item, by: z.enum(["manager", "employee"]), done: z.boolean().default(false) })).max(40);
export const actionsSchema = z.array(z.object({ id: z.string().min(1).max(40), text: item, owner: z.enum(["manager", "employee"]), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null), done: z.boolean().default(false) })).max(40);

export const scheduleOneOnOneSchema = z.object({
  withEmployeeId: z.string().min(1, "Pick who it's with"),
  scheduledFor: z.iso.datetime({ offset: true }),
  repeat: z.enum(ONE_ON_ONE_REPEAT).default("biweekly"),
  agenda: z.array(item).max(20).default([]),
});

export const updateOneOnOneSchema = z.object({
  scheduledFor: z.iso.datetime({ offset: true }).optional(),
  repeat: z.enum(ONE_ON_ONE_REPEAT).optional(),
  sharedNotes: z.string().max(20000).optional(),
  myNotes: z.string().max(20000).optional(),
  agenda: agendaSchema.optional(),
  actions: actionsSchema.optional(),
});
