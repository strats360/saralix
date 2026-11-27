import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from "react-router";
import { useSession } from "@/lib/session";
import { Loading } from "@/components/ui/page";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { PlatformLayout } from "@/components/layout/PlatformLayout";
import { EssLayout } from "@/components/layout/EssLayout";
import { ErrorPage } from "@/components/errors/ErrorPage";
import { retryImport } from "@/lib/stale-build";

const L = (f: () => Promise<{ default: React.ComponentType }>) => {
  const C = lazy(retryImport(f));
  return (
    <Suspense fallback={<Loading />}>
      <C />
    </Suspense>
  );
};

/** Must be signed in. */
function RequireAuth({ children }: { children?: ReactNode }) {
  const { me, loading, needsTwoFactor } = useSession();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  // the company requires two-factor: set it up before anything else (platform pages aren't company-bound)
  if (needsTwoFactor && !loc.pathname.startsWith("/account") && !loc.pathname.startsWith("/platform")) return <Navigate to="/account/security?required=1" replace />;
  return <>{children ?? <Outlet />}</>;
}

/** "/" decides where a user lands. */
function Home() {
  const { me, tenant } = useSession();
  if (tenant?.roleId) return <AdminLayout />;
  if (tenant?.employeeId) return <Navigate to="/me" replace />;
  if (me?.platformRole) return <Navigate to="/platform" replace />;
  if (me?.canCreateCompany) return <Navigate to="/get-started" replace />;
  return <Navigate to="/no-access" replace />;
}

