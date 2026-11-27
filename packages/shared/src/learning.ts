import { z } from "zod";

/**
 * Learning: short courses (lessons, then an optional quiz) and policies to read and confirm.
 * HR publishes one for everyone or chosen teams; people who join later get it too. Each person
 * has a due date counted from when it was assigned to them.
 */
export const COURSE_KINDS = ["course", "policy"] as const;
export type CourseKind = (typeof COURSE_KINDS)[number];
export const COURSE_KIND_LABEL: Record<CourseKind, string> = { course: "Course", policy: "Policy to read and confirm" };

export const lessonSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().trim().min(2, "Name the lesson").max(150),
  body: z.string().trim().max(20000).default(""),
  /** A YouTube or Vimeo link, shown as a link to watch. */
  videoUrl: z.url("Enter a full link").max(500).nullable().default(null),
});
export const quizQuestionSchema = z
  .object({
    id: z.string().min(1).max(40),
    question: z.string().trim().min(3, "Write the question").max(300),
    options: z.array(z.string().trim().min(1, "Options can't be blank").max(200)).min(2, "Give at least two options").max(6),
    answer: z.number().int().min(0),
  })
  .refine((q) => q.answer < q.options.length, { message: "Pick the right answer", path: ["answer"] });
export type Lesson = z.infer<typeof lessonSchema>;
export type QuizQuestion = z.infer<typeof quizQuestionSchema>;

export const courseSchema = z
  .object({
    kind: z.enum(COURSE_KINDS).default("course"),
    title: z.string().trim().min(3, "Give it a title").max(150),
    description: z.string().trim().max(2000).default(""),
    lessons: z.array(lessonSchema).max(30).default([]),
    quiz: z.array(quizQuestionSchema).max(30).default([]),
    /** Percentage of quiz answers needed to pass. */
    passMark: z.number().int().min(0).max(100).default(70),
    /** What people confirm for a policy. */
    acknowledgement: z.string().trim().max(500).default("I have read and understood this policy, and I will follow it."),
    departmentIds: z.array(z.string()).default([]),
    branchIds: z.array(z.string()).default([]),
    /** Days after it's assigned to someone that it's due. */
    dueDays: z.number().int().min(1).max(365).default(14),
  })
  .superRefine((c, ctx) => {
    if (c.kind === "course" && !c.lessons.length) ctx.addIssue({ code: "custom", path: ["lessons"], message: "Add at least one lesson" });
    if (new Set(c.lessons.map((l) => l.id)).size !== c.lessons.length) ctx.addIssue({ code: "custom", path: ["lessons"], message: "Each lesson needs its own id" });
    if (new Set(c.quiz.map((q) => q.id)).size !== c.quiz.length) ctx.addIssue({ code: "custom", path: ["quiz"], message: "Each question needs its own id" });
  });
export type CourseInput = z.infer<typeof courseSchema>;

/** Scores a quiz attempt: percentage right, and whether it passes. */
export function gradeQuiz(quiz: QuizQuestion[], answers: Record<string, number>, passMark: number) {
  if (!quiz.length) return { score: 100, passed: true, wrong: [] as string[] };
  const wrong = quiz.filter((q) => answers[q.id] !== q.answer).map((q) => q.id);
  const score = Math.round(((quiz.length - wrong.length) / quiz.length) * 100);
  return { score, passed: score >= passMark, wrong };
}

export type EnrollmentState = "not_started" | "in_progress" | "completed" | "overdue";
export function enrollmentState(e: { startedAt: Date | string | null; completedAt: Date | string | null; dueOn: string }, today: string): EnrollmentState {
  if (e.completedAt) return "completed";
  if (e.dueOn < today) return "overdue";
  return e.startedAt ? "in_progress" : "not_started";
}
export const ENROLLMENT_STATE_LABEL: Record<EnrollmentState, string> = { not_started: "Not started", in_progress: "In progress", completed: "Done", overdue: "Overdue" };

export const quizAttemptSchema = z.object({ answers: z.record(z.string(), z.number().int().min(0)) });
