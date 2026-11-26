import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { EyeOff, Eye, Plus, Trash2 } from "lucide-react";
import { DEFAULT_VALUES, fmtDate, SURVEY_KIND_LABEL, SURVEY_TEMPLATES, valueKey, type CompanyValue, type SurveyKind } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { Empty, ErrorState, PageHeader } from "@/components/ui/page";
import { RouteTabs } from "@/components/ui/tabs";
import { Tag, type Tone } from "@/components/ui/tag";
import { KudosCard, type KudosItem } from "@/components/engagement/shared";

export interface SurveyRow {
  id: string;
  title: string;
  description: string;
  kind: SurveyKind;
  anonymous: boolean;
  audience: { departmentIds: string[]; branchIds: string[] };
  questions: { id: string; type: "scale" | "enps" | "choice" | "multi" | "text"; text: string; options: string[]; required: boolean }[];
  status: "draft" | "open" | "closed";
  openedAt: string | null;
  closesOn: string | null;
  closedAt: string | null;
  shareResults: boolean;
  invited: number;
  responses: number;
  rate: number | null;
}
export const SURVEY_STATE: Record<SurveyRow["status"], [string, Tone]> = { draft: ["Draft", "neutral"], open: ["Open", "ok"], closed: ["Closed", "outline"] };

const TABS = [
  { to: "/engagement", label: "Surveys and polls", end: true },
  { to: "/engagement/kudos", label: "Kudos" },
  { to: "/engagement/settings", label: "Values" },
];

function Header({ actions }: { actions?: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Engagement" sub="Pulse checks, polls and kudos, to hear from your people and celebrate good work" actions={actions} />
      <RouteTabs tabs={TABS} />
    </>
  );
}

export default function Surveys() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["surveys", "admin"], queryFn: () => api.get<SurveyRow[]>("/admin/engagement/surveys") });
  const columns = useMemo<ColumnDef<SurveyRow>[]>(
    () => [
      { id: "title", header: "Survey", accessorKey: "title", cell: ({ row: { original: s } }) => <div className="max-w-[420px] whitespace-normal"><div className="font-medium">{s.title}</div><div className="text-muted text-[12px]">{SURVEY_KIND_LABEL[s.kind]} · {s.questions.length} question{s.questions.length === 1 ? "" : "s"}{s.anonymous ? " · anonymous" : ""}</div></div> },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row: { original: s } }) => <div><Tag tone={SURVEY_STATE[s.status][1]}>{SURVEY_STATE[s.status][0]}</Tag>{s.closesOn && s.status === "open" ? <div className="text-muted text-[12px]">closes {fmtDate(s.closesOn)}</div> : null}</div> },
      { id: "responses", header: "Answered", accessorKey: "responses", cell: ({ row: { original: s } }) => (s.status === "draft" ? "—" : <div><span className="num">{s.responses} of {s.invited}</span><div className="text-muted text-[12px]">{s.rate ?? 0}%</div></div>) },
      { id: "opened", header: "Opened", accessorKey: "openedAt", cell: ({ row: { original: s } }) => (s.openedAt ? fmtDate(s.openedAt.slice(0, 10)) : "—") },
    ],
    [],
  );
  const stats = useMemo(() => {
    const list = q.data ?? [];
    const open = list.filter((s) => s.status === "open");
    const done = list.filter((s) => s.status !== "draft" && s.invited);
    const rate = done.length ? Math.round(done.reduce((a, s) => a + (s.rate ?? 0), 0) / done.length) : null;
    return { open: open.length, rate, total: list.filter((s) => s.status !== "draft").length };
  }, [q.data]);
  return (
    <div className="flex flex-col gap-4">
      <Header
        actions={
          <Menu
            trigger={<Button variant="primary"><Plus size={16} /> New survey</Button>}
            items={[{ label: "Start from scratch", onSelect: () => nav("/engagement/surveys/new") }, ...SURVEY_TEMPLATES.map((t) => ({ label: t.label, onSelect: () => nav(`/engagement/surveys/new?template=${t.key}`) }))]}
          />
        }
      />
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Open now" value={stats.open} />
        <StatCard label="Sent so far" value={stats.total} />
        <StatCard label="Average response rate" value={stats.rate === null ? "—" : `${stats.rate}%`} />
      </div>
      <TableCard>
        <CardHeader className="py-2" title="Surveys and polls" sub="Anonymous results show once at least three people have answered." />
        <DataTable data={q.data ?? []} columns={columns} getRowId={(r) => r.id} loading={q.isFetching} onRowClick={(r) => nav(`/engagement/surveys/${r.id}`)} storageKey="surveys" empty="No surveys yet. Start with the monthly pulse or a quick poll." />
      </TableCard>
    </div>
  );
}

interface KudosReport {
  total: number;
  givers: number;
  received: { employeeId: string; name: string; count: number }[];
  given: { employeeId: string; name: string; count: number }[];
  byValue: { value: string; count: number }[];
  items: KudosItem[];
}

