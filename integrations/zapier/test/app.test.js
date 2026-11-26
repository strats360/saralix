// Runs the Zapier app against a Saralix API: SARALIX_SITE and SARALIX_KEY (a key with
// employees:read, employees:write and webhooks:manage). Skipped when they aren't set.
const { test } = require("node:test");
const assert = require("node:assert");
const zapier = require("zapier-platform-core");
const App = require("../index");

const appTester = zapier.createAppTester(App);
const site = process.env.SARALIX_SITE;
const apiKey = process.env.SARALIX_KEY;
const authData = { site, apiKey };
const skip = !site || !apiKey;

test("the app definition passes Zapier's schema", () => {
  const { compileApp, validateApp } = require("zapier-platform-core/src/tools/schema");
  assert.deepStrictEqual(validateApp(compileApp(App)), []);
  assert.strictEqual(Object.keys(App.triggers).length, 6);
  assert.ok(App.creates.employee);
});

test("connects and names the account", { skip }, async () => {
  const r = await appTester(App.authentication.test, { authData });
  assert.ok(r.company.name);
});

test("subscribes, lists samples and unsubscribes", { skip }, async () => {
  const t = App.triggers.employee_created.operation;
  const sub = await appTester(t.performSubscribe, { authData, targetUrl: "https://hooks.zapier.com/hooks/standard/1/test/" });
  assert.ok(sub.id);
  const list = await appTester(t.performList, { authData });
  assert.ok(Array.isArray(list));
  await appTester(t.performUnsubscribe, { authData, subscribeData: sub });
});

test("adds an employee", { skip }, async () => {
  const r = await appTester(App.creates.employee.operation.perform, { authData, inputData: { firstName: "Zapier", lastName: "Test", workEmail: `zapier.test.${Date.now()}@strats360.com`, dateOfJoining: "2026-12-01", sendInvite: "no" } });
  assert.strictEqual(r.status, "probation");
});
