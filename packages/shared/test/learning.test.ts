import { describe, expect, it } from "vitest";
import { courseSchema, enrollmentState, gradeQuiz } from "../src/learning";

const quiz = [
  { id: "a", question: "Who do you report harassment to?", options: ["Your manager only", "The Internal Committee"], answer: 1 },
  { id: "b", question: "Within how many months?", options: ["3", "12"], answer: 0 },
  { id: "c", question: "Is it confidential?", options: ["Yes", "No"], answer: 0 },
];
describe("learning", () => {
  it("grades a quiz", () => {
    expect(gradeQuiz(quiz, { a: 1, b: 0, c: 0 }, 70)).toEqual({ score: 100, passed: true, wrong: [] });
    expect(gradeQuiz(quiz, { a: 1, b: 1, c: 0 }, 70)).toEqual({ score: 67, passed: false, wrong: ["b"] });
    expect(gradeQuiz(quiz, { a: 1, b: 1, c: 0 }, 60).passed).toBe(true);
    expect(gradeQuiz([], {}, 70).passed).toBe(true);
  });
  it("works out where someone is", () => {
    expect(enrollmentState({ startedAt: null, completedAt: null, dueOn: "2026-12-01" }, "2026-11-27")).toBe("not_started");
    expect(enrollmentState({ startedAt: "2026-11-20", completedAt: null, dueOn: "2026-11-25" }, "2026-11-27")).toBe("overdue");
    expect(enrollmentState({ startedAt: "2026-11-20", completedAt: "2026-11-26", dueOn: "2026-11-25" }, "2026-11-27")).toBe("completed");
  });
  it("checks courses", () => {
    expect(courseSchema.safeParse({ title: "POSH basics" }).success).toBe(false);
    expect(courseSchema.safeParse({ kind: "policy", title: "Leave policy 2027" }).success).toBe(true);
    expect(courseSchema.safeParse({ title: "POSH basics", lessons: [{ id: "l1", title: "What is POSH" }], quiz: [{ id: "q", question: "Pick one", options: ["A", "B"], answer: 2 }] }).success).toBe(false);
  });
});
