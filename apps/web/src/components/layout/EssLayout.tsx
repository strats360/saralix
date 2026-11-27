import { t as tr, useLocale } from "@/lib/i18n";
import { LanguageSwitch } from "./LanguageSwitch";
import { useEffect } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { Menu } from "@/components/ui/menu";
import { toast } from "sonner";
import { WifiOff } from "lucide-react";
import { queuedPunches, sendQueuedPunches } from "@/lib/offline";
import { useOnline } from "@/lib/pwa";
import { CalendarDays, ChevronDown, ClipboardList, Clock, Moon, ScanFace, Sun, GraduationCap, Home, LayoutDashboard, LogOut, PartyPopper, Percent, ShieldCheck, LifeBuoy, Receipt, Target, User, Wallet } from "lucide-react";
import { useSession } from "@/lib/session";
import * as M from "@radix-ui/react-dropdown-menu";
import { useTheme } from "@/lib/theme";
import { Brand } from "./Sidebar";

const TABS = [
  { to: "/me", label: "Home", icon: Home, end: true },
  { to: "/me/attendance", label: "Attendance", icon: Clock },
  { to: "/me/leave", label: "Leave", icon: CalendarDays },
  // desktop shows one "Pay" tab for payslips and tax; phones keep both
  { to: "/me/payslips", label: "Payslips", desktopLabel: "Pay", icon: Wallet },
  { to: "/me/tax", label: "Tax", icon: Percent, feature: "module.tds", desktop: false },
  { to: "/me/claims", label: "Claims", icon: Receipt, feature: "module.reimbursements" },
  // the phone tab bar has no room; phones reach reviews from Home
  { to: "/me/reviews", label: "Performance", icon: Target, feature: "module.performance", phone: false },
  // desktop puts these under "More" so the bar fits next to the admin console button
  { to: "/me/engagement", label: "Kudos", icon: PartyPopper, feature: "module.engagement", phone: false, more: true },
  { to: "/me/learning", label: "Learning", icon: GraduationCap, feature: "module.learning", phone: false, more: true },
  { to: "/me/forms", label: "Forms", icon: ClipboardList, feature: "addon.workflows", phone: false, more: true },
  { to: "/me/face", label: "Face punch", icon: ScanFace, feature: "addon.face_kiosk", phone: false, more: true },
  { to: "/me/helpdesk", label: "Help", icon: LifeBuoy, feature: "module.helpdesk", phone: false, more: true },
  { to: "/me/committees", label: "Concerns", icon: ShieldCheck, phone: false, more: true },
  // desktop reaches the profile from the avatar menu
  { to: "/me/profile", label: "Profile", icon: User, desktop: false },
];

