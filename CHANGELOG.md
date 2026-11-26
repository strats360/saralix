# Changelog

All notable changes to Saralix are listed here, newest first.

Versions follow [semantic versioning](https://semver.org): **major** for changes that need customers or admins to do something (a breaking API change, a migration that removes data), **minor** for new features, **patch** for fixes. Each release is a git tag (`v1.0.0`) and a section below. How to cut a release is in [docs/DEPLOY.md](docs/DEPLOY.md#releasing-a-version).

## [Unreleased]

### Added

- Paid add-ons. The platform team sets each add-on's name, description and price (per employee or flat, a month) under Plans & pricing, and whether it's on sale. Companies switch add-ons on and off under Settings → Billing, with a monthly estimate for their headcount; they're free during the trial. Each add-on that was on during a month is its own line on that month's invoice, with GST. A feature flag on the same key can give one free to a company for a pilot.
- The first four add-ons are in the catalogue (AI assistant, Sign in and work tools, Face attendance kiosk, Forms and workflows), not on sale yet. Each goes on sale when its feature ships.
- Zapier. A Zapier app in `integrations/zapier` with instant triggers (new employee, updated employee, exit completed, leave approved, payroll approved, payroll paid) and an Add Employee action. See its README to publish it.
- Public API additions for Zapier and similar tools: `GET /v1/me`, subscribe and unsubscribe webhooks (`/v1/hooks`), recent event samples, and `POST /v1/employees` to add an employee who then gets the onboarding email. Two new key scopes: "Add employees" and "Subscribe to events".

### Planned

These need something from us before they can be built or switched on:

- Zoho Books push of the payroll journal (a Zoho API client ID and secret).
- WhatsApp payslips (a WhatsApp Business provider account and an approved template).
- Live bank payouts for salary (a payout partner such as Cashfree Payouts, RazorpayX, ICICI or HDFC).
- Native mobile apps (Apple Developer and Google Play accounts).
- State minimum wage tables by zone and skill, and an ESI and PT check against a second source (network access to hrengage.ai).
- A staging site, and the Gulf, Saudi, UK, US and Canada sites (a Neon database and GitHub environment for each). The country packs are already built.
- Expert review of the golden payroll files and of the flexible benefit caps.

## [1.3.0] - 2026-11-26

Engagement, company KYC, and OKRs, feedback and 1:1s.

### Added

- Engagement: pulse checks, polls and surveys with five answer types (1 to 5 rating, 0 to 10 recommend score for eNPS, one choice, several choices, written). Start from scratch or from a template (eNPS, monthly pulse, quick poll, new joiner check in), pick who it's for, set a closing date, and send it. People get an email and a reminder the day before it closes; it closes on its own.
- Anonymous surveys never store who said what. Results show once three people have answered, team breakdowns hide any team under three, and written answers are never shown by team. For named surveys HR sees who hasn't answered and can remind just them.
- Results with averages, the eNPS score, and bars for each answer, by department. HR can share the results with staff once a survey closes.
- Kudos: thank up to 10 colleagues at once for one of your company values. Everyone sees it on the kudos wall, the people thanked get an email, and anyone can cheer it. HR sets the values, can switch kudos off, sees who gives and gets the most, and can hide a post.
- Two new email switches: "Surveys and polls" and "Kudos for you".
- Company KYC. A company that signs up now verifies itself before it can add employees or run payroll: it sends its type of business, PAN, GSTIN (or why it has none), CIN or LLPIN, registered address and authorised signatory, and uploads the documents its type needs. We check the PAN matches the type of business and that the GSTIN contains the PAN. Until it's approved the company sees only its dashboard, KYC, company settings, admins, billing and support.
- A Company KYC queue in the platform console. The team opens each document, then approves, asks for more with a note, or rejects. The company's admins get an email either way, and every step is kept in the history and the audit log.
- "Verify your company" is now the first step on the Get started card.
- OKRs: objectives with two to six key results (a number, a percentage, an amount in rupees, or done or not) for the company, a team or a person, by quarter or year of the Indian financial year. Objectives line up under bigger ones, so the board shows how personal goals feed team and company goals. Owners check in with new values, how confident they are and a note; progress and history follow. HR sets company and team objectives; people add their own, and managers add and update their team's. Personal objectives are seen only by the person, their manager and HR.
- Feedback. Anyone can give a colleague feedback (what they do well, what they could do better), for them and their manager or for the manager only, and ask up to 10 colleagues for feedback about themselves. Requests arrive by email and in self-service, where people answer or decline.
- 360 feedback in reviews. The reviewing manager or HR asks colleagues for feedback on someone, with an overall 1 to 5. The manager and HR see who said what; the person sees the words without names once the review is shared, and only if at least three people answered.
- 1:1 meetings. A manager or their report books a 1:1, once or repeating every week, two weeks or month. Both add to the agenda and shared notes, each keeps private notes the other never sees, and follow ups have an owner and a date. Marking one done books the next, carrying over anything not covered. Booking, moving and cancelling email the other person.
- Self-service Performance now has four tabs: Reviews, OKRs, Feedback and 1:1s. New email switches: "Feedback" and "1:1 meetings".

### Changed

- The self-service top bar now fits next to the Admin console button: Kudos, Help and Concerns moved under More, and screens narrower than 1280 pixels use the bottom tab bar.

### Changed

- Companies that already exist, the demo and companies the platform team creates count as verified, so nothing changes for them.

## [1.2.1] - 2026-11-26

Fixes the error some people saw when opening a page in a tab from before a deploy.

### Fixed

- After a deploy, a tab opened before it no longer shows "Failed to fetch dynamically imported module". It reloads once by itself to pick up the new version.
- A page that fails now shows a Saralix error page with Reload and Go to dashboard, in place of the router's technical screen. The details go to the browser console, not the screen.

### Changed

- The build and deploy workflows use the Node 24 versions of their GitHub actions, which clears the Node 20 warning.

## [1.2.0] - 2026-11-26

The app, emails and PDFs now match saralix.com, with the Saralix mark as the logo and icons.

### Changed

- The app now matches saralix.com: warm off-white (or near-black in dark mode) backgrounds, white cards with a hairline border, black primary buttons (off-white in dark mode), and a green accent for links, the active menu item, focus rings, checks and progress. All purple and lavender is gone, from the dashboard to the sign-in pages, emails, payslip and Form 16 PDFs and the login.saralix.com page. Every text and control pair meets WCAG AA in both modes.
- The Saralix mark replaces the "S" tile in the sidebar, sign-in and sign-up, and in the favicon and app icons.

## [1.1.0] - 2026-11-25

Safer company sign-up, a setup checklist on the dashboard, and email through Cloudflare.

### Added

- Email through Cloudflare Email Service: set `EMAIL_SERVICE` to `cloudflare` and `EMAIL_FROM` to an address on a domain onboarded there, and deploy. Resend still works when that isn't set. The deploy summary and the health check say which one is in use.

### Changed

- Company sign-up now needs a work email: Gmail, Yahoo, Outlook and other personal or temporary addresses are refused. Employees and invited admins can still use any address.
- Sign-up is now three short steps: create your account, confirm your email from the link we send (no login exists until then), then sign in and add your company with just its name and state.
- No more setup wizard blocking the dashboard. A "Get started" card lists the essential steps (company details, PF and ESI, branches and pay cycle, employees, salaries) and the optional ones (other admins, salary bank account, leave policies, holidays, two-factor sign in), each done or pending with a link to it. The full wizard is still there for anyone who prefers it.

### Fixed

- The health check, control plane and platform console showed version 1.4.0, an old internal number. They now show the release version, and a test keeps it in step with package.json and this changelog.

## [1.0.0] - 2026-11-25

The first release: the India site at app.saralix.com, with everything built so far. The other country packs are in the code but only switch on when their sites are set up.

### Core HR

- Employees with personal, job, bank, statutory and custom fields; profile photos; bulk import and export.
- Org chart, legal entities, branches, departments and designations.
- Onboarding invites, probation confirmation reminders, and exits with full and final settlement and letters.
- Letter generator with templates, including an appointment letter with the OSH Code's fields.
- Assets, announcements, an employee helpdesk, and recruitment with a careers page.
- Performance reviews.

### Time and leave

- Attendance with selfie and location punches, office network checks, an installable app with offline punches, biometric device API and bulk upload.
- Shifts, shift roster, timesheets and comp off.
- Leave policies with accrual (including OSH Code leave from days worked), carry forward, encashment, multi-level approval chains and a holiday calendar.

### Payroll (India)

- Payroll run wizard, salary templates with custom and formula based allowances, CTC to structure.
- Monthly, biweekly, twice monthly and weekly pay periods.
- Labour Codes: Code wages (at least half of pay), EPF on the ₹25,000 ceiling from 17 September 2026, ESI on Code wages, gratuity after five years (one for fixed term), statutory bonus, overtime with the quarterly cap and consent.
- Income Tax Act 2025 form names from 2026-27, both regimes, HRA cities, declarations with proofs, Form 16 and the new forms.
- Voluntary PF, employer NPS, the car perquisite, and a flexible benefit plan claimed against bills.
- Professional tax and labour welfare fund for every state in the compliance report; minimum wage check.
- Off-cycle runs for bonuses and arrears, loans and salary advances, reimbursements paid with salary.
- Contractor payments with TDS under 194C and 194J (section 393 from 2026-27).
- Payslip PDFs, payment batches and bank files, reconciliation, and an accounting journal for Zoho Books, Tally or CSV.

### Compliance (India)

- PF, ESI, PT and LWF challans and returns, a compliance calendar, registrations with renewal dates, and headcount thresholds.
- POSH Internal Committee and Grievance Redressal Committee, with confidential cases and the POSH annual report.
- Maternity benefit, women's night shift consent and yearly health checks from 40.
- Contract labour: contractors, workers, licences and monthly wage and challan checks.
- Statutory registers (Forms A to E) and the unified annual return figures.
- DPDP Act: privacy notice, consent log, data export and erasure, breach register and retention.

### Platform

- Multi-company SaaS with plans, GST invoices, Cashfree payments and autopay, dunning and feature flags.
- Statutory master with versioned rules, support tickets with consented read-only access, audit log.
- Two-factor sign in, roles and permissions, notification settings.
- Public read-only API with keys, and signed webhooks.
- Reports, and free income tax and gratuity calculators at /tools.
- Multi-country groundwork: country packs for the UAE, Saudi Arabia, Qatar, Kuwait, Oman, Bahrain, the UK, the US and Canada; a control plane with one sign in page; wave rollouts, monitoring, backups and restore drills.

[Unreleased]: https://github.com/strats360/saralix/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/strats360/saralix/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/strats360/saralix/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/strats360/saralix/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/strats360/saralix/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/strats360/saralix/releases/tag/v1.0.0
