import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Heart, Lock, Trash2 } from "lucide-react";
import type { CompanyValue, QuestionResult } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/page";

export interface Results {
  responses: number;
  invited: number;
  hidden: boolean;
  minimum: number;
  questions: QuestionResult[] | null;
  breakdown: { departmentId: string | null; name: string; responses: number; hidden: boolean; headlines: string[] }[];
}

/** A horizontal bar: share of the whole, in the accent. */
function Bar({ value, max, label, count }: { value: number; max: number; label: string; count: number }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(80px,180px)_1fr_auto] items-center gap-3 text-[13px]">
      <span className="truncate">{label}</span>
      <span className="h-2 overflow-hidden rounded-full" style={{ background: "var(--tint-2)" }}>
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: "var(--color-accent)" }} />
      </span>
      <span className="num text-muted w-[70px] text-end">{count} · {pct}%</span>
    </div>
  );
}

/** Written answers: the first eight, then the rest on request. */
function Comments({ list }: { list: string[] }) {
  const [all, setAll] = useState(false);
  if (!list.length) return <div className="text-muted text-[13px]">No comments.</div>;
  const shown = all ? list : list.slice(0, 8);
  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {shown.map((c, i) => <li key={i} className="rounded-[var(--radius-md)] px-3 py-2 text-[13.5px]" style={{ background: "var(--tint-1)" }}>{c}</li>)}
      </ul>
      {list.length > 8 ? <Button size="sm" variant="ghost" className="self-start" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${list.length} comments`}</Button> : null}
    </div>
  );
}

function QuestionBlock({ q, n }: { q: QuestionResult; n: number }) {
  return (
    <Card className="gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="card-kicker">Question {n}</div>
          <div className="text-[15px] font-medium">{q.text}</div>
        </div>
        {q.type === "scale" ? (
          <div className="text-end"><div className="stat-value">{q.average ?? "–"}</div><div className="text-muted text-[12px]">out of 5 · {q.answered} answers</div></div>
        ) : q.type === "enps" ? (
          <div className="text-end"><div className="stat-value">{q.score === null ? "–" : `${q.score > 0 ? "+" : ""}${q.score}`}</div><div className="text-muted text-[12px]">eNPS · {q.answered} answers</div></div>
        ) : (
          <div className="text-muted text-[12px]">{q.answered} answers</div>
        )}
      </div>
      {q.type === "scale" ? <div className="flex flex-col gap-1.5">{[5, 4, 3, 2, 1].map((s) => <Bar key={s} label={`${s} ${s === 5 ? "(strongly agree)" : s === 1 ? "(strongly disagree)" : ""}`} value={q.counts[s - 1]!} max={q.answered} count={q.counts[s - 1]!} />)}</div> : null}
      {q.type === "enps" ? (
        <div className="flex flex-col gap-1.5">
          <Bar label="Promoters (9 to 10)" value={q.promoters} max={q.answered} count={q.promoters} />
          <Bar label="Passives (7 to 8)" value={q.passives} max={q.answered} count={q.passives} />
          <Bar label="Detractors (0 to 6)" value={q.detractors} max={q.answered} count={q.detractors} />
        </div>
      ) : null}
      {q.type === "choice" || q.type === "multi" ? <div className="flex flex-col gap-1.5">{q.options.map((o) => <Bar key={o.label} label={o.label} value={o.count} max={q.answered} count={o.count} />)}</div> : null}
      {q.type === "text" ? <Comments list={q.comments} /> : null}
    </Card>
  );
}

/** Results of a survey. HR also sees the breakdown by team. */
export function SurveyResults({ r, anonymous }: { r: Results; anonymous: boolean }) {
  if (r.hidden) {
    return (
      <Notice tone="sel">
        <span className="inline-flex items-center gap-2"><Lock size={15} /> Results appear once {r.minimum} people have answered, so nobody's answers can be picked out. {r.responses} so far.</span>
      </Notice>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {r.questions?.map((q, i) => <QuestionBlock key={q.id} q={q} n={i + 1} />)}
      {r.breakdown.length ? (
        <Card className="gap-2">
          <div className="text-[15px] font-medium">By department</div>
          {anonymous ? <div className="text-muted text-[12.5px]">Teams with fewer than {r.minimum} answers are hidden, and written answers are never shown by team.</div> : null}
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Department</th><th className="text-end">Answers</th>{r.questions?.map((q, i) => (q.type === "text" ? null : <th key={q.id}>Q{i + 1}</th>))}</tr></thead>
              <tbody>
                {r.breakdown.map((b) => (
                  <tr key={b.departmentId ?? "none"}>
                    <td>{b.name}</td>
                    <td className="num text-end">{b.responses}</td>
                    {r.questions?.map((q, i) => (q.type === "text" ? null : <td key={q.id} className="text-muted">{b.hidden ? "Hidden" : b.headlines[i]}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export interface KudosItem {
  id: string;
  from: { id: string; name: string };
  to: { id: string; name: string }[];
  value: string;
  message: string;
  createdAt: string;
  cheers?: number;
  cheered?: boolean;
  mine?: boolean;
  hidden?: boolean;
}

export const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const names = (to: { name: string }[]) => (to.length <= 2 ? to.map((t) => t.name).join(" and ") : `${to[0]!.name}, ${to[1]!.name} and ${to.length - 2} more`);

/** One kudos post. Employees can cheer; HR gets a hide action instead. */
export function KudosCard({ k, values, actions }: { k: KudosItem; values: CompanyValue[]; actions?: React.ReactNode }) {
  const qc = useQueryClient();
  const v = values.find((x) => x.key === k.value);
  const [cheered, setCheered] = useState(!!k.cheered);
  const [count, setCount] = useState(k.cheers ?? 0);
  const cheer = useMutation({
    mutationFn: () => api.post<{ cheered: boolean }>(`/ess/engagement/kudos/${k.id}/cheer`),
    onMutate: () => (setCheered(!cheered), setCount(count + (cheered ? -1 : 1))),
    onError: (e) => (setCheered(cheered), setCount(count), toast.error(errorMessage(e))),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/ess/engagement/kudos/${k.id}`),
    onSuccess: () => (toast.success("Removed"), qc.invalidateQueries({ queryKey: ["kudos"] })),
  });
  return (
    <Card className="gap-2.5" style={k.hidden ? { opacity: 0.55 } : undefined}>
      <div className="flex items-start gap-3">
        <Avatar name={k.from.name} employeeId={k.from.id} size={36} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] leading-snug"><b className="font-semibold">{k.from.name}</b> <span className="text-muted">gave kudos to</span> <b className="font-semibold">{names(k.to)}</b></div>
          <div className="text-muted text-[12px]">{ago(k.createdAt)}{k.hidden ? " · hidden" : ""}</div>
        </div>
        {v ? <span className="tag tag-accent flex-none">{v.emoji} {v.label}</span> : null}
      </div>
      <p className="m-0 whitespace-pre-wrap text-[14px] leading-relaxed">{k.message}</p>
      <div className="flex items-center gap-1">
        {actions ?? (
          <>
            <button type="button" onClick={() => cheer.mutate()} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border-0 px-2.5 py-1 text-[12.5px]" style={{ background: cheered ? "var(--color-accent-tint)" : "var(--tint-1)", color: cheered ? "var(--color-accent)" : "var(--color-text)" }} aria-pressed={cheered}>
              <Heart size={14} fill={cheered ? "currentColor" : "none"} /> {count ? count : "Cheer"}
            </button>
            {k.mine ? <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => remove.mutate()}><Trash2 size={14} /></Button> : null}
          </>
        )}
      </div>
    </Card>
  );
}
