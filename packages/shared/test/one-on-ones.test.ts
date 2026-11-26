import { describe, expect, it } from "vitest";
import { carryOver, nextMeeting } from "../src/one-on-ones";

describe("1:1s", () => {
  it("finds the next meeting in a series", () => {
    const at = new Date("2026-11-26T05:30:00Z");
    expect(nextMeeting(at, "none")).toBeNull();
    expect(nextMeeting(at, "weekly")!.toISOString()).toBe("2026-12-03T05:30:00.000Z");
    expect(nextMeeting(at, "biweekly")!.toISOString()).toBe("2026-12-10T05:30:00.000Z");
    expect(nextMeeting(at, "monthly")!.toISOString()).toBe("2026-12-26T05:30:00.000Z");
    expect(nextMeeting(new Date("2027-01-31T05:30:00Z"), "monthly")!.toISOString()).toBe("2027-02-28T05:30:00.000Z");
  });
  it("carries over what wasn't done", () => {
    const r = carryOver([{ id: "a", text: "Promotion", by: "employee", done: false }, { id: "b", text: "Roadmap", by: "manager", done: true }], [{ id: "x", text: "Send the plan", owner: "employee", due: null, done: false }, { id: "y", text: "Book training", owner: "manager", due: null, done: true }]);
    expect(r.agenda.map((a) => a.id)).toEqual(["a"]);
    expect(r.actions.map((a) => a.id)).toEqual(["x"]);
  });
});
