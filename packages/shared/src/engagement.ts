import { z } from "zod";

/**
 * Engagement: pulse surveys and polls, and kudos.
 *
 * Anonymous surveys never store who answered what. A separate list records only that someone
 * has answered, so they can't answer twice. Results by team are hidden until enough people in
 * that team have answered (ANONYMITY_MIN), so nobody can work out a single person's answers.
 */

export const QUESTION_TYPES = ["scale", "enps", "choice", "multi", "text"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  scale: "Rating, 1 to 5",
  enps: "Recommend score, 0 to 10",
  choice: "One choice",
  multi: "Several choices",
  text: "Written answer",
};

export const SURVEY_KINDS = ["pulse", "poll", "survey"] as const;
export type SurveyKind = (typeof SURVEY_KINDS)[number];
export const SURVEY_KIND_LABEL: Record<SurveyKind, string> = { pulse: "Pulse check", poll: "Poll", survey: "Survey" };

/** Fewest answers before a team's results are shown in an anonymous survey. */
export const ANONYMITY_MIN = 3;

export const questionSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    type: z.enum(QUESTION_TYPES),
    text: z.string().trim().min(3, "Write the question").max(300),
    options: z.array(z.string().trim().min(1, "Options can't be blank").max(120)).max(12).default([]),
    required: z.boolean().default(true),
  })
  .superRefine((q, ctx) => {
    if ((q.type === "choice" || q.type === "multi") && q.options.length < 2) ctx.addIssue({ code: "custom", path: ["options"], message: "Add at least two options" });
    if ((q.type === "choice" || q.type === "multi") && new Set(q.options.map((o) => o.toLowerCase())).size !== q.options.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Each option must be different" });
  });
export type Question = z.infer<typeof questionSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
export const surveySchema = z
  .object({
    title: z.string().trim().min(3, "Give it a title").max(150),
    description: z.string().trim().max(2000).default(""),
    kind: z.enum(SURVEY_KINDS).default("pulse"),
    anonymous: z.boolean().default(true),
    departmentIds: z.array(z.string()).default([]),
    branchIds: z.array(z.string()).default([]),
    questions: z.array(questionSchema).min(1, "Add at least one question").max(30, "Keep it to 30 questions or fewer"),
    closesOn: isoDate.nullable().default(null),
    /** Show the results to everyone it was sent to once it closes. */
    shareResults: z.boolean().default(false),
  })
  .superRefine((s, ctx) => {
    if (new Set(s.questions.map((q) => q.id)).size !== s.questions.length) ctx.addIssue({ code: "custom", path: ["questions"], message: "Each question needs its own id" });
  });
export type SurveyInput = z.infer<typeof surveySchema>;

export type Answer = number | string | string[];
export const responseSchema = z.object({ answers: z.record(z.string(), z.union([z.number(), z.string().max(4000), z.array(z.string().max(120)).max(12)])) });

/** Checks a set of answers against the questions. Returns the cleaned answers or an error message. */
export function checkAnswers(questions: Question[], raw: Record<string, Answer>): { ok: true; answers: Record<string, Answer> } | { ok: false; error: string } {
  const out: Record<string, Answer> = {};
  for (const q of questions) {
    const a = raw[q.id];
    const blank = a === undefined || a === null || a === "" || (Array.isArray(a) && a.length === 0);
    if (blank) {
      if (q.required) return { ok: false, error: `Answer "${q.text}"` };
      continue;
    }
    switch (q.type) {
      case "scale":
      case "enps": {
        const max = q.type === "scale" ? 5 : 10;
        const min = q.type === "scale" ? 1 : 0;
        if (typeof a !== "number" || !Number.isInteger(a) || a < min || a > max) return { ok: false, error: `Pick ${min} to ${max} for "${q.text}"` };
        out[q.id] = a;
        break;
      }
      case "choice":
        if (typeof a !== "string" || !q.options.includes(a)) return { ok: false, error: `Pick one of the options for "${q.text}"` };
        out[q.id] = a;
        break;
      case "multi": {
        if (!Array.isArray(a) || a.some((x) => !q.options.includes(x))) return { ok: false, error: `Pick from the options for "${q.text}"` };
        out[q.id] = [...new Set(a)];
        break;
      }
      case "text":
        if (typeof a !== "string") return { ok: false, error: `Write an answer for "${q.text}"` };
        if (a.trim()) out[q.id] = a.trim().slice(0, 4000);
        else if (q.required) return { ok: false, error: `Answer "${q.text}"` };
        break;
    }
  }
  return { ok: true, answers: out };
}

/** Employee Net Promoter Score: % who give 9 or 10, minus % who give 0 to 6. From -100 to 100. */
export function enps(scores: number[]) {
  if (!scores.length) return null;
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  return Math.round(((promoters - detractors) / scores.length) * 100);
}

export type QuestionResult =
  | { id: string; type: "scale"; text: string; answered: number; average: number | null; counts: number[] }
  | { id: string; type: "enps"; text: string; answered: number; score: number | null; promoters: number; passives: number; detractors: number; counts: number[] }
  | { id: string; type: "choice" | "multi"; text: string; answered: number; options: { label: string; count: number }[] }
  | { id: string; type: "text"; text: string; answered: number; comments: string[] };

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Adds up the answers to each question. */
export function summarise(questions: Question[], responses: Record<string, Answer>[]): QuestionResult[] {
  return questions.map((q): QuestionResult => {
    const vals = responses.map((r) => r[q.id]).filter((a) => a !== undefined);
    if (q.type === "scale") {
      const nums = vals.filter((a): a is number => typeof a === "number");
      const counts = [1, 2, 3, 4, 5].map((n) => nums.filter((x) => x === n).length);
      return { id: q.id, type: "scale", text: q.text, answered: nums.length, average: nums.length ? round1(nums.reduce((s, x) => s + x, 0) / nums.length) : null, counts };
    }
    if (q.type === "enps") {
      const nums = vals.filter((a): a is number => typeof a === "number");
      const counts = Array.from({ length: 11 }, (_, n) => nums.filter((x) => x === n).length);
      return { id: q.id, type: "enps", text: q.text, answered: nums.length, score: enps(nums), promoters: nums.filter((s) => s >= 9).length, passives: nums.filter((s) => s === 7 || s === 8).length, detractors: nums.filter((s) => s <= 6).length, counts };
    }
    if (q.type === "choice" || q.type === "multi") {
      const picked = vals.flatMap((a) => (Array.isArray(a) ? a : typeof a === "string" ? [a] : []));
      return { id: q.id, type: q.type, text: q.text, answered: vals.length, options: q.options.map((label) => ({ label, count: picked.filter((p) => p === label).length })) };
    }
    const comments = vals.filter((a): a is string => typeof a === "string" && !!a.trim());
    return { id: q.id, type: "text", text: q.text, answered: comments.length, comments };
  });
}

/** A one-line headline for a question: the average, the score, or the top choice. */
export function headline(r: QuestionResult): string {
  if (r.type === "scale") return r.average === null ? "No answers" : `${r.average} out of 5`;
  if (r.type === "enps") return r.score === null ? "No answers" : `${r.score > 0 ? "+" : ""}${r.score}`;
  if (r.type === "text") return `${r.answered} comment${r.answered === 1 ? "" : "s"}`;
  const top = [...r.options].sort((a, b) => b.count - a.count)[0];
  return top && top.count ? `${top.label} (${Math.round((top.count / Math.max(1, r.answered)) * 100)}%)` : "No answers";
}

/** Ready-made surveys HR can start from. */
export const SURVEY_TEMPLATES: { key: string; label: string; survey: Omit<SurveyInput, "departmentIds" | "branchIds" | "closesOn" | "shareResults"> }[] = [
  {
    key: "enps",
    label: "Would you recommend us? (eNPS)",
    survey: {
      title: "Would you recommend working here?",
      description: "Two quick questions. Your answers are anonymous.",
      kind: "pulse",
      anonymous: true,
      questions: [
        { id: "q1", type: "enps", text: "How likely are you to recommend this company as a place to work?", options: [], required: true },
        { id: "q2", type: "text", text: "What's the main reason for your score?", options: [], required: false },
      ],
    },
  },
  {
    key: "monthly",
    label: "Monthly pulse",
    survey: {
      title: "Monthly pulse",
      description: "Five quick questions about how work is going. Your answers are anonymous.",
      kind: "pulse",
      anonymous: true,
      questions: [
        { id: "q1", type: "scale", text: "I feel good about my work this month.", options: [], required: true },
        { id: "q2", type: "scale", text: "My manager supports me when I need it.", options: [], required: true },
        { id: "q3", type: "scale", text: "I have what I need to do my job well.", options: [], required: true },
        { id: "q4", type: "scale", text: "My workload is manageable.", options: [], required: true },
        { id: "q5", type: "text", text: "Is there anything we could do better?", options: [], required: false },
      ],
    },
  },
  {
    key: "poll",
    label: "Quick poll",
    survey: {
      title: "Team outing: where should we go?",
      description: "",
      kind: "poll",
      anonymous: false,
      questions: [{ id: "q1", type: "choice", text: "Pick the one you like best", options: ["Option 1", "Option 2", "Option 3"], required: true }],
    },
  },
  {
    key: "onboarding",
    label: "New joiner check in",
    survey: {
      title: "How are your first weeks going?",
      description: "Tell us how joining has gone so we can make it better for the next person.",
      kind: "survey",
      anonymous: false,
      questions: [
        { id: "q1", type: "scale", text: "Joining was well organised.", options: [], required: true },
        { id: "q2", type: "scale", text: "I know what's expected of me.", options: [], required: true },
        { id: "q3", type: "choice", text: "Did you have your laptop and logins on day one?", options: ["Yes", "Some of them", "No"], required: true },
        { id: "q4", type: "text", text: "What would have helped you most?", options: [], required: false },
      ],
    },
  },
];

/* ---------------- kudos ---------------- */

export interface CompanyValue {
  key: string;
  label: string;
  emoji: string;
}

export const DEFAULT_VALUES: CompanyValue[] = [
  { key: "teamwork", label: "Teamwork", emoji: "🤝" },
  { key: "ownership", label: "Ownership", emoji: "🎯" },
  { key: "customer", label: "Customer first", emoji: "💚" },
  { key: "learning", label: "Always learning", emoji: "📚" },
  { key: "extra_mile", label: "Went the extra mile", emoji: "🚀" },
];

export const valuesSchema = z.object({
  values: z
    .array(z.object({ key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers and _"), label: z.string().trim().min(2, "Name the value").max(40), emoji: z.string().trim().min(1).max(8) }))
    .min(1, "Keep at least one value")
    .max(12, "Keep it to 12 values or fewer")
    .refine((v) => new Set(v.map((x) => x.key)).size === v.length, "Each value needs its own key"),
  kudosEnabled: z.boolean().default(true),
});

export const kudosSchema = z.object({
  toEmployeeIds: z.array(z.string().min(1)).min(1, "Pick who it's for").max(10, "Up to 10 people at a time"),
  value: z.string().min(1, "Pick a value"),
  message: z.string().trim().min(5, "Say what they did").max(500, "Keep it to 500 characters"),
});

/** Turns a label into a value key: "Customer first" to "customer_first". */
export const valueKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "value";
