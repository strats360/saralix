import { useSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page";
import { RouteTabs } from "@/components/ui/tabs";
import { useLookups } from "@/components/recruitment/shared";
import { OkrBoard } from "@/components/okrs/OkrBoard";

export const PERFORMANCE_TABS = [
  { to: "/performance", label: "Review cycles", end: true },
  { to: "/performance/okrs", label: "OKRs" },
];

/** Company, team and personal objectives, for HR. */
export default function Okrs() {
  const { can } = useSession();
  const L = useLookups();
  const hr = can("employees", "edit");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Performance" sub="Objectives and key results for the company, teams and people, with regular check ins" />
      <RouteTabs tabs={PERFORMANCE_TABS} />
      <OkrBoard base="/admin/okrs" hr={hr} readOnly={!hr} people={(L.data?.employees ?? []).map((e) => ({ id: e.id, name: e.name, hint: e.code }))} departments={L.data?.departments ?? []} />
    </div>
  );
}
