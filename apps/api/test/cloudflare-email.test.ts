import { describe, expect, it } from "vitest";
import { CloudflareMailer, parseFrom } from "../src/lib/email";
import { mailerFor } from "../src/lib/context";
import { env } from "./helpers";

const msg = { to: "asha@example.com", subject: "Your payslip", html: "<p>Hi</p>", text: "Hi" };

describe("Cloudflare Email Service", () => {
  it("reads the sender", () => {
    expect(parseFrom("Saralix <no-reply@saralix.com>")).toEqual({ name: "Saralix", email: "no-reply@saralix.com" });
    expect(parseFrom('"Saralix HR" <hr@saralix.com>')).toEqual({ name: "Saralix HR", email: "hr@saralix.com" });
    expect(parseFrom("no-reply@saralix.com")).toBe("no-reply@saralix.com");
    expect(parseFrom("<no-reply@saralix.com>")).toBe("no-reply@saralix.com");
  });

  it("sends through the binding, and is picked when bound", async () => {
    const sent: unknown[] = [];
    const binding = { send: async (m: unknown) => (sent.push(m), { messageId: "m1" }) } as unknown as SendEmail;
    await new CloudflareMailer(binding, "Saralix <no-reply@saralix.com>").send({ ...msg, attachments: [{ filename: "payslip.pdf", content: "JVBERg==" }] });
    expect(sent[0]).toMatchObject({ to: "asha@example.com", from: { email: "no-reply@saralix.com", name: "Saralix" }, subject: "Your payslip", attachments: [{ disposition: "attachment", filename: "payslip.pdf", type: "application/pdf", content: new Uint8Array([37, 80, 68, 70]) }] });
    const m = mailerFor({ ...env, ENVIRONMENT: "production", EMAIL: binding, EMAIL_FROM: "no-reply@saralix.com" });
    await m.send(msg);
    expect(sent).toHaveLength(2);
    // the demo company never emails anyone
    await m.send({ ...msg, to: "someone@demo.saralix.com" });
    expect(sent).toHaveLength(2);
  });

  it("retries without attachments, and reports failures", async () => {
    const sent: { attachments?: unknown }[] = [];
    const picky = { send: async (m: { attachments?: unknown }) => { if (m.attachments) throw new Error("attachments not allowed"); sent.push(m); return { messageId: "m2" }; } } as unknown as SendEmail;
    await new CloudflareMailer(picky, "no-reply@saralix.com").send({ ...msg, attachments: [{ filename: "a.pdf", content: "JVBERg==" }] });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.attachments).toBeUndefined();
    const broken = { send: async () => { throw new Error("sender not verified"); } } as unknown as SendEmail;
    await expect(new CloudflareMailer(broken, "no-reply@saralix.com").send(msg)).rejects.toThrow("Email could not be sent");
  });
});