/** Employee self-service: top bar on desktop, bottom tab bar on phones. */
export function EssLayout() {
  useLocale();
  const { tenant, me, signOut, has } = useSession();
  const tabs = TABS.filter((t) => !("feature" in t) || has((t as { feature: string }).feature));
  const phoneTabs = tabs.filter((t) => !("phone" in t && t.phone === false));
  const online = useOnline();
  const loc = useLocation();
  const navigate = useNavigate();
  // Reviews, OKRs, Feedback and 1:1s are one "Performance" tab
  const perf = ["/me/reviews", "/me/okrs", "/me/feedback", "/me/one-on-ones"].some((p) => loc.pathname.startsWith(p));
  const eid = tenant?.employeeId ?? null;
  // send punches saved offline as soon as there's a connection
  useEffect(() => {
    if (!online || !eid || !queuedPunches(eid).length) return;
    void sendQueuedPunches(eid).then((r) => {
      if (r.sent) toast.success(`${r.sent} punch${r.sent === 1 ? "" : "es"} saved offline ${r.sent === 1 ? "was" : "were"} sent`);
      for (const f of r.failed) toast.error(`A punch saved offline wasn't accepted: ${f}`);
    });
  }, [online, eid]);
  if (!tenant?.employeeId) return <Navigate to={tenant?.roleId ? "/" : "/login"} replace />;
  return (
    <div className="min-h-screen pb-20 xl:pb-10" style={{ background: "var(--color-bg)", color: "var(--color-text)" }}>
      <header className="sticky top-0 z-10 border-b border-[var(--color-divider)]" style={{ paddingTop: "env(safe-area-inset-top)", background: "color-mix(in srgb, var(--color-bg) 92%, transparent)", backdropFilter: "blur(8px)" }}>
        <div className="mx-auto flex max-w-[1100px] items-center gap-3 px-4 py-2.5">
          <div className="-mb-[18px] min-w-0 max-w-[200px] shrink">
            <Brand subtitle={tenant.tenantName} />
          </div>
          <nav className="ms-4 hidden gap-1 xl:flex" aria-label="Self-service">
            {tabs.filter((t) => !("more" in t) && !("desktop" in t)).map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end} className="whitespace-nowrap rounded-[var(--radius-md)] px-3 py-2 text-[14px] no-underline hover:bg-[var(--tint-1)]" style={({ isActive: hit }) => { const isActive = hit || (t.to === "/me/reviews" && perf) || (t.to === "/me/payslips" && loc.pathname.startsWith("/me/tax")); return { background: isActive ? "var(--sel-bg)" : undefined, color: isActive ? "var(--sel-fg)" : "var(--color-text)", fontWeight: isActive ? 600 : 400 }; }}>
                {tr((t as { desktopLabel?: string }).desktopLabel ?? t.label)}
              </NavLink>
            ))}
            {tabs.some((t) => "more" in t) ? (
              <Menu
                align="start"
                trigger={<button type="button" className="cursor-pointer rounded-[var(--radius-md)] border-0 bg-transparent px-3 py-2 text-[14px] hover:bg-[var(--tint-1)]" style={{ color: tabs.some((t) => "more" in t && loc.pathname.startsWith(t.to)) ? "var(--sel-fg)" : "var(--color-text)" }}>{tr("More")}</button>}
                items={tabs.filter((t) => "more" in t).map((t) => ({ label: tr(t.label), onSelect: () => navigate(t.to) }))}
              />
            ) : null}
          </nav>
          <div className="ms-auto flex items-center gap-2">
            {tenant.roleId ? (
              <NavLink to="/" className="btn btn-secondary hidden whitespace-nowrap !text-[13px] sm:inline-flex" aria-label={tr("Admin console")} title={tr("Admin console")}>
                <LayoutDashboard size={15} /> <span>{tr("Admin console")}</span>
              </NavLink>
            ) : null}
            <LanguageSwitch />
            <AccountMenu name={me?.user.name ?? ""} email={me?.user.email ?? ""} company={tenant.tenantName} onSignOut={signOut} />
          </div>
        </div>
      </header>
      {!online ? (
        <div className="flex items-center justify-center gap-2 px-4 py-1.5 text-[12.5px]" style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }} role="status">
          <WifiOff size={14} /> You're offline. Punches are saved on this phone and sent when you reconnect.
        </div>
      ) : null}
      <main className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 pt-5">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-10 grid border-t border-[var(--color-divider)] xl:hidden" aria-label="Self-service" style={{ background: "var(--color-surface)", gridTemplateColumns: `repeat(${phoneTabs.length}, minmax(0, 1fr))`, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {phoneTabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className="flex min-w-0 flex-col items-center gap-0.5 py-2 text-[10.5px] no-underline" style={({ isActive }) => ({ color: isActive ? "var(--sel-fg)" : "var(--muted)" })}>
            <t.icon size={20} />
            {tr(t.label)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** The avatar button: who you are, your profile and account, the theme, and sign out. */
function AccountMenu({ name, email, company, onSignOut }: { name: string; email: string; company: string; onSignOut: () => void }) {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const item = "flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-[8px] text-[13.5px] outline-none data-[highlighted]:bg-[var(--tint-1)]";
  return (
    <M.Root modal={false}>
      <M.Trigger asChild>
        <button type="button" className="flex cursor-pointer items-center gap-1.5 rounded-full border-0 bg-transparent p-0.5 hover:bg-[var(--tint-1)]" aria-label={`${tr("Your account")}: ${name}`}>
          <span className="grid size-9 place-items-center rounded-full text-[13px] font-semibold" style={{ background: "var(--sel-bg)", color: "var(--sel-fg)" }}>{initials(name)}</span>
          <ChevronDown size={14} className="text-muted me-1" aria-hidden />
        </button>
      </M.Trigger>
      <M.Portal>
        <M.Content align="end" sideOffset={6} collisionPadding={8} className="card elev-md z-50 w-[260px] !gap-px !p-1.5">
          <div className="px-2.5 pb-2 pt-1.5">
            <div className="truncate text-[14px] font-medium">{name}</div>
            <div className="text-muted truncate text-[12px]">{email}</div>
            <div className="text-muted truncate text-[12px]">{company}</div>
          </div>
          <M.Separator className="my-1 h-px bg-[var(--color-divider)]" />
          <M.Item className={item} onSelect={() => navigate("/me/profile")}><User size={16} /> {tr("My profile")}</M.Item>
          <M.Item className={item} onSelect={() => navigate("/account/security")}><ShieldCheck size={16} /> {tr("Sign-in and security")}</M.Item>
          <M.Item className={item} onSelect={(e) => { e.preventDefault(); toggle(); }}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />} {theme === "dark" ? tr("Light mode") : tr("Dark mode")}</M.Item>
          <M.Separator className="my-1 h-px bg-[var(--color-divider)]" />
          <M.Item className={item} style={{ color: "var(--bad)" }} onSelect={onSignOut}><LogOut size={16} /> {tr("Sign out")}</M.Item>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
