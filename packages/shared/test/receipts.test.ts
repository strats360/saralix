import { describe, expect, it } from "vitest";
import { parseReceipt } from "../src/receipts";

const TODAY = "2026-11-26";
describe("parseReceipt", () => {
  it("reads a restaurant bill with CGST and SGST", () => {
    const r = parseReceipt(`SPICE GARDEN RESTAURANT
12, MG Road, Ahmedabad 380009
GSTIN: 24ABCDE1234F1Z5
Bill No: 4471    Date: 24/11/2026
Paneer Tikka        1    320.00
Dal Makhani         1    280.00
Butter Naan         4    240.00
Sub Total                840.00
CGST @2.5%                21.00
SGST @2.5%                21.00
Grand Total              882.00
Thank you, visit again`, TODAY);
    expect(r).toEqual({ amount: 882, date: "2026-11-24", gstin: "24ABCDE1234F1Z5", gstAmount: 42, vendor: "SPICE GARDEN RESTAURANT" });
  });
  it("reads a cab receipt with a month name and Indian commas", () => {
    const r = parseReceipt(`Ola
Invoice
Ride on 18 Nov 2026
Total Fare
₹ 1,245.60
Paid by UPI`, TODAY);
    expect(r).toMatchObject({ amount: 1245.6, date: "2026-11-18", vendor: "Ola", gstin: null });
  });
  it("reads a hotel bill with IGST and a big total", () => {
    const r = parseReceipt(`Hotel Sea Breeze Pvt Ltd
GSTIN 27AAACH1234M1ZX
Check-in 2026-11-10
Room charges 3 nights   12,000.00
IGST 12%                 1,440.00
Net Payable             13,440.00`, TODAY);
    expect(r).toMatchObject({ amount: 13440, gstAmount: 1440, date: "2026-11-10", gstin: "27AAACH1234M1ZX", vendor: "Hotel Sea Breeze Pvt Ltd" });
  });
  it("ignores future dates and falls back to the biggest amount", () => {
    const r = parseReceipt(`Corner Stationers
Valid till 31/12/2027
Pens 120
Notebook 85.50`, TODAY);
    expect(r).toMatchObject({ amount: 120, date: null });
  });
  it("returns nothing it can't find", () => {
    expect(parseReceipt("", TODAY)).toEqual({ amount: null, date: null, gstin: null, gstAmount: null, vendor: null });
  });
});
