/**
 * What a new company still has to set up, shown on the dashboard instead of a wizard that
 * blocks everything. Required steps are needed before the first payroll; the rest can wait.
 */
export const SETUP_ITEMS = [
  { key: "company", required: true, title: "Company details", detail: "PAN, TAN, GSTIN and registered address, for payslips, challans and Form 16", to: "/setup?step=1", manual: false },
  { key: "statutory", required: true, title: "PF, ESI, PT and LWF", detail: "Turn on the schemes you're registered for and add their numbers", to: "/setup?step=2", manual: false },
  { key: "payroll", required: true, title: "Branches and pay cycle", detail: "Your offices, pay day and how paid days are counted", to: "/setup?step=3", manual: false },
  { key: "employees", required: true, title: "Add your employees", detail: "One by one, by Excel import, or by sending self-onboarding invites", to: "/employees/new", manual: false },
  { key: "salaries", required: true, title: "Set salaries", detail: "Each employee's CTC, split by your salary template", to: "/payroll/structure", manual: false },
  { key: "admins", required: false, title: "Invite other admins", detail: "HR, payroll or finance colleagues, each with their own role", to: "/settings/access", manual: false },
  { key: "bank", required: false, title: "Add your salary bank account", detail: "The account salaries are paid from, for bank upload files", to: "/payments/accounts", manual: false },
  { key: "leave", required: false, title: "Check leave policies", detail: "We've added casual, sick and earned leave. Change the quotas to match your policy", to: "/leave/policies", manual: true },
  { key: "holidays", required: false, title: "Check the holiday calendar", detail: "We've added national holidays. Add your state and company holidays", to: "/leave/holidays", manual: true },
  { key: "security", required: false, title: "Turn on two-factor sign in", detail: "Protect your admin login with an authenticator app", to: "/account/security", manual: false },
] as const;
export type SetupItemKey = (typeof SETUP_ITEMS)[number]["key"];
