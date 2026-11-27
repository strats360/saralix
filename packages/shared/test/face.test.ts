import { describe, expect, it } from "vitest";
import { consistentSamples, faceDistance, faceEnrollSchema, kioskPairSchema, matchFace, meanDescriptor } from "../src/face";

const vec = (seed: number, jitter = 0) => Array.from({ length: 128 }, (_, i) => Math.sin(seed * 7.3 + i) * 0.1 + (jitter ? Math.cos(i * jitter) * 0.004 : 0));

describe("face matching", () => {
  const priya = [vec(1), vec(1, 1), vec(1, 2)];
  const hardik = [vec(2), vec(2, 1)];
  it("measures distance", () => {
    expect(faceDistance(vec(1), vec(1))).toBe(0);
    expect(faceDistance(vec(1), vec(2))).toBeGreaterThan(0.5);
  });
  it("finds the right person", () => {
    const r = matchFace(vec(1, 3), [{ id: "priya", samples: priya }, { id: "hardik", samples: hardik }]);
    expect(r).toMatchObject({ status: "matched", id: "priya" });
  });
  it("says unknown for a stranger, and unsure when two people are too close", () => {
    expect(matchFace(vec(9), [{ id: "priya", samples: priya }]).status).toBe("unknown");
    expect(matchFace(vec(1), [{ id: "a", samples: [vec(1, 1)] }, { id: "b", samples: [vec(1, 2)] }]).status).toBe("unsure");
    expect(matchFace(vec(1), []).status).toBe("unknown");
  });
  it("checks enrolment samples are one person", () => {
    expect(consistentSamples(priya)).toBe(true);
    expect(consistentSamples([vec(1), vec(2), vec(1, 1)])).toBe(false);
    expect(meanDescriptor([vec(1), vec(1)])).toHaveLength(128);
  });
  it("validates input", () => {
    expect(faceEnrollSchema.safeParse({ descriptors: priya, consent: true }).success).toBe(true);
    expect(faceEnrollSchema.safeParse({ descriptors: priya, consent: false }).success).toBe(false);
    expect(faceEnrollSchema.safeParse({ descriptors: [vec(1)], consent: true }).success).toBe(false);
    expect(kioskPairSchema.parse({ code: " ab12cd34 " }).code).toBe("AB12CD34");
  });
});
