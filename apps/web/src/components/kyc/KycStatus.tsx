import { Link } from "react-router";
import { Clock, FileCheck2, ShieldAlert, ShieldCheck } from "lucide-react";
import { KYC_STATUS_LABEL, type KycStatus } from "@hrms/shared";
import { Card } from "@/components/ui/card";

/** Unverified companies can only set up and send KYC. Support sessions are never locked. */
export const kycLocked = (t: { kycStatus?: string; support?: unknown } | null | undefined) => !!t?.kycStatus && t.kycStatus !== "approved" && !t.support;

const COPY: Record<KycStatus, { title: string; body: string; cta?: string }> = {
  draft: { title: "Verify your company to get started", body: "Send your PAN, registration and address proof. We check it within one working day. Until then you can set up your company, but you can't add employees or run payroll.", cta: "Start KYC" },
  needs_info: { title: "We need a little more for your KYC", body: "We've looked at what you sent and need something more before we can verify your company.", cta: "See what's needed" },
  submitted: { title: "We're checking your KYC", body: "Thanks. We'll email you within one working day. Meanwhile you can finish setting up your company details, branches and pay cycle." },
  rejected: { title: "We couldn't verify your company", body: "Your KYC wasn't approved. If you think this is a mistake, raise a support ticket and we'll look again." },
  approved: { title: "Your company is verified", body: "" },
};

/** The KYC card on the dashboard, and the page shown in place of anything that needs KYC. */
export function KycStatusCard({ status, note, compact }: { status: KycStatus; note?: string | null; compact?: boolean }) {
  const c = COPY[status];
  const Icon = status === "submitted" ? Clock : status === "rejected" ? ShieldAlert : status === "approved" ? ShieldCheck : FileCheck2;
  const tone = status === "rejected" ? { bg: "var(--bad-bg)", fg: "var(--bad)" } : status === "needs_info" ? { bg: "var(--warn-bg)", fg: "var(--warn)" } : { bg: "var(--color-accent-tint)", fg: "var(--color-accent)" };
  return (
    <Card className={compact ? "gap-3 sm:flex-row sm:items-center" : "items-center gap-0 px-6 py-10 text-center"}>
      <span className={`grid flex-none place-items-center rounded-full ${compact ? "h-11 w-11" : "h-14 w-14"}`} style={{ background: tone.bg, color: tone.fg }} aria-hidden>
        <Icon size={compact ? 20 : 24} strokeWidth={1.8} />
      </span>
      <div className={compact ? "min-w-0 flex-1" : "mt-4 max-w-[460px]"}>
        <div className="card-kicker">KYC · {KYC_STATUS_LABEL[status]}</div>
        <div className={compact ? "text-[16px] font-medium" : "mt-1 text-[22px] font-medium tracking-[-0.01em]"}>{c.title}</div>
        <p className="text-muted m-0 mt-1 text-[13.5px] leading-relaxed">{c.body}</p>
        {note && (status === "needs_info" || status === "rejected") ? <p className="m-0 mt-2 rounded-[var(--radius-md)] px-3 py-2 text-start text-[13.5px]" style={{ background: "var(--tint-1)" }}>{note}</p> : null}
      </div>
      <div className={compact ? "flex-none" : "mt-5 flex flex-wrap justify-center gap-2"}>
        {c.cta ? <Link to="/kyc" className="btn btn-primary">{c.cta}</Link> : status === "submitted" ? <Link to="/kyc" className="btn btn-secondary">View what you sent</Link> : status === "rejected" ? <Link to="/support" className="btn btn-secondary">Contact support</Link> : null}
      </div>
    </Card>
  );
}
