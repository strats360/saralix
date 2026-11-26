# Saralix for Zapier

A Zapier app on top of the Saralix public API (`/api/v1`, see [docs/PUBLIC_API.md](../../docs/PUBLIC_API.md)).

**Triggers** (instant, using REST hooks): New Employee, Updated Employee, Employee Exit Completed, Leave Approved, Payroll Approved, Payroll Paid.

**Action:** Add Employee. Departments and designations are matched by name, and the person gets the onboarding email unless you turn it off.

## How customers connect

In Saralix, Settings → API & webhooks → New key. Name it Zapier and tick:

- Employees and their jobs
- Add employees
- Subscribe to events

Paste the key into Zapier. Companies on another Saralix site change the address field.

## Publishing it (one time, from your computer)

You need a Zapier account and Node 18 or newer.

```bash
cd integrations/zapier
npm ci
npm install -g zapier-platform-cli
zapier login
zapier register "Saralix"      # first time only: creates the app in your Zapier account
zapier push                    # uploads this version
```

Then in the Zapier developer platform, fill in the app's logo, description and category, invite a few customers to test it, and when you're ready, submit it for the public app directory. Zapier reviews it before it's listed.

For each new version, bump `version` in `package.json`, run `zapier push`, and migrate users from the developer platform.

## Testing

```bash
npm test                                                   # checks the app against Zapier's schema
SARALIX_SITE=http://localhost:8787 SARALIX_KEY=sx_... npm test   # also runs it against a Saralix API
```

The second form needs a key with the three scopes above. It adds one test employee, without an invite.
