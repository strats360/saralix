import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, env, login, mailer, signUpCompany } from "./helpers";

const sql = postgres(env.DATABASE_URL!, { max: 1, onnotice: () => {} });
let owner: Client, platform: Client, kunal: Client;
const EMAIL = "founder@kyctest.in";

const DETAILS = {
  entityType: "private_limited",
  legalName: "KYC Test Private Limited",
  pan: "AAKCK1234M",
  gstin: "24AAKCK1234M1Z5",
  regNo: "U72900GJ2024PTC123456",
  address: "4th floor, Sindhu Bhavan Road, Bodakdev, Ahmedabad",
  state: "Gujarat",
  pincode: "380054",
  signatoryName: "Asha Kyc",
  signatoryRole: "Director",
  signatoryEmail: "asha@kyctest.in",
  signatoryPhone: "9876543210",
};
const pdf = (name: string) => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 10])], name, { type: "application/pdf" });
const upload = (kind: string) => {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("file", pdf(`${kind}.pdf`));
  return owner.post("/admin/kyc/documents", fd);
};

beforeAll(async () => {
  owner = await signUpCompany({ name: "Asha Kyc", email: EMAIL, password: "KycTest#2026", companyName: "KYC Test", verified: false });
  [platform, kunal] = await Promise.all([login("platform@saralix.com"), login("kunal.shah@strats360.com")]);
});
afterAll(async () => {
  await sql`delete from tenants where id = ${owner.tenantId!}`;
  await sql`delete from auth_user where email = ${EMAIL}`;
  await sql.end();
});

describe("Company KYC", () => {
  it("starts a self sign-up unverified and limits it to setup", async () => {
    const me = (await owner.get("/me")).body;
    expect(me.memberships[0].kycStatus).toBe("draft");
    const blocked = await owner.get("/admin/employees");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("kyc_required");
    expect((await owner.get("/admin/payroll/runs")).status).toBe(403);
    expect((await owner.get("/admin/org/tenant")).status).toBe(200);
    expect((await owner.get("/admin/dashboard/setup")).status).toBe(200);
    expect((await owner.get("/admin/kyc")).body).toMatchObject({ status: "draft", gaps: ["Fill in the business details"] });
    // companies from before KYC, and the demo, are untouched
    expect((await kunal.get("/admin/employees")).status).toBe(200);
  });

  it("checks the details and the documents before it can be sent", async () => {
    const bad = await owner.req("PUT", "/admin/kyc", { ...DETAILS, pan: "AAKPK1234M" });
    expect(bad.body).toMatchObject({ valid: false });
    expect(bad.body.errors.pan).toMatch(/doesn't match the type of business/);
    expect((await owner.req("PUT", "/admin/kyc", { ...DETAILS, gstin: "24AAKCK9999M1Z5" })).body.errors.gstin).toMatch(/contain the PAN/);
    expect((await owner.req("PUT", "/admin/kyc", { ...DETAILS, regNo: "123" })).body.errors.regNo).toMatch(/CIN/);
    expect((await owner.req("PUT", "/admin/kyc", DETAILS)).body).toMatchObject({ valid: true });
    let k = (await owner.get("/admin/kyc")).body;
    expect(k.required.sort()).toEqual(["address_proof", "gst", "incorporation", "pan", "signatory_id"]);
    expect((await owner.post("/admin/kyc/submit")).status).toBe(400);
    for (const kind of ["pan", "gst", "incorporation", "address_proof"]) expect((await upload(kind)).status).toBe(201);
    const fd = new FormData();
    fd.append("kind", "signatory_id");
    fd.append("file", new File([new Uint8Array([1, 2, 3, 4])], "x.exe"));
    expect((await owner.post("/admin/kyc/documents", fd)).status).toBe(400);
    k = (await owner.get("/admin/kyc")).body;
    expect(k.gaps).toEqual(["Upload the authorised signatory's ID (PAN or passport)"]);
    expect((await upload("signatory_id")).status).toBe(201);
    // a second PAN upload replaces the first
    await upload("pan");
    expect((await owner.get("/admin/kyc")).body.documents.filter((d: any) => d.kind === "pan")).toHaveLength(1);
  });

  it("sends it to the platform team and locks it while it's checked", async () => {
    const before = mailer.sent.length;
    expect((await owner.post("/admin/kyc/submit")).status).toBe(200);
    expect(mailer.sent.slice(before).some((m) => m.to === "platform@saralix.com" && m.subject === "KYC to review: KYC Test")).toBe(true);
    expect((await owner.req("PUT", "/admin/kyc", DETAILS)).status).toBe(400);
    expect((await upload("other")).status).toBe(400);
    const [t] = await sql`select kyc_status, pan, gstin, llpin_cin from tenants where id = ${owner.tenantId!}`;
    expect(t).toMatchObject({ kyc_status: "submitted", pan: "AAKCK1234M", gstin: "24AAKCK1234M1Z5", llpin_cin: "U72900GJ2024PTC123456" });
    expect((await owner.get("/admin/employees")).status).toBe(403);
  });

  it("lets the platform team send it back, then approve it", async () => {
    expect((await kunal.get("/platform/kyc")).status).toBe(403);
    const queue = (await platform.get("/platform/kyc?status=submitted")).body;
    expect(queue.find((q: any) => q.tenantId === owner.tenantId)).toMatchObject({ legalName: "KYC Test Private Limited", entityType: "private_limited" });
    const one = (await platform.get(`/platform/kyc/${owner.tenantId}`)).body;
    expect(one.documents).toHaveLength(5);
    const file = await platform.file(`/platform/kyc/${owner.tenantId}/documents/${one.documents[0].id}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");

    expect((await platform.post(`/platform/kyc/${owner.tenantId}/decision`, { decision: "needs_info", note: "x" })).status).toBe(422);
    const before = mailer.sent.length;
    expect((await platform.post(`/platform/kyc/${owner.tenantId}/decision`, { decision: "needs_info", note: "The address proof is older than three months. Upload a recent one." })).status).toBe(200);
    expect(mailer.sent.slice(before).find((m) => m.to === EMAIL)?.text).toContain("older than three months");
    expect((await owner.get("/admin/kyc")).body).toMatchObject({ status: "needs_info", reviewNote: "The address proof is older than three months. Upload a recent one." });
    expect((await upload("address_proof")).status).toBe(201);
    expect((await owner.post("/admin/kyc/submit")).status).toBe(200);

    expect((await platform.post(`/platform/kyc/${owner.tenantId}/decision`, { decision: "approve" })).status).toBe(200);
    expect((await owner.get("/admin/employees")).status).toBe(200);
    const k = (await owner.get("/admin/kyc")).body;
    expect(k.status).toBe("approved");
    expect(k.history.map((h: any) => h.action)).toEqual(["submitted", "needs_info", "resubmitted", "approved"]);
    expect((await platform.post(`/platform/kyc/${owner.tenantId}/decision`, { decision: "reject", note: "Changed our mind about this" })).status).toBe(400);
  });
});
