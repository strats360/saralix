# Changelog

All notable changes to Saralix are listed here, newest first.

Versions follow [semantic versioning](https://semver.org): **major** for changes that need customers or admins to do something (a breaking API change, a migration that removes data), **minor** for new features, **patch** for fixes. Each release is a git tag (`v1.0.0`) and a section below. How to cut a release is in [docs/DEPLOY.md](docs/DEPLOY.md#releasing-a-version).

## [Unreleased]

Nothing yet.

### Planned

These need something from us before they can be built or switched on:

- Zoho Books push of the payroll journal (a Zoho API client ID and secret).
- WhatsApp payslips (a WhatsApp Business provider account and an approved template).
- Live bank payouts for salary (a payout partner such as Cashfree Payouts, RazorpayX, ICICI or HDFC).
- Native mobile apps (Apple Developer and Google Play accounts).
- State minimum wage tables by zone and skill, and an ESI and PT check against a second source (network access to hrengage.ai).
- A staging site, and the Gulf, Saudi, UK, US and Canada sites (a Neon database and GitHub environment for each). The country packs are already built.
- Expert review of the golden payroll files and of the flexible benefit caps.

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

[Unreleased]: https://github.com/strats360/saralix/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/strats360/saralix/releases/tag/v1.0.0
