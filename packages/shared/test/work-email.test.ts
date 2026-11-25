import { describe, expect, it } from "vitest";
import { workEmailError } from "../src/work-email";
import { accountSignupSchema } from "../src/schemas";

describe("work email", () => {
  it("refuses personal and throwaway inboxes", () => {
    expect(workEmailError("asha@gmail.com")).toMatch(/Personal addresses \(gmail.com\)/);
    expect(workEmailError("Asha@Yahoo.co.in")).toMatch(/work email/);
    expect(workEmailError("x@rediffmail.com")).toMatch(/work email/);
    expect(workEmailError("x@mailinator.com")).toMatch(/Temporary inboxes/);
    expect(workEmailError("x@abc.mailinator.com")).toMatch(/Temporary inboxes/);
  });
  it("accepts company domains", () => {
    expect(workEmailError("asha@strats360.com")).toBeNull();
    expect(workEmailError("hr@acme.co.in")).toBeNull();
    expect(workEmailError("hr@gmail.company.com")).toBeNull();
    expect(accountSignupSchema.safeParse({ name: "Asha", email: "asha@gmail.com", password: "LongEnough#1" }).success).toBe(false);
    expect(accountSignupSchema.safeParse({ name: "Asha", email: "asha@acme.in", password: "LongEnough#1" }).success).toBe(true);
  });
});
