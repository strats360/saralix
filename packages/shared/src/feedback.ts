import { z } from "zod";

/**
 * Feedback between colleagues, any time of year, and 360 feedback inside a review.
 *
 * review: a manager or HR asks peers for feedback on someone in a review cycle. The manager
 *   and HR see who said what; the person sees the answers without names, once the review is
 *   shared and at least FEEDBACK_MIN people have answered.
 * request: someone asks colleagues for feedback about themselves. They see the answers with names.
 * given: someone gives feedback without being asked. "private" goes to the person and their
 *   manager; "manager" goes only to the manager (for something better said to them).
 */
export const FEEDBACK_KINDS = ["review", "request", "given"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_RELATIONS = ["peer", "report", "manager", "other"] as const;
export type FeedbackRelation = (typeof FEEDBACK_RELATIONS)[number];
export const FEEDBACK_RELATION_LABEL: Record<FeedbackRelation, string> = { peer: "Peer", report: "Reports to them", manager: "Their manager", other: "Works with them" };
export const FEEDBACK_VISIBILITY = ["private", "manager"] as const;
export type FeedbackVisibility = (typeof FEEDBACK_VISIBILITY)[number];
export const FEEDBACK_VISIBILITY_LABEL: Record<FeedbackVisibility, string> = { private: "Them and their manager", manager: "Only their manager" };

/** Fewest 360 answers before the person sees them (without names). */
export const FEEDBACK_MIN = 3;

const text = (min: number, msg: string) => z.string().trim().min(min, msg).max(3000);
const answer = z.object({
  strengths: text(10, "Say what they do well, in a sentence or two"),
  improvements: z.string().trim().max(3000).default(""),
});

export const giveFeedbackSchema = answer.extend({
  aboutEmployeeId: z.string().min(1, "Pick who it's about"),
  visibility: z.enum(FEEDBACK_VISIBILITY).default("private"),
});

export const askFeedbackSchema = z.object({
  fromEmployeeIds: z.array(z.string().min(1)).min(1, "Pick who to ask").max(10, "Ask up to 10 people at a time"),
  prompt: z.string().trim().max(500).default(""),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
});

export const reviewFeedbackRequestSchema = askFeedbackSchema.extend({
  relation: z.enum(FEEDBACK_RELATIONS).default("peer"),
});

export const answerFeedbackSchema = answer.extend({
  /** Only for 360 feedback: an overall 1 to 5. */
  rating: z.number().int().min(1).max(5).nullable().default(null),
});
