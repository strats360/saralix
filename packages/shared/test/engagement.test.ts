import { describe, expect, it } from "vitest";
import { checkAnswers, enps, headline, kudosSchema, SURVEY_TEMPLATES, summarise, surveySchema, valueKey, valuesSchema, type Question } from "../src/engagement";

const Q: Question[] = [
  { id: "a", type: "scale", text: "Happy at work", options: [], required: true },
  { id: "b", type: "enps", text: "Recommend us", options: [], required: true },
  { id: "c", type: "choice", text: "Lunch", options: ["Pizza", "Thali"], required: true },
  { id: "d", type: "multi", text: "Sports", options: ["Cricket", "Football", "Chess"], required: false },
  { id: "e", type: "text", text: "Anything else", options: [], required: false },
];

describe("checkAnswers", () => {
  it("accepts good answers and drops blank optional ones", () => {
    const r = checkAnswers(Q, { a: 4, b: 9, c: "Thali", d: ["Chess", "Chess"], e: "  " });
    expect(r).toEqual({ ok: true, answers: { a: 4, b: 9, c: "Thali", d: ["Chess"] } });
  });
  it("needs required answers", () => {
    expect(checkAnswers(Q, { b: 9, c: "Thali" })).toEqual({ ok: false, error: 'Answer "Happy at work"' });
  });
  it("rejects out of range scores and unknown options", () => {
    expect(checkAnswers(Q, { a: 6, b: 9, c: "Thali" }).ok).toBe(false);
    expect(checkAnswers(Q, { a: 3, b: 11, c: "Thali" }).ok).toBe(false);
    expect(checkAnswers(Q, { a: 3, b: 0, c: "Biryani" }).ok).toBe(false);
    expect(checkAnswers(Q, { a: 3, b: 0, c: "Pizza", d: ["Golf"] }).ok).toBe(false);
    expect(checkAnswers(Q, { a: 2.5, b: 0, c: "Pizza" }).ok).toBe(false);
  });
});

describe("enps", () => {
  it("is promoters minus detractors as a percentage", () => {
    expect(enps([10, 9, 8, 7, 6, 0])).toBe(0);
    expect(enps([10, 10, 9, 3])).toBe(50);
    expect(enps([])).toBeNull();
  });
});

describe("summarise", () => {
  it("adds up every question type", () => {
    const r = summarise(Q, [
      { a: 5, b: 10, c: "Pizza", d: ["Cricket", "Chess"], e: "More snacks" },
      { a: 4, b: 6, c: "Thali", d: ["Cricket"] },
      { a: 4, b: 8, c: "Thali" },
    ]);
    expect(r[0]).toMatchObject({ type: "scale", answered: 3, average: 4.3, counts: [0, 0, 0, 2, 1] });
    expect(r[1]).toMatchObject({ type: "enps", answered: 3, score: 0, promoters: 1, passives: 1, detractors: 1 });
    expect(r[2]).toMatchObject({ type: "choice", options: [{ label: "Pizza", count: 1 }, { label: "Thali", count: 2 }] });
    expect(r[3]).toMatchObject({ type: "multi", answered: 2, options: [{ label: "Cricket", count: 2 }, { label: "Football", count: 0 }, { label: "Chess", count: 1 }] });
    expect(r[4]).toMatchObject({ type: "text", answered: 1, comments: ["More snacks"] });
    expect(r.map(headline)).toEqual(["4.3 out of 5", "0", "Thali (67%)", "Cricket (100%)", "1 comment"]);
  });
});

describe("schemas", () => {
  it("every template is a valid survey", () => {
    for (const t of SURVEY_TEMPLATES) expect(surveySchema.safeParse({ ...t.survey }).success, t.key).toBe(true);
  });
  it("needs two different options for a choice question", () => {
    const base = { title: "Poll", questions: [{ id: "q1", type: "choice", text: "Pick one", options: ["Yes"] }] };
    expect(surveySchema.safeParse(base).success).toBe(false);
    expect(surveySchema.safeParse({ ...base, questions: [{ ...base.questions[0], options: ["Yes", "yes"] }] }).success).toBe(false);
    expect(surveySchema.safeParse({ ...base, questions: [{ ...base.questions[0], options: ["Yes", "No"] }] }).success).toBe(true);
  });
  it("rejects duplicate question ids", () => {
    const q = { id: "q1", type: "scale", text: "How are you?" };
    expect(surveySchema.safeParse({ title: "Pulse", questions: [q, q] }).success).toBe(false);
  });
  it("checks kudos and values", () => {
    expect(kudosSchema.safeParse({ toEmployeeIds: [], value: "teamwork", message: "Great job on the launch" }).success).toBe(false);
    expect(kudosSchema.safeParse({ toEmployeeIds: ["e1"], value: "teamwork", message: "Great job on the launch" }).success).toBe(true);
    expect(valuesSchema.safeParse({ values: [{ key: "a", label: "Aa", emoji: "⭐" }, { key: "a", label: "Bb", emoji: "⭐" }] }).success).toBe(false);
    expect(valueKey("Customer first!")).toBe("customer_first");
  });
});
