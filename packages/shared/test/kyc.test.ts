import { describe, expect, it } from "vitest";
import { kycAllows, kycDecisionSchema, kycDetailsSchema, kycGaps, panHolderMatches, requiredDocs } from "../src/kyc";

const OK = { entityType: "private_limited", legalName: "Acme Private Limited", pan: "aakca1234m", gstin: "24AAKCA1234M1Z5", regNo: "U72900GJ2024PTC123456", address: "12 Ring Road, Surat, Gujarat", state: "Gujarat", pincode: "395001", signatoryName: "Asha Shah", signatoryRole: "Director", signatoryEmail: "Asha@Acme.in", signatoryPhone: "+91 9876543210" };

describe("KYC", () => {
  it("accepts good details and tidies them", () => {
    const r = kycDetailsSchema.parse(OK);
    expect(r).toMatchObject({ pan: "AAKCA1234M", signatoryEmail: "asha@acme.in", noGstReason: null });
  });
  it("matches the PAN to the type of business", () => {
    expect(panHolderMatches("AAKCA1234M", "private_limited")).toBe(true);
    expect(panHolderMatches("AAKPA1234M", "private_limited")).toBe(false);
    expect(panHolderMatches("AAKFA1234M", "llp")).toBe(true);
    expect(panHolderMatches("AAKPA1234M", "proprietorship")).toBe(true);
  });
  it("needs a GSTIN or a reason, a GSTIN that contains the PAN, and a CIN or LLPIN where one exists", () => {
    expect(kycDetailsSchema.safeParse({ ...OK, gstin: null }).success).toBe(false);
    expect(kycDetailsSchema.safeParse({ ...OK, gstin: null, noGstReason: "Turnover below the limit" }).success).toBe(true);
    expect(kycDetailsSchema.safeParse({ ...OK, gstin: "24AAKCB1234M1Z5" }).success).toBe(false);
    expect(kycDetailsSchema.safeParse({ ...OK, regNo: null }).success).toBe(false);
    expect(kycDetailsSchema.safeParse({ ...OK, entityType: "llp", pan: "AAKFA1234M", gstin: "24AAKFA1234M1Z5", regNo: "AAB-1234" }).success).toBe(true);
    expect(kycDetailsSchema.safeParse({ ...OK, entityType: "proprietorship", pan: "AAKPA1234M", gstin: "24AAKPA1234M1Z5", regNo: null }).success).toBe(true);
  });
  it("asks for the right documents", () => {
    expect(requiredDocs("proprietorship", false)).toEqual(["pan", "address_proof", "signatory_id"]);
    expect(requiredDocs("partnership", true)).toEqual(["pan", "address_proof", "signatory_id", "gst", "partnership_deed"]);
    expect(requiredDocs("private_limited", true)).toContain("incorporation");
    expect(kycGaps(null, [])).toEqual(["Fill in the business details"]);
    expect(kycGaps(kycDetailsSchema.parse(OK), ["pan", "gst", "incorporation", "address_proof"])).toEqual(["Upload the authorised signatory's ID (PAN or passport)"]);
  });
  it("only lets an unverified company reach setup paths", () => {
    expect(kycAllows("/admin/kyc/submit")).toBe(true);
    expect(kycAllows("/admin/org/branches")).toBe(true);
    expect(kycAllows("/admin/dashboard/setup-finish")).toBe(true);
    expect(kycAllows("/admin/dashboard")).toBe(false);
    expect(kycAllows("/admin/employees")).toBe(false);
    expect(kycAllows("/admin/organisation")).toBe(false);
    expect(kycAllows("/ess/leave")).toBe(false);
  });
  it("needs a note to send back or reject", () => {
    expect(kycDecisionSchema.safeParse({ decision: "approve" }).success).toBe(true);
    expect(kycDecisionSchema.safeParse({ decision: "reject", note: "no" }).success).toBe(false);
  });
});
