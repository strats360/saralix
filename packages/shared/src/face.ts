import { z } from "zod";

/**
 * Face attendance kiosk (paid add-on). A tablet or phone at the entrance runs the kiosk page in
 * a browser. The page finds a face and turns it into 128 numbers (a face descriptor) on the
 * device; only those numbers and a small photo for the record are sent. The server matches
 * them against the descriptors people enrolled with their consent.
 */
export const DESCRIPTOR_LENGTH = 128;
/** Faces closer than this are the same person. Lower is stricter. */
export const FACE_MATCH_THRESHOLD = 0.5;
/** The best match must beat the next person by this much, or we ask them to try again. */
export const FACE_MATCH_MARGIN = 0.06;
/** A second punch by the same person within this window is ignored. */
export const KIOSK_REPEAT_SECONDS = 120;
/** How long "Not you?" stays on screen and can undo a punch. */
export const KIOSK_UNDO_SECONDS = 30;

const descriptor = z.array(z.number().finite().min(-2).max(2)).length(DESCRIPTOR_LENGTH);

export const faceEnrollSchema = z.object({
  descriptors: z.array(descriptor).min(3, "Take three photos").max(5),
  consent: z.literal(true, { message: "Consent is needed to use your face for attendance" }),
});

export const kioskPunchSchema = z.object({
  descriptor,
  /** A small JPEG of the moment, as a data URL, kept so HR can check a punch. */
  photo: z.string().startsWith("data:image/jpeg;base64,").max(200_000).optional(),
  /** The kiosk saw this face blink just before the punch. */
  blink: z.boolean().default(false),
});

export const kioskPairSchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8}$/, "Enter the 8 character code") });

export function faceDistance(a: readonly number[], b: readonly number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    s += d * d;
  }
  return Math.sqrt(s);
}

/** The average of several descriptors of one face. */
export function meanDescriptor(list: readonly (readonly number[])[]) {
  const out = new Array<number>(DESCRIPTOR_LENGTH).fill(0);
  for (const d of list) for (let i = 0; i < DESCRIPTOR_LENGTH; i++) out[i]! += (d[i] ?? 0) / list.length;
  return out;
}

/** The enrolled photos must look like the same person, or enrolment picked up someone else. */
export function consistentSamples(list: readonly (readonly number[])[]) {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (faceDistance(list[i]!, list[j]!) > FACE_MATCH_THRESHOLD) return false;
  return true;
}

export type FaceMatch = { status: "matched"; id: string; distance: number } | { status: "unsure"; distance: number } | { status: "unknown"; distance: number | null };

/** Finds who a face belongs to. Each person's distance is their closest enrolled sample. */
export function matchFace(probe: readonly number[], people: { id: string; samples: readonly (readonly number[])[] }[]): FaceMatch {
  const scored = people.map((p) => ({ id: p.id, d: Math.min(...p.samples.map((s) => faceDistance(probe, s))) })).sort((a, b) => a.d - b.d);
  const [best, next] = scored;
  if (!best || best.d >= FACE_MATCH_THRESHOLD) return { status: "unknown", distance: best?.d ?? null };
  if (next && next.d - best.d < FACE_MATCH_MARGIN) return { status: "unsure", distance: best.d };
  return { status: "matched", id: best.id, distance: best.d };
}

/* ---------------- liveness: a blink ---------------- */

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * How open an eye is, from its six landmarks (corner, two top, corner, two bottom): the eye's
 * height over its width. About 0.25 to 0.35 open, falling towards 0.1 when closed.
 */
export function eyeAspectRatio(eye: readonly Pt[]) {
  if (eye.length !== 6) return 0;
  const [p1, p2, p3, p4, p5, p6] = eye as [Pt, Pt, Pt, Pt, Pt, Pt];
  const w = dist(p1, p4);
  return w ? (dist(p2, p6) + dist(p3, p5)) / (2 * w) : 0;
}

export const BLINK = {
  /** Eyes count as closed below this share of the person's open-eye level. */
  closed: 0.75,
  /** And open again above this share. */
  open: 0.9,
  /** A real blink is quick; eyes shut longer than this (looking down, a photo) don't count. */
  maxClosedMs: 1200,
  /** Readings needed to learn how open this person's eyes are. */
  warmup: 3,
} as const;

/**
 * Watches eye openness frame by frame and says when a full blink (open, closed, open) happened.
 * A printed photo or a still on a phone screen never blinks. Feed it the average of both eyes.
 */
export function blinkDetector() {
  let open: number[] = [];
  let closedAt: number | null = null;
  return {
    push(ear: number, at: number): boolean {
      const baseline = open.length ? Math.max(...open) : 0;
      if (closedAt === null) {
        if (open.length >= BLINK.warmup && ear < baseline * BLINK.closed) {
          closedAt = at;
          return false;
        }
        open = [...open, ear].slice(-12);
        return false;
      }
      if (at - closedAt > BLINK.maxClosedMs) {
        // closed for too long: start again
        closedAt = null;
        open = [];
        return false;
      }
      if (ear > baseline * BLINK.open) {
        closedAt = null;
        open = [ear];
        return true;
      }
      return false;
    },
    reset() {
      open = [];
      closedAt = null;
    },
  };
}
