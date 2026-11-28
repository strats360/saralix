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

import { blinkDetector, BLINK, eyeAspectRatio } from "../src/face";

describe("blink check", () => {
  const eye = (h: number) => [{ x: 0, y: 0 }, { x: 1, y: -h }, { x: 2, y: -h }, { x: 3, y: 0 }, { x: 2, y: h }, { x: 1, y: h }];
  it("measures how open an eye is", () => {
    expect(eyeAspectRatio(eye(0.45))).toBeCloseTo(0.3);
    expect(eyeAspectRatio(eye(0.1))).toBeCloseTo(0.0667, 3);
    expect(eyeAspectRatio([])).toBe(0);
  });
  const run = (ears: number[], step = 80) => {
    const d = blinkDetector();
    return ears.map((e, i) => d.push(e, i * step)).some(Boolean);
  };
  it("sees open, closed, open as a blink", () => {
    expect(run([0.3, 0.31, 0.29, 0.3, 0.12, 0.1, 0.29])).toBe(true);
  });
  it("ignores a still face, small wobbles, and a blink before it has learned the eyes", () => {
    expect(run(Array(30).fill(0.3))).toBe(false);
    expect(run([0.3, 0.29, 0.31, 0.27, 0.3, 0.28, 0.3])).toBe(false);
    expect(run([0.3, 0.1, 0.3])).toBe(false);
  });
  it("doesn't count eyes kept shut too long", () => {
    const closedFrames = Math.ceil(BLINK.maxClosedMs / 80) + 2;
    expect(run([0.3, 0.3, 0.3, 0.3, ...Array(closedFrames).fill(0.1), 0.3])).toBe(false);
  });
});