export function KudosAdmin() {
  const qc = useQueryClient();
  const [days, setDays] = useState("30");
  const q = useQuery({ queryKey: ["kudos", "admin", days], queryFn: () => api.get<KudosReport>(`/admin/engagement/kudos?days=${days}`) });
  const s = useQuery({ queryKey: ["engagement-settings"], queryFn: () => api.get<{ values: CompanyValue[]; kudosEnabled: boolean }>("/admin/engagement/settings") });
  const hide = useMutation({
    mutationFn: (v: { id: string; hidden: boolean }) => api.post(`/admin/engagement/kudos/${v.id}/hide`, { hidden: v.hidden }),
    onSuccess: (_r, v) => (toast.success(v.hidden ? "Hidden from the wall" : "Back on the wall"), qc.invalidateQueries({ queryKey: ["kudos"] })),
  });
  const values = s.data?.values ?? DEFAULT_VALUES;
  const label = (k: string) => values.find((v) => v.key === k);
  const r = q.data;
  return (
    <div className="flex flex-col gap-4">
      <Header actions={<Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Period" className="!w-auto"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option></Select>} />
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      {s.data && !s.data.kudosEnabled ? <div className="text-muted text-[13px]">Kudos is switched off. Turn it on under <Link to="/engagement/settings">Values</Link>.</div> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Kudos given" value={r?.total ?? "—"} />
        <StatCard label="People giving kudos" value={r?.givers ?? "—"} />
        <StatCard label="Top value" value={r?.byValue[0] ? `${label(r.byValue[0].value)?.emoji ?? ""} ${label(r.byValue[0].value)?.label ?? r.byValue[0].value}` : "—"} />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-3">
          {r && !r.items.length ? <Card><Empty title="No kudos in this period" sub="Employees give kudos from self-service. It shows on everyone's wall." /></Card> : null}
          {r?.items.map((k) => (
            <KudosCard key={k.id} k={k} values={values} actions={<Button size="sm" variant="ghost" onClick={() => hide.mutate({ id: k.id, hidden: !k.hidden })}>{k.hidden ? <><Eye size={14} /> Show again</> : <><EyeOff size={14} /> Hide</>}</Button>} />
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <Leaders title="Most recognised" rows={r?.received ?? []} />
          <Leaders title="Most generous" rows={r?.given ?? []} />
        </div>
      </div>
    </div>
  );
}

function Leaders({ title, rows }: { title: string; rows: { employeeId: string; name: string; count: number }[] }) {
  return (
    <Card className="gap-2">
      <div className="text-[15px] font-medium">{title}</div>
      {rows.length ? (
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {rows.map((p, i) => (
            <li key={p.employeeId} className="flex items-center gap-2 text-[13.5px]"><span className="text-muted num w-4">{i + 1}</span><span className="flex-1 truncate">{p.name}</span><span className="num tag tag-accent">{p.count}</span></li>
          ))}
        </ol>
      ) : <div className="text-muted text-[13px]">Nobody yet.</div>}
    </Card>
  );
}

export function EngagementSettings() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ["engagement-settings"], queryFn: () => api.get<{ values: CompanyValue[]; kudosEnabled: boolean }>("/admin/engagement/settings") });
  return (
    <div className="flex flex-col gap-4">
      <Header />
      {s.error ? <ErrorState error={s.error} retry={() => s.refetch()} /> : null}
      {s.data ? <ValuesForm initial={s.data} onSaved={() => qc.invalidateQueries({ queryKey: ["engagement-settings"] })} /> : null}
    </div>
  );
}

function ValuesForm({ initial, onSaved }: { initial: { values: CompanyValue[]; kudosEnabled: boolean }; onSaved: () => void }) {
  const [values, setValues] = useState(initial.values);
  const [enabled, setEnabled] = useState(initial.kudosEnabled);
  const save = useMutation({
    mutationFn: () => api.put("/admin/engagement/settings", { values: values.map((v) => ({ ...v, key: v.key || valueKey(v.label) })), kudosEnabled: enabled }),
    onSuccess: () => (toast.success("Saved"), onSaved()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const set = (i: number, patch: Partial<CompanyValue>) => setValues(values.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  return (
    <Card className="max-w-[720px] gap-4">
      <CardHeader className="!p-0" title="Company values" sub="People pick one of these when they give kudos. Keep the list short so each one means something." />
      <Checkbox checked={enabled} onChange={setEnabled} label="Let employees give each other kudos" />
      <div className="flex flex-col gap-2">
        {values.map((v, i) => (
          <div key={i} className="grid grid-cols-[64px_1fr_auto] items-end gap-2">
            <Field label={i === 0 ? "Emoji" : undefined}><Input value={v.emoji} maxLength={8} onChange={(e) => set(i, { emoji: e.target.value })} aria-label="Emoji" className="text-center" /></Field>
            <Field label={i === 0 ? "Value" : undefined}><Input value={v.label} maxLength={40} onChange={(e) => set(i, { label: e.target.value, key: initial.values.some((x) => x.key === v.key) ? v.key : valueKey(e.target.value) })} aria-label="Value" /></Field>
            <Button variant="ghost" aria-label={`Remove ${v.label}`} disabled={values.length === 1} onClick={() => setValues(values.filter((_, j) => j !== i))}><Trash2 size={15} /></Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={values.length >= 12} onClick={() => setValues([...values, { key: "", label: "", emoji: "⭐" }])}><Plus size={15} /> Add a value</Button>
        <div className="flex-1" />
        <Button variant="primary" loading={save.isPending} disabled={values.some((v) => v.label.trim().length < 2)} onClick={() => save.mutate()}>Save</Button>
      </div>
    </Card>
  );
}
