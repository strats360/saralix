import { describe, expect, it } from "vitest";
import { checkFormAnswers, formDecisionSchema, fmtAnswer, formSchema, nextApprover, type FormField } from "../src/workflows";

const fields: FormField[] = [
  { id: "a", label: "Reason", type: "text", required: true, help: "", options: [] },
  { id: "b", label: "Amount", type: "number", required: false, help: "", options: [] },
  { id: "c", label: "Kind", type: "select", required: true, help: "", options: ["Laptop", "Phone"] },
  { id: "d", label: "Agree", type: "checkbox", required: true, help: "", options: [] },
  { id: "e", label: "When", type: "date", required: false, help: "", options: [] },
  { id: "f", label: "Quote", type: "file", required: true, help: "", options: [] },
];

describe("checkFormAnswers", () => {
  it("accepts good answers and cleans them", () => {
    const r = checkFormAnswers(fields, { a: " New laptop ", b: "1,20,000", c: "Laptop", d: true, e: "2026-12-01" }, new Set(["f"]));
    expect(r.ok).toBe(true);
    expect(r.answers).toEqual({ a: "New laptop", b: 120000, c: "Laptop", d: true, e: "2026-12-01" });
  });
  it("flags missing and wrong answers", () => {
    const r = checkFormAnswers(fields, { a: " ", b: "lots", c: "Tablet", d: false, e: "01/12/2026" });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
  it("leaves optional blanks as null", () => {
    const r = checkFormAnswers(fields, { a: "x", c: "Phone", d: true }, new Set(["f"]));
    expect(r.answers.b).toBeNull();
    expect(r.answers.e).toBeNull();
  });
});

describe("nextApprover", () => {
  const steps = [
    { id: "1", kind: "manager" as const, employeeId: null },
    { id: "2", kind: "person" as const, employeeId: "fin" },
    { id: "3", kind: "hr" as const, employeeId: null },
  ];
  it("goes step by step", () => {
    expect(nextApprover(steps, 0, { employeeId: "me", managerId: "boss" })).toEqual({ index: 0, kind: "manager", employeeId: "boss" });
    expect(nextApprover(steps, 1, { employeeId: "me", managerId: "boss" })).toEqual({ index: 1, kind: "person", employeeId: "fin" });
    expect(nextApprover(steps, 3, { employeeId: "me", managerId: "boss" })).toBeNull();
  });
  it("skips steps that can't apply", () => {
    expect(nextApprover(steps, 0, { employeeId: "fin", managerId: null })).toEqual({ index: 2, kind: "hr", employeeId: null });
  });
  it("approves straight away with no steps", () => {
    expect(nextApprover([], 0, { employeeId: "me", managerId: "boss" })).toBeNull();
  });
});

describe("schemas", () => {
  it("needs options for a pick one field and an approver for a person step", () => {
    expect(formSchema.safeParse({ title: "Asset request", fields: [{ id: "x", label: "Kind", type: "select", options: ["One"] }] }).success).toBe(false);
    expect(formSchema.safeParse({ title: "Asset request", fields: [{ id: "x", label: "Kind", type: "text" }], steps: [{ id: "s", kind: "person" }] }).success).toBe(false);
    expect(formSchema.safeParse({ title: "Asset request", fields: [{ id: "x", label: "Kind", type: "text" }], steps: [{ id: "s", kind: "manager" }] }).success).toBe(true);
  });
  it("needs a reason to reject", () => {
    expect(formDecisionSchema.safeParse({ decision: "reject" }).success).toBe(false);
    expect(formDecisionSchema.safeParse({ decision: "approve" }).success).toBe(true);
  });
  it("formats answers", () => {
    expect(fmtAnswer({ type: "checkbox" }, false)).toBe("No");
    expect(fmtAnswer({ type: "number" }, 5)).toBe("5");
    expect(fmtAnswer({ type: "text" }, null)).toBe("");
  });
});
