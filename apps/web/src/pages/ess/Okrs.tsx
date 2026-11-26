import { RouteTabs } from "@/components/ui/tabs";
import { OkrBoard } from "@/components/okrs/OkrBoard";

export const ESS_PERFORMANCE_TABS = [
  { to: "/me/reviews", label: "Reviews" },
  { to: "/me/okrs", label: "OKRs" },
  { to: "/me/feedback", label: "Feedback" },
  { to: "/me/one-on-ones", label: "1:1s" },
];

/** My objectives, my team's, and the company and team ones they line up under. */
export default function EssOkrs() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="!mb-1 text-[26px]">Performance</h1>
        <div className="text-muted text-[13.5px]">Your objectives and how they feed your team's and the company's. Check in every week or two.</div>
      </div>
      <RouteTabs tabs={ESS_PERFORMANCE_TABS} />
      <OkrBoard base="/ess/okrs" hr={false} />
    </div>
  );
}
