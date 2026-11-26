/**
 * Reads the useful bits out of a receipt's text (from OCR on the employee's phone): the total,
 * the date, the seller's GSTIN, the GST charged and the seller's name. Receipts are messy, so
 * every field is a best guess the employee checks before submitting.
 */
export interface ReceiptGuess {
  amount: number | null;
  date: string | null;
  gstin: string | null;
  gstAmount: number | null;
  vendor: string | null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const num = (s: string) => Number(s.replace(/[,\s]/g, "").replace(/[oO]/g, "0"));
const pad = (n: number) => String(n).padStart(2, "0");

/** Amounts on a line: 1,234.50 or 1234 or ₹ 1,23,456.00. */
function amountsIn(line: string): number[] {
  return [...line.matchAll(/(?:₹|rs\.?|inr)?\s*(?<![\d/:.,-])(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d{2,7})(?![\d/:-])/gi)].map((m) => num(m[1]!)).filter((n) => n > 0 && n < 10_000_000);
}

function findDate(text: string, today: string): string | null {
  const ok = (y: number, m: number, d: number) => {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2015) return null;
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    return iso <= today ? iso : null;
  };
  // 26/11/2026, 26-11-26, 26.11.2026 (Indian order: day first)
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)) {
    const r = ok(Number(m[3]), Number(m[2]), Number(m[1]));
    if (r) return r;
  }
  // 2026-11-26
  for (const m of text.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) {
    const r = ok(Number(m[1]), Number(m[2]), Number(m[3]));
    if (r) return r;
  }
  // 26 Nov 2026, 26-Nov-26, Nov 26, 2026
  for (const m of text.matchAll(/\b(\d{1,2})[\s-]*([A-Za-z]{3,4})[a-z]*[\s,-]*(\d{2,4})\b/g)) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    const r = mo ? ok(Number(m[3]), mo, Number(m[1])) : null;
    if (r) return r;
  }
  for (const m of text.matchAll(/\b([A-Za-z]{3,4})[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    const r = mo ? ok(Number(m[3]), mo, Number(m[2])) : null;
    if (r) return r;
  }
  return null;
}

export function parseReceipt(text: string, today: string = new Date().toISOString().slice(0, 10)): ReceiptGuess {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const flat = lines.join("\n");

  const gstin = flat.toUpperCase().replace(/\s/g, "").match(/\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]/)?.[0] ?? null;

  // the total: a line that says so, preferring "grand total" and "net payable"; else the largest amount
  const TOTAL = [/grand\s*total|net\s*(payable|amount)|amount\s*payable|total\s*amount|bill\s*amount|amount\s*paid|total\s*payable/i, /\btotal\b/i];
  let amount: number | null = null;
  for (const re of TOTAL) {
    const hits = lines.filter((l) => re.test(l) && !/sub\s*-?\s*total|total\s*(qty|quantity|items?)|tax/i.test(l)).flatMap((l, i, arr) => {
      const own = amountsIn(l);
      if (own.length) return [own[own.length - 1]!];
      // the amount is sometimes on the next line
      const idx = lines.indexOf(arr[i]!);
      const next = lines[idx + 1] ? amountsIn(lines[idx + 1]!) : [];
      return next.length ? [next[next.length - 1]!] : [];
    });
    if (hits.length) {
      amount = Math.max(...hits);
      break;
    }
  }
  if (amount === null) {
    const all = lines.filter((l) => !/gstin|phone|mob|tel|invoice\s*no|bill\s*no|pin|a\/c/i.test(l)).flatMap(amountsIn).filter((n) => n % 1 !== 0 || n < 100000);
    amount = all.length ? Math.max(...all) : null;
  }

  // GST: CGST + SGST, or IGST
  const taxOf = (re: RegExp) => lines.filter((l) => re.test(l)).map((l) => amountsIn(l).filter((n) => n < (amount ?? Infinity) && !(n <= 28 && /%/.test(l) && amountsIn(l).length === 1)).pop()).filter((n): n is number => n !== undefined);
  const cgst = taxOf(/\bcgst\b/i)[0] ?? 0;
  const sgst = taxOf(/\b(sgst|utgst)\b/i)[0] ?? 0;
  const igst = taxOf(/\bigst\b/i)[0] ?? 0;
  const gstAmount = igst || cgst + sgst ? Math.round((igst || cgst + sgst) * 100) / 100 : null;

  // the seller: usually the first line with real letters that isn't an address, tax id or receipt label
  const vendor = lines.slice(0, 6).find((l) => /[A-Za-z]{3,}/.test(l) && !/gstin|invoice|receipt|\bbill\b|\btax\b|\bdate\b|phone|\btel\b|\bmob|www\.|@|\broad\b|street|nagar|floor|\bno\.|check-?in|^\d/i.test(l) && l.length <= 60)?.replace(/[^\w &.'()-]/g, "").trim() || null;

  return { amount, date: findDate(flat, today), gstin, gstAmount, vendor };
}
