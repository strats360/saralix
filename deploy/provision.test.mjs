import { test } from "node:test";
import assert from "node:assert/strict";
import { fromAddress, workerConfig } from "./provision.mjs";

test("adds the Cloudflare email binding only when asked, limited to the sender", () => {
  assert.equal(fromAddress("Saralix <no-reply@saralix.com>"), "no-reply@saralix.com");
  const base = { hyperdriveId: "h", appUrl: "https://app.saralix.com", customDomain: "app.saralix.com" };
  assert.equal(workerConfig({ ...base, emailFrom: "Saralix <no-reply@saralix.com>", emailService: "" }).send_email, undefined);
  assert.deepEqual(workerConfig({ ...base, emailFrom: "Saralix <no-reply@saralix.com>", emailService: "cloudflare" }).send_email, [{ name: "EMAIL", allowed_sender_addresses: ["no-reply@saralix.com"] }]);
});
