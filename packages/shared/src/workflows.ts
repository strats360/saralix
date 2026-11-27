import { z } from "zod";

/**
 * Forms and workflows (paid add-on). HR builds a request form, picks who it's for, and sets the
 * approval steps. Employees fill it in; each step's approver approves or rejects in turn.
 */
export const FORM_FIELD_TYPES = ["text", "textarea", "number", "date", "select", "checkbox", "file"] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];
export const FORM_FIELD_LABEL: Record<FormFieldType, string> = { text: "Short answer", textarea: "Long answer", number: "Number", date: "Date", select: "Pick one", checkbox: "Yes or no", file: "File" };

export const formFieldSchema = z
  .object({
    id: z.string().min(1).max(40),
    label: z.string().trim().min(2, "Name the field").max(150),
    type: z.enum(FORM_FIELD_TYPES),
    required: z.boolean().default(false),
    help: z.string().trim().max(300).default(""),
    options: z.array(z.string().trim().min(1, "Options can't be blank").max(150)).max(30).default([]),
  })
  .refine((f) => f.type !== "select" || f.options.length >= 2, { message: "Give at least two options", path: ["options"] });
export type FormField = z.infer<typeof formFieldSchema>;

/** Who approves a step: the person's manager, a named employee, or HR (anyone who can edit employees). */
export const STEP_KINDS = ["manager", "person", "hr"] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export const STEP_KIND_LABEL: Record<StepKind, string> = { manager: "Their manager", person: "A named person", hr: "HR" };

export const formStepSchema = z
  .object({
    id: z.string().min(1).max(40),
    kind: z.enum(STEP_KINDS),
    employeeId: z.string().nullable().default(null),
  })
  .refine((s) => s.kind !== "person" || !!s.employeeId, { message: "Pick who approves", path: ["employeeId"] });
export type FormStep = z.infer<typeof formStepSchema>;

export const formSchema = z
  .object({
    title: z.string().trim().min(3, "Give it a title").max(150),
    description: z.string().trim().max(2000).default(""),
    fields: z.array(formFieldSchema).min(1, "Add at least one field").max(40),
    steps: z.array(formStepSchema).max(5).default([]),
    departmentIds: z.array(z.string()).default([]),
    branchIds: z.array(z.string()).default([]),
  })
  .superRefine((f, ctx) => {
    if (new Set(f.fields.map((x) => x.id)).size !== f.fields.length) ctx.addIssue({ code: "custom", path: ["fields"], message: "Each field needs its own id" });
    if (new Set(f.steps.map((x) => x.id)).size !== f.steps.length) ctx.addIssue({ code: "custom", path: ["steps"], message: "Each step needs its own id" });
  });
export type FormInput = z.infer<typeof formSchema>;

export type AnswerValue = string | number | boolean | null;
/** A file field's answer is the uploaded file's name; the file itself is stored separately. */
export type Answers = Record<string, AnswerValue>;

/** Checks answers against the fields. Returns cleaned answers, or an error per field. */
export function checkFormAnswers(fields: FormField[], raw: Record<string, unknown>, files: Set<string> = new Set()) {
  const errors: Record<string, string> = {};
  const answers: Answers = {};
  for (const f of fields) {
    const v = raw[f.id];
    const blank = v === undefined || v === null || (typeof v === "string" && !v.trim());
    if (f.type === "file") {
      if (f.required && !files.has(f.id)) errors[f.id] = "Attach a file";
      continue;
    }
    if (f.type === "checkbox") {
      if (f.required && v !== true) errors[f.id] = "Tick this to continue";
      answers[f.id] = v === true;
      continue;
    }
    if (blank) {
      if (f.required) errors[f.id] = "Fill this in";
      answers[f.id] = null;
      continue;
    }
    if (f.type === "number") {
      const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
      if (!Number.isFinite(n)) errors[f.id] = "Enter a number";
      else answers[f.id] = n;
    } else if (f.type === "date") {
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors[f.id] = "Enter a date";
      else answers[f.id] = v;
    } else if (f.type === "select") {
      if (typeof v !== "string" || !f.options.includes(v)) errors[f.id] = "Pick one of the options";
      else answers[f.id] = v;
    } else {
      const s = String(v).trim();
      const max = f.type === "textarea" ? 5000 : 300;
      if (s.length > max) errors[f.id] = `Keep it under ${max} characters`;
      else answers[f.id] = s;
    }
  }
  return { answers, errors, ok: !Object.keys(errors).length };
}

/** How an answer reads in a list or an export. */
export function fmtAnswer(f: Pick<FormField, "type">, v: AnswerValue | undefined) {
  if (v === undefined || v === null || v === "") return "";
  if (f.type === "checkbox") return v ? "Yes" : "No";
  return String(v);
}

export const SUBMISSION_STATUS = ["pending", "approved", "rejected", "withdrawn"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUS)[number];
export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = { pending: "Waiting", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn" };

/**
 * Who approves next, from step `from` on. Steps that can't apply are skipped: a manager step for
 * someone with no manager, or a step where the approver would be the person who asked.
 * Returns null when there are no more steps (the request is approved).
 */
export function nextApprover(steps: FormStep[], from: number, who: { employeeId: string; managerId: string | null }): { index: number; kind: StepKind; employeeId: string | null } | null {
  for (let i = from; i < steps.length; i++) {
    const s = steps[i]!;
    if (s.kind === "hr") return { index: i, kind: "hr", employeeId: null };
    const approver = s.kind === "manager" ? who.managerId : s.employeeId;
    if (approver && approver !== who.employeeId) return { index: i, kind: s.kind, employeeId: approver };
  }
  return null;
}

export const formDecisionSchema = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).default("") }).refine((d) => d.decision === "approve" || d.note.length >= 3, { message: "Say why you're rejecting it", path: ["note"] });
