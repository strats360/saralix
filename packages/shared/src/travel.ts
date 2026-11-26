import { z } from "zod";

/**
 * Travel requests: ask before a trip, with an optional advance. The manager approves; finance
 * also approves when there's an advance, and records when it's paid. Claims for the trip are
 * linked to it and paid with salary as usual. When the trip is settled, the advance becomes a
 * one month recovery in the next payroll, so the person ends up with exactly what they spent.
 */
export const TRAVEL_MODES = ["flight", "train", "bus", "car", "other"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];
export const TRAVEL_MODE_LABEL: Record<TravelMode, string> = { flight: "Flight", train: "Train", bus: "Bus", car: "Car or cab", other: "Other" };

export const TRAVEL_STATUSES = ["pending_manager", "pending_finance", "approved", "rejected", "cancelled", "settled"] as const;
export type TravelStatus = (typeof TRAVEL_STATUSES)[number];
export const TRAVEL_STATUS_LABEL: Record<TravelStatus, string> = { pending_manager: "With manager", pending_finance: "With finance", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled", settled: "Settled" };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
export const travelRequestSchema = z
  .object({
    purpose: z.string().trim().min(5, "Say what the trip is for").max(300),
    fromCity: z.string().trim().min(2, "Where from?").max(80),
    toCity: z.string().trim().min(2, "Where to?").max(80),
    startDate: isoDate,
    endDate: isoDate,
    mode: z.enum(TRAVEL_MODES).default("train"),
    estimatedCost: z.number().min(0).max(10_000_000).default(0),
    advanceAmount: z.number().min(0).max(10_000_000).default(0),
    notes: z.string().trim().max(1000).default(""),
  })
  .refine((t) => t.endDate >= t.startDate, { message: "The trip can't end before it starts", path: ["endDate"] })
  .refine((t) => t.advanceAmount <= Math.max(t.estimatedCost, 0) || t.estimatedCost === 0, { message: "The advance can't be more than the estimated cost", path: ["advanceAmount"] });

/** Where a trip stands once its claims are in. */
export function travelSettlement(advancePaid: number, claimed: number) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { advance: r2(advancePaid), claimed: r2(claimed), net: r2(claimed - advancePaid) };
}
