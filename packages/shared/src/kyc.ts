import { z } from "zod";

/**
 * Company KYC. A company that signs up sends its registration details and documents; the
 * Saralix team checks them. Until they're approved the company can set itself up but can't add
 * employees, run payroll or use the rest of the app.
 *
 * approved is the default on the tenant, so companies created by the platform team, the demo
 * and everyone who signed up before KYC existed keep working. Self sign-ups start at draft.
 */
export const KYC_STATUSES = ["draft", "submitted", "needs_info", "approved", "rejected"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];
export const KYC_STATUS_LABEL: Record<KycStatus, string> = {
  draft: "Not sent yet",
  submitted: "Being checked",
  needs_info: "More information needed",
  approved: "Verified",
  rejected: "Not approved",
};

export const ENTITY_TYPES = ["proprietorship", "partnership", "llp", "private_limited", "public_limited", "opc", "trust_society", "other"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  proprietorship: "Sole proprietorship",
  partnership: "Partnership firm",
  llp: "Limited liability partnership (LLP)",
  private_limited: "Private limited company",
  public_limited: "Public limited company",
  opc: "One person company (OPC)",
  trust_society: "Trust, society or section 8 company",
  other: "Something else",
};

export const KYC_DOC_KINDS = ["pan", "gst", "incorporation", "partnership_deed", "address_proof", "signatory_id", "authorisation", "other"] as const;
export type KycDocKind = (typeof KYC_DOC_KINDS)[number];
export const KYC_DOC_LABEL: Record<KycDocKind, string> = {
  pan: "Company PAN card",
  gst: "GST registration certificate",
  incorporation: "Certificate of incorporation",
  partnership_deed: "Partnership deed",
  address_proof: "Proof of registered address",
  signatory_id: "Authorised signatory's ID (PAN or passport)",
  authorisation: "Board resolution or letter authorising the signatory",
  other: "Anything else",
};
export const KYC_DOC_HINT: Record<KycDocKind, string> = {
  pan: "The PAN issued to the business, not a person (a proprietor's own PAN is fine for a proprietorship).",
  gst: "All pages of the GST REG-06 certificate.",
  incorporation: "From the MCA, showing the CIN or LLPIN.",
  partnership_deed: "The registered deed, all pages.",
  address_proof: "A recent electricity bill, rent agreement or bank statement in the business's name, under 3 months old.",
  signatory_id: "PAN card or passport of the person who signs for the company.",
  authorisation: "On letterhead, signed by a director or partner. Not needed if the signatory is a director, partner or the proprietor.",
  other: "Optional.",
};

const COMPANY: EntityType[] = ["private_limited", "public_limited", "opc"];

/** Documents each type of business must send. */
export function requiredDocs(type: EntityType, hasGst: boolean): KycDocKind[] {
  const docs: KycDocKind[] = ["pan", "address_proof", "signatory_id"];
  if (hasGst) docs.push("gst");
  if (COMPANY.includes(type) || type === "llp" || type === "trust_society") docs.push("incorporation");
  if (type === "partnership") docs.push("partnership_deed");
  return docs;
}

/** Does this type of business have a CIN or LLPIN? */
export const needsRegNo = (type: EntityType) => COMPANY.includes(type) || type === "llp";

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** CIN: L or U, 5 digit industry code, state, year, type, 6 digit number. */
export const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
export const LLPIN_RE = /^[A-Z]{3}-\d{4}$/;

/** The 4th letter of a PAN says what holds it: C company, F firm or LLP, P person, T trust, and so on. */
export function panHolderMatches(pan: string, type: EntityType) {
  const k = pan[3];
  if (COMPANY.includes(type)) return k === "C";
  if (type === "llp" || type === "partnership") return k === "F";
  if (type === "proprietorship") return k === "P";
  if (type === "trust_society") return k === "T" || k === "A" || k === "C";
  return true;
}