const router = createBrowserRouter([
  {
    // any page that throws shows the Saralix error page, not the router's default screen
    errorElement: <ErrorPage />,
    children: [
    // public
    { path: "/login", element: L(() => import("@/pages/auth/Login")) },
    { path: "/forgot-password", element: L(() => import("@/pages/auth/ForgotPassword")) },
    { path: "/reset-password", element: L(() => import("@/pages/auth/ResetPassword")) },
    { path: "/signup", element: L(() => import("@/pages/auth/Signup")) },
    { path: "/signup/verify", element: L(() => import("@/pages/auth/VerifyEmail")) },
    { path: "/onboarding/:token", element: L(() => import("@/pages/auth/InviteAccept")) },
    { path: "/careers/:slug", element: L(() => import("@/pages/careers/Careers")) },
    { path: "/careers/:slug/jobs/:id", element: L(() => import("@/pages/careers/Careers").then((m) => ({ default: m.CareersJob }))) },
    { path: "/invite/admin/:token", element: L(() => import("@/pages/auth/AdminInvite")) },
    { path: "/tools", element: L(() => import("@/pages/tools/Tools")) },
    { path: "/tools/:tool", element: L(() => import("@/pages/tools/Tools")) },
    {
      element: <RequireAuth />,
      children: [
        { path: "/no-access", element: L(() => import("@/pages/auth/NoAccess")) },
        { path: "/account/security", element: L(() => import("@/pages/account/Security")) },
        { path: "/setup", element: L(() => import("@/pages/setup/CompanySetup")) },
        { path: "/get-started", element: L(() => import("@/pages/auth/CreateCompany")) },
        { path: "/me/onboarding", element: L(() => import("@/pages/ess/Onboarding")) },
        {
          path: "/me",
          element: <EssLayout />,
          children: [
            { index: true, element: L(() => import("@/pages/ess/Home")) },
            { path: "attendance", element: L(() => import("@/pages/ess/Attendance")) },
            { path: "leave", element: L(() => import("@/pages/ess/Leave")) },
            { path: "profile", element: L(() => import("@/pages/ess/Profile")) },
            { path: "payslips", element: L(() => import("@/pages/ess/Payslips")) },
            { path: "tax", element: L(() => import("@/pages/ess/Tax")) },
            { path: "claims", element: L(() => import("@/pages/ess/Claims")) },
            { path: "committees", element: L(() => import("@/pages/ess/Committees")) },
            { path: "committees/:id", element: L(() => import("@/pages/ess/Committees")) },
            { path: "reviews", element: L(() => import("@/pages/ess/Reviews")) },
            { path: "okrs", element: L(() => import("@/pages/ess/Okrs")) },
            { path: "feedback", element: L(() => import("@/pages/ess/Feedback")) },
            { path: "one-on-ones", element: L(() => import("@/pages/ess/OneOnOnes")) },
            { path: "interviews", element: L(() => import("@/pages/ess/Interviews")) },
            { path: "timesheets", element: L(() => import("@/pages/ess/Timesheets")) },
            { path: "announcements", element: L(() => import("@/pages/ess/Announcements")) },
            { path: "announcements/:id", element: L(() => import("@/pages/ess/Announcements").then((m) => ({ default: m.EssAnnouncement }))) },
            { path: "helpdesk", element: L(() => import("@/pages/ess/Helpdesk")) },
            { path: "helpdesk/:id", element: L(() => import("@/pages/ess/Helpdesk").then((m) => ({ default: m.EssTicket }))) },
            { path: "engagement", element: L(() => import("@/pages/ess/Engagement")) },
            { path: "learning", element: L(() => import("@/pages/ess/Learning")) },
            { path: "forms", element: L(() => import("@/pages/ess/Forms")) },
            { path: "forms/new/:formId", element: L(() => import("@/pages/ess/Forms").then((m) => ({ default: m.FillForm }))) },
            { path: "forms/:id", element: L(() => import("@/pages/ess/Forms").then((m) => ({ default: m.MyRequest }))) },
            { path: "learning/:id", element: L(() => import("@/pages/ess/Learning").then((m) => ({ default: m.CoursePlayer }))) },
            { path: "engagement/surveys/:id", element: L(() => import("@/pages/ess/Engagement").then((m) => ({ default: m.EssSurvey }))) },
          ],
        },
        {
          path: "/platform",
          element: <PlatformLayout />,
          children: [
            { index: true, element: L(() => import("@/pages/platform/Overview")) },
            { path: "tenants", element: L(() => import("@/pages/platform/Tenants")) },
            { path: "staff", element: L(() => import("@/pages/platform/Staff")) },
            { path: "audit", element: L(() => import("@/pages/platform/Audit")) },
            { path: "plans", element: L(() => import("@/pages/platform/Plans")) },
            { path: "billing", element: L(() => import("@/pages/platform/Billing")) },
            { path: "settings", element: L(() => import("@/pages/platform/Settings")) },
            { path: "flags", element: L(() => import("@/pages/platform/Flags")) },
            { path: "statutory", element: L(() => import("@/pages/platform/Statutory")) },
            { path: "kyc", element: L(() => import("@/pages/platform/Kyc")) },
            { path: "kyc/:tenantId", element: L(() => import("@/pages/platform/Kyc").then((m) => ({ default: m.KycReview }))) },
            { path: "tickets", element: L(() => import("@/pages/platform/Tickets")) },
            { path: "tickets/:id", element: L(() => import("@/pages/platform/TicketDetail")) },
            { path: "*", element: L(() => import("@/pages/Soon")) },
          ],
        },
        {
          path: "/",
          element: <Home />,
          children: [
            { index: true, element: L(() => import("@/pages/admin/Dashboard")) },
            {
              path: "employees",
              element: L(() => import("@/pages/admin/employees/EmployeesLayout")),
              children: [
                { index: true, element: L(() => import("@/pages/admin/employees/Directory")) },
                { path: "onboarding", element: L(() => import("@/pages/admin/employees/Onboarding")) },
                { path: "exits", element: L(() => import("@/pages/admin/employees/Exits")) },
                { path: "org-chart", element: L(() => import("@/pages/admin/employees/OrgChart")) },
                { path: "probation", element: L(() => import("@/pages/admin/employees/Probation")) },
                { path: "expiring-ids", element: L(() => import("@/pages/admin/employees/ExpiringIds")) },
                { path: "data-requests", element: L(() => import("@/pages/admin/employees/DataRequests")) },
                { path: "new", element: L(() => import("@/pages/admin/employees/EmployeeForm")) },
              ],
            },
            { path: "helpdesk", element: L(() => import("@/pages/admin/helpdesk/Helpdesk")) },
            { path: "helpdesk/:id", element: L(() => import("@/pages/admin/helpdesk/Ticket")) },
            { path: "announcements", element: L(() => import("@/pages/admin/announcements/Announcements")) },
            { path: "engagement", element: L(() => import("@/pages/admin/engagement/Engagement")) },
            { path: "engagement/kudos", element: L(() => import("@/pages/admin/engagement/Engagement").then((m) => ({ default: m.KudosAdmin }))) },
            { path: "engagement/settings", element: L(() => import("@/pages/admin/engagement/Engagement").then((m) => ({ default: m.EngagementSettings }))) },
            { path: "engagement/surveys/:id", element: L(() => import("@/pages/admin/engagement/Survey")) },
            { path: "learning", element: L(() => import("@/pages/admin/learning/Learning")) },
            { path: "forms", element: L(() => import("@/pages/admin/forms/Forms")) },
            { path: "forms/requests", element: L(() => import("@/pages/admin/forms/Forms").then((m) => ({ default: m.FormRequests }))) },
            { path: "forms/requests/:sid", element: L(() => import("@/pages/admin/forms/Forms").then((m) => ({ default: m.FormRequestPage }))) },
            { path: "forms/:id", element: L(() => import("@/pages/admin/forms/Forms").then((m) => ({ default: m.FormPage }))) },
            { path: "learning/:id", element: L(() => import("@/pages/admin/learning/Learning").then((m) => ({ default: m.CoursePage }))) },
            { path: "assets", element: L(() => import("@/pages/admin/assets/Assets")) },
            { path: "assets/:id", element: L(() => import("@/pages/admin/assets/AssetDetail")) },
            { path: "recruitment", element: L(() => import("@/pages/admin/recruitment/Jobs")) },
            { path: "recruitment/candidates", element: L(() => import("@/pages/admin/recruitment/Candidates")) },
            { path: "recruitment/candidates/:id", element: L(() => import("@/pages/admin/recruitment/CandidateDetail")) },
            { path: "recruitment/jobs/:id", element: L(() => import("@/pages/admin/recruitment/JobDetail")) },
            { path: "performance", element: L(() => import("@/pages/admin/performance/Cycles")) },
            { path: "performance/okrs", element: L(() => import("@/pages/admin/performance/Okrs")) },
            { path: "performance/reviews/:id", element: L(() => import("@/pages/admin/performance/ReviewPage")) },
            { path: "performance/:id", element: L(() => import("@/pages/admin/performance/CycleDetail")) },
            { path: "employees/exits/:id", element: L(() => import("@/pages/admin/employees/ExitDetail")) },
            { path: "employees/:id", element: L(() => import("@/pages/admin/employees/EmployeeProfile")) },
            { path: "employees/:id/edit", element: L(() => import("@/pages/admin/employees/EmployeeForm")) },
            {
              path: "attendance",
              element: L(() => import("@/pages/admin/attendance/AttendanceLayout")),
              children: [
                { index: true, element: L(() => import("@/pages/admin/attendance/Today")) },
                { path: "monthly", element: L(() => import("@/pages/admin/attendance/Monthly")) },
                { path: "corrections", element: L(() => import("@/pages/admin/attendance/Corrections")) },
                { path: "policies", element: L(() => import("@/pages/admin/attendance/Policies")) },
                { path: "roster", element: L(() => import("@/pages/admin/attendance/Roster")) },
                { path: "timesheets", element: L(() => import("@/pages/admin/attendance/Timesheets")) },
              ],
            },
            {
              path: "leave",
              element: L(() => import("@/pages/admin/leave/LeaveLayout")),
              children: [
                { index: true, element: L(() => import("@/pages/admin/leave/Requests")) },
                { path: "balances", element: L(() => import("@/pages/admin/leave/Balances")) },
                { path: "comp-off", element: L(() => import("@/pages/admin/leave/CompOff")) },
                { path: "policies", element: L(() => import("@/pages/admin/leave/Policies")) },
                { path: "holidays", element: L(() => import("@/pages/admin/leave/Holidays")) },
              ],
            },
            {
              path: "payroll",
              element: L(() => import("@/pages/admin/payroll/PayrollLayout")),
              children: [
                { index: true, element: L(() => import("@/pages/admin/payroll/Runs")) },
                { path: "structure", element: L(() => import("@/pages/admin/payroll/Structure")) },
                { path: "review", element: L(() => import("@/pages/admin/payroll/Review")) },
                { path: "payslips", element: L(() => import("@/pages/admin/payroll/Payslips")) },
                { path: "loans", element: L(() => import("@/pages/admin/payroll/Loans")) },
                { path: "contractors", element: L(() => import("@/pages/admin/payroll/Contractors")) },
                { path: "benefits", element: L(() => import("@/pages/admin/payroll/Fbp")) },
              ],
            },
            {
              path: "compliance",
              element: L(() => import("@/pages/admin/compliance/ComplianceLayout")),
              children: [
                { index: true, element: L(() => import("@/pages/admin/compliance/Overview")) },
                { path: "employee", element: L(() => import("@/pages/admin/compliance/EmployeeWise")) },
                { path: "challans", element: L(() => import("@/pages/admin/compliance/Challans")) },
                { path: "rules", element: L(() => import("@/pages/admin/compliance/Rules")) },
                { path: "committees", element: L(() => import("@/pages/admin/compliance/Committees")) },
                { path: "workplace", element: L(() => import("@/pages/admin/compliance/Workplace")) },
                { path: "contract-labour", element: L(() => import("@/pages/admin/compliance/ContractLabour")) },
                { path: "registers", element: L(() => import("@/pages/admin/compliance/Registers")) },
              ],
            },
            {
              path: "tds",
              element: L(() => import("@/pages/admin/tds/TdsLayout")),
              children: [
                { index: true, element: L(() => import("@/pages/admin/tds/Summary")) },
                { path: "compute", element: L(() => import("@/pages/admin/tds/Computation")) },
                { path: "declarations", element: L(() => import("@/pages/admin/tds/Declarations")) },
                { path: "form16", element: L(() => import("@/pages/admin/tds/Form16")) },
              ],
            },
            {
              path: "reimbursements",
              element: L(() => import("@/pages/admin/reimbursements/ReimbursementsLayout")),
              children: [
                { index: true, element: L(() => import("@/pages/admin/reimbursements/Queue")) },
                { path: "history", element: L(() => import("@/pages/admin/reimbursements/History")) },
                { path: "travel", element: L(() => import("@/components/travel/Travel").then((m) => ({ default: m.AdminTravel }))) },
                { path: "categories", element: L(() => import("@/pages/admin/reimbursements/Categories")) },
              ],
            },
            {
              path: "payments",
              element: L(() => import("@/pages/admin/payments/PaymentsLayout")),
              children: [
                { index: true, element: L(() => import("@/pages/admin/payments/Batches").then((m) => ({ default: () => <m.default type="salary" /> }))) },
                { path: "reimbursements", element: L(() => import("@/pages/admin/payments/Batches").then((m) => ({ default: () => <m.default type="reimbursement" /> }))) },
                { path: "bonus", element: L(() => import("@/pages/admin/payments/Batches").then((m) => ({ default: () => <m.default type="bonus" /> }))) },
                { path: "other", element: L(() => import("@/pages/admin/payments/Batches").then((m) => ({ default: () => <m.default type="other" /> }))) },
                { path: "reconciliation", element: L(() => import("@/pages/admin/payments/Reconciliation")) },
                { path: "accounts", element: L(() => import("@/pages/admin/payments/Accounts")) },
              ],
            },
            { path: "reports", element: L(() => import("@/pages/admin/reports/Reports")) },
            { path: "support", element: L(() => import("@/pages/admin/support/Support")) },
            { path: "kyc", element: L(() => import("@/pages/admin/kyc/Kyc")) },
            { path: "payments/batches/:id", element: L(() => import("@/pages/admin/payments/BatchDetail")) },
            { path: "payroll/run/:runId", element: L(() => import("@/pages/admin/payroll/RunWizard")) },
            {
              path: "settings",
              element: L(() => import("@/pages/admin/settings/SettingsLayout")),
              children: [
                { index: true, element: L(() => import("@/pages/admin/settings/Organization")) },
                { path: "structure", element: L(() => import("@/pages/admin/settings/Structure")) },
                { path: "entities", element: L(() => import("@/pages/admin/settings/Entities")) },
                { path: "approvals", element: L(() => import("@/pages/admin/settings/Approvals")) },
                { path: "notifications", element: L(() => import("@/pages/admin/settings/Notifications")) },
                { path: "letters", element: L(() => import("@/pages/admin/settings/Letters")) },
                { path: "custom-fields", element: L(() => import("@/pages/admin/settings/CustomFields")) },
                { path: "accounting", element: L(() => import("@/pages/admin/settings/Accounting")) },
                { path: "integrations", element: L(() => import("@/pages/admin/settings/Integrations")) },
                { path: "access", element: L(() => import("@/pages/admin/settings/Access")) },
                { path: "audit", element: L(() => import("@/pages/admin/settings/Audit")) },
                { path: "billing", element: L(() => import("@/pages/admin/settings/Billing")) },
              ],
            },
            { path: "*", element: L(() => import("@/pages/Soon")) },
          ],
        },
      ],
    },
    { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