const upper = z.string().trim().toUpperCase();
export const kycDetailsSchema = z
  .object({
    entityType: z.enum(ENTITY_TYPES),
    legalName: z.string().trim().min(3, "Enter the name as on the PAN").max(200),
    pan: upper.regex(PAN_RE, "PAN must look like ABCDE1234F"),
    gstin: upper.regex(GSTIN_RE, "Enter a valid 15 character GSTIN").nullable().default(null),
    /** Why there's no GSTIN, when there isn't one. */
    noGstReason: z.string().trim().max(300).nullable().default(null),
    regNo: upper.max(30).nullable().default(null),
    address: z.string().trim().min(10, "Enter the full registered address").max(500),
    state: z.string().trim().min(2, "Pick a state").max(60),
    pincode: z.string().trim().regex(/^\d{6}$/, "PIN code is 6 digits"),
    website: z.string().trim().max(200).nullable().default(null),
    signatoryName: z.string().trim().min(3, "Who signs for the company?").max(120),
    signatoryRole: z.string().trim().min(2, "Their role, like Director or Partner").max(80),
    signatoryEmail: z.email("Enter a valid email").trim().toLowerCase(),
    signatoryPhone: z.string().trim().regex(/^(\+91[\s-]?)?[6-9]\d{9}$/, "Enter a 10 digit Indian mobile number"),
  })
  .superRefine((k, ctx) => {
    if (!panHolderMatches(k.pan, k.entityType)) ctx.addIssue({ code: "custom", path: ["pan"], message: "This PAN doesn't match the type of business. Check the 4th letter (C for a company, F for a firm or LLP, P for a proprietor)." });
    if (k.gstin && k.gstin.slice(2, 12) !== k.pan) ctx.addIssue({ code: "custom", path: ["gstin"], message: "The GSTIN should contain the PAN (characters 3 to 12)" });
    if (!k.gstin && !(k.noGstReason && k.noGstReason.length >= 5)) ctx.addIssue({ code: "custom", path: ["noGstReason"], message: "Add your GSTIN, or tell us why you don't have one" });
    if (needsRegNo(k.entityType)) {
      const re = k.entityType === "llp" ? LLPIN_RE : CIN_RE;
      if (!k.regNo || !re.test(k.regNo)) ctx.addIssue({ code: "custom", path: ["regNo"], message: k.entityType === "llp" ? "LLPIN looks like AAB-1234" : "CIN is 21 characters, like U72900GJ2019PTC123456" });
    }
  });
export type KycDetails = z.infer<typeof kycDetailsSchema>;

export const kycDecisionSchema = z
  .object({
    decision: z.enum(["approve", "needs_info", "reject"]),
    note: z.string().trim().max(2000).default(""),
  })
  .refine((d) => d.decision === "approve" || d.note.length >= 10, { message: "Tell the company what's wrong or what's missing", path: ["note"] });

/** What's still missing before KYC can be sent. */
export function kycGaps(details: Partial<KycDetails> | null, docs: KycDocKind[]): string[] {
  if (!details?.entityType) return ["Fill in the business details"];
  const parsed = kycDetailsSchema.safeParse(details);
  const gaps: string[] = parsed.success ? [] : ["Fix the business details"];
  for (const d of requiredDocs(details.entityType, !!details.gstin)) if (!docs.includes(d)) gaps.push(`Upload the ${KYC_DOC_LABEL[d].charAt(0).toLowerCase()}${KYC_DOC_LABEL[d].slice(1)}`);
  return gaps;
}

/**
 * Admin API paths a company can use before it's verified: KYC itself, the setup checklist,
 * company settings and branches, admins and roles, billing, support and the audit log.
 */
export const KYC_OPEN_PATHS = ["/admin/kyc", "/admin/dashboard/setup", "/admin/dashboard/setup-finish", "/admin/org", "/admin/access", "/admin/billing", "/admin/support", "/admin/audit", "/notifications/mine", "/photos"];
export const kycAllows = (path: string) => KYC_OPEN_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
