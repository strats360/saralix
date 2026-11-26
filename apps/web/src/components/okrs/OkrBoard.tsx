import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, CornerDownRight, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { CONFIDENCE, CONFIDENCE_LABEL, fmtKr, KR_KIND_LABEL, KR_KINDS, krProgress, OKR_LEVEL_LABEL, periodChoices, periodOf, todayLocal, type Confidence, type KrKind, type OkrLevel } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Segmented, Textarea } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { Empty, ErrorState, Loading } from "@/components/ui/page";
import { SearchSelect } from "@/components/ui/search-select";
import { Tag, type Tone } from "@/components/ui/tag";

export interface Kr { id: string; title: string; kind: KrKind; start: number; target: number; current: number; unit: string | null }
export interface Objective {
  id: string;
  level: OkrLevel;
  title: string;
  description: string;
  period: string;
  ownerId: string | null;
  departmentId: string | null;
  parentId: string | null;
  confidence: Confidence | null;
  lastCheckinAt: string | null;
  owner: { id: string; name: string } | null;
  department: string | null;
  keyResults: Kr[];
  progress: number;
  canEdit?: boolean;
}
interface Board { period: string; me?: string; reports?: string[]; people?: { id: string; name: string }[]; objectives: Objective[] }
type Person = { id: string; name: string; hint?: string };

const CONF_TONE: Record<Confidence, Tone> = { on_track: "ok", at_risk: "warn", off_track: "bad" };
const LEVEL_TONE: Record<OkrLevel, Tone> = { company: "accent", team: "neutral", individual: "outline" };

function Progress({ value, tone = "accent" }: { value: number; tone?: "accent" | Confidence }) {
  const color = tone === "at_risk" ? "var(--warn)" : tone === "off_track" ? "var(--bad)" : "var(--color-accent)";
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--tint-2)" }} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span className="block h-full rounded-full" style={{ width: `${value}%`, background: color }} />
    </span>
  );
}

/**
 * The OKR board: company objectives, with team and personal ones lined up under them.
 * HR uses it at /performance/okrs (base /admin/okrs) and employees at /me/okrs (base /ess/okrs).
 */
export function OkrBoard({ base, hr, people: given, departments = [], readOnly }: { base: "/admin/okrs" | "/ess/okrs"; hr: boolean; people?: Person[]; departments?: { id: string; name: string }[]; readOnly?: boolean }) {
  const today = todayLocal();
  const [period, setPeriod] = useState(periodOf(today));
  const [level, setLevel] = useState<"all" | OkrLevel>("all");
  const q = useQuery({ queryKey: ["okrs", base, period], queryFn: () => api.get<Board>(`${base}?period=${encodeURIComponent(period)}`) });
  const [edit, setEdit] = useState<Objective | "new" | null>(null);
  const [checkin, setCheckin] = useState<Objective | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const list = q.data?.objectives ?? [];
  const people = given ?? q.data?.people ?? [];
  const byParent = useMemo(() => {
    const ids = new Set(list.map((o) => o.id));
    const m = new Map<string | null, Objective[]>();
    for (const o of list) {
      const p = o.parentId && ids.has(o.parentId) ? o.parentId : null;
      m.set(p, [...(m.get(p) ?? []), o]);
    }
    return m;
  }, [list]);
  const order: Record<OkrLevel, number> = { company: 0, team: 1, individual: 2 };
  const roots = (byParent.get(null) ?? []).sort((a, b) => order[a.level] - order[b.level]);
  const flat = level === "all" ? null : list.filter((o) => o.level === level);
  const editable = (o: Objective) => !readOnly && (hr || !!o.canEdit);
  const avg = list.length ? Math.round(list.reduce((s, o) => s + o.progress, 0) / list.length) : null;
  const risky = list.filter((o) => o.confidence === "at_risk" || o.confidence === "off_track").length;

  const Row = ({ o, depth }: { o: Objective; depth: number }) => (
    <>
      <ObjectiveCard o={o} depth={depth} canEdit={editable(o)} hr={hr} base={base} onEdit={() => setEdit(o)} onCheckin={() => setCheckin(o)} onOpen={() => setOpen(o.id)} />
      {level === "all" ? (byParent.get(o.id) ?? []).map((c) => <Row key={c.id} o={c} depth={depth + 1} />) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={period} onChange={(e) => setPeriod(e.target.value)} className="!w-auto" aria-label="Period">
          {periodChoices(today).map((p) => <option key={p} value={p}>{p}{p === periodOf(today) ? " (now)" : ""}</option>)}
        </Select>
        <Segmented value={level} onChange={setLevel} options={[{ value: "all", label: "All" }, { value: "company", label: "Company" }, { value: "team", label: "Team" }, { value: "individual", label: "Personal" }]} />
        <div className="flex-1" />
        {readOnly ? null : <Button variant="primary" onClick={() => setEdit("new")}><Plus size={16} /> {hr ? "New objective" : "Add my objective"}</Button>}
      </div>
      {list.length ? (
        <div className="text-muted text-[13px]">{list.length} objective{list.length === 1 ? "" : "s"} · {avg}% average progress{risky ? ` · ${risky} at risk or off track` : ""}</div>
      ) : null}
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      {q.isLoading ? <Loading /> : null}
      {q.data && !list.length ? (
        <Card><Empty title={`No objectives for ${period} yet`} sub={hr ? "Start with two or three company objectives. Teams and people then line theirs up underneath." : "Add an objective for yourself and line it up under your team's or the company's."} action={readOnly ? undefined : <Button variant="primary" onClick={() => setEdit("new")}>{hr ? "New objective" : "Add my objective"}</Button>} /></Card>
      ) : null}
      <div className="flex flex-col gap-2.5">{flat ? flat.map((o) => <Row key={o.id} o={o} depth={0} />) : roots.map((o) => <Row key={o.id} o={o} depth={0} />)}</div>
      {edit ? <ObjectiveDialog base={base} hr={hr} row={edit === "new" ? null : edit} period={period} people={people} departments={departments} parents={list} me={q.data?.me} reports={q.data?.reports ?? []} onClose={() => setEdit(null)} /> : null}
      {checkin ? <CheckinDialog base={base} o={checkin} onClose={() => setCheckin(null)} /> : null}
      {open ? <HistoryDialog base={base} id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function ObjectiveCard({ o, depth, canEdit, hr, base, onEdit, onCheckin, onOpen }: { o: Objective; depth: number; canEdit: boolean; hr: boolean; base: string; onEdit: () => void; onCheckin: () => void; onOpen: () => void }) {
  const qc = useQueryClient();
  const archive = useMutation({
    mutationFn: () => api.post(`${base}/${o.id}/archive`),
    onSuccess: () => (toast.success("Archived"), qc.invalidateQueries({ queryKey: ["okrs"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const status = o.progress >= 100 ? "done" : o.confidence ?? "not_started";
  return (
    <div style={{ marginInlineStart: Math.min(depth, 3) * 28 }} className="flex gap-2">
      {depth ? <CornerDownRight size={16} className="text-muted mt-5 flex-none" aria-hidden /> : null}
      <Card className="min-w-0 flex-1 gap-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <Tag tone={LEVEL_TONE[o.level]}>{OKR_LEVEL_LABEL[o.level]}</Tag>
              {o.department ? <span className="text-muted text-[12px]">{o.department}</span> : null}
              {o.owner ? <span className="text-muted text-[12px]">· {o.owner.name}</span> : null}
            </div>
            <button type="button" onClick={onOpen} className="cursor-pointer border-0 bg-transparent p-0 text-start text-[16px] font-medium text-[var(--color-text)] hover:underline">{o.title}</button>
          </div>
          <div className="flex items-center gap-2">
            <Tag tone={status === "done" ? "ok" : status === "not_started" ? "neutral" : CONF_TONE[status]}>{CONFIDENCE_LABEL[status]}</Tag>
            {canEdit ? <Button size="sm" onClick={onCheckin}>Check in</Button> : null}
            {canEdit ? <Menu trigger={<Button variant="ghost" size="sm" aria-label="More"><MoreHorizontal size={16} /></Button>} items={[{ label: "Edit", onSelect: onEdit }, { label: "History", onSelect: onOpen }, ...(hr || o.level === "individual" ? [{ label: "Archive", onSelect: () => archive.mutate(), danger: true }] : [])]} /> : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Progress value={o.progress} tone={o.confidence ?? "accent"} />
          <span className="num w-10 text-end text-[13px] font-medium">{o.progress}%</span>
        </div>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {o.keyResults.map((k) => (
            <li key={k.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-[13px] sm:grid-cols-[1fr_160px_auto]">
              <span className="min-w-0 truncate">{k.title}</span>
              <span className="hidden sm:block"><Progress value={krProgress(k)} /></span>
              <span className="text-muted num whitespace-nowrap text-end text-[12.5px]">{k.kind === "done" ? fmtKr("done", k.current) : `${fmtKr(k.kind, k.current)} → ${fmtKr(k.kind, k.target, k.unit)}`}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

type KrDraft = { id?: string; title: string; kind: KrKind; start: string; target: string; unit: string };

function ObjectiveDialog({ base, hr, row, period, people, departments, parents, me, reports, onClose }: { base: string; hr: boolean; row: Objective | null; period: string; people: Person[]; departments: { id: string; name: string }[]; parents: Objective[]; me?: string; reports: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    level: (row?.level ?? (hr ? "company" : "individual")) as OkrLevel,
    title: row?.title ?? "",
    description: row?.description ?? "",
    period: row?.period ?? period,
    ownerId: row?.ownerId ?? (hr ? "" : me ?? ""),
    departmentId: row?.departmentId ?? "",
    parentId: row?.parentId ?? "",
  });
  const [krs, setKrs] = useState<KrDraft[]>(row?.keyResults.map((k) => ({ id: k.id, title: k.title, kind: k.kind, start: String(k.start), target: String(k.target), unit: k.unit ?? "" })) ?? [{ title: "", kind: "number", start: "0", target: "", unit: "" }]);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, ownerId: f.ownerId || null, departmentId: f.level === "team" ? f.departmentId || null : null, parentId: f.parentId || null, keyResults: krs.map((k) => ({ ...(k.id ? { id: k.id } : {}), title: k.title, kind: k.kind, start: k.kind === "done" ? 0 : Number(k.start || 0), target: k.kind === "done" ? 1 : Number(k.target), unit: k.unit.trim() || null })) };
      return row ? api.put(`${base}/${row.id}`, body) : api.post(base, body);
    },
    onSuccess: () => (toast.success(row ? "Saved" : "Objective added"), qc.invalidateQueries({ queryKey: ["okrs"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setK = (i: number, patch: Partial<KrDraft>) => setKrs(krs.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  // line up under an objective one level up, or the same level
  const parentChoices = parents.filter((p) => p.id !== row?.id && p.period === f.period && (f.level === "company" ? p.level === "company" : f.level === "team" ? p.level !== "individual" : true));
  const owners = hr ? people : people.filter((p) => p.id === me || reports.includes(p.id));
  const ready = f.title.trim().length >= 3 && krs.length > 0 && krs.every((k) => k.title.trim().length >= 3 && (k.kind === "done" || (k.target !== "" && Number(k.target) !== Number(k.start || 0)))) && (f.level !== "team" || f.departmentId) && (f.level !== "individual" || f.ownerId);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={row ? "Edit objective" : "New objective"} description="An objective says what you want to achieve. Key results say how you'll know you got there: two to four measurable ones work best." width={720} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>{row ? "Save" : "Add objective"}</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {hr ? <Field label="Level"><Select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as OkrLevel, parentId: "" })} disabled={!!row}>{(["company", "team", "individual"] as OkrLevel[]).map((l) => <option key={l} value={l}>{OKR_LEVEL_LABEL[l]}</option>)}</Select></Field> : null}
          <Field label="Period"><Select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value, parentId: "" })}>{periodChoices(todayLocal()).map((p) => <option key={p}>{p}</option>)}</Select></Field>
          {f.level === "team" ? <Field label="Team"><Select value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}><option value="">Pick a department</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field> : null}
        </div>
        <Field label="Objective"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} placeholder={f.level === "company" ? "Become the easiest payroll for Indian SMEs" : "Make payslips load instantly"} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={f.level === "individual" ? "Whose objective" : "Owner"} hint={f.level === "individual" ? undefined : "Optional. The person who checks in on it."}>
            <SearchSelect value={f.ownerId} onChange={(v) => setF({ ...f, ownerId: v })} options={owners.map((p) => ({ value: p.id, label: p.name, hint: p.hint }))} emptyLabel={f.level === "individual" ? undefined : "Nobody"} disabled={!!row && f.level === "individual" && !hr} aria-label="Owner" />
          </Field>
          <Field label="Lines up under" hint="Optional. Shows how this feeds a bigger goal.">
            <Select value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}><option value="">Nothing</option>{parentChoices.map((p) => <option key={p.id} value={p.id}>{OKR_LEVEL_LABEL[p.level]}: {p.title}</option>)}</Select>
          </Field>
        </div>
        <div className="mt-1 text-[14px] font-medium">Key results</div>
        {krs.map((k, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
            <div className="flex gap-2">
              <Input value={k.title} onChange={(e) => setK(i, { title: e.target.value })} maxLength={200} placeholder="Payslip PDF opens in under 1 second" aria-label={`Key result ${i + 1}`} />
              <Button variant="ghost" aria-label="Remove key result" disabled={krs.length === 1} onClick={() => setKrs(krs.filter((_, j) => j !== i))}><Trash2 size={15} /></Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Select value={k.kind} onChange={(e) => setK(i, { kind: e.target.value as KrKind })} aria-label="Measured as">{KR_KINDS.map((x) => <option key={x} value={x}>{KR_KIND_LABEL[x]}</option>)}</Select>
              {k.kind !== "done" ? (
                <>
                  <Input type="number" value={k.start} onChange={(e) => setK(i, { start: e.target.value })} aria-label="Start" placeholder="Start" />
                  <Input type="number" value={k.target} onChange={(e) => setK(i, { target: e.target.value })} aria-label="Target" placeholder="Target" />
                  {k.kind === "number" ? <Input value={k.unit} onChange={(e) => setK(i, { unit: e.target.value })} maxLength={20} aria-label="Unit" placeholder="Unit, like customers" /> : null}
                </>
              ) : <div className="text-muted col-span-2 self-center text-[12.5px] sm:col-span-3">Ticked off once it's done.</div>}
            </div>
          </div>
        ))}
        <Button size="sm" className="self-start" disabled={krs.length >= 6} onClick={() => setKrs([...krs, { title: "", kind: "number", start: "0", target: "", unit: "" }])}><Plus size={14} /> Add key result</Button>
        <Field label="Why it matters" hint="Optional."><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} className="!min-h-[64px]" /></Field>
      </div>
    </Dialog>
  );
}

function CheckinDialog({ base, o, onClose }: { base: string; o: Objective; onClose: () => void }) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(o.keyResults.map((k) => [k.id, String(k.current)])));
  const [confidence, setConfidence] = useState<Confidence>(o.confidence ?? "on_track");
  const [note, setNote] = useState("");
  const go = useMutation({
    mutationFn: () => api.post<{ progress: number }>(`${base}/${o.id}/checkin`, { values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v || 0)])), confidence, note }),
    onSuccess: (r) => (toast.success(`Checked in: ${r.progress}%`), qc.invalidateQueries({ queryKey: ["okrs"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Check in" description={o.title} width={600} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={go.isPending} onClick={() => go.mutate()}>Save check in</Button></>}>
      <div className="flex flex-col gap-3">
        {o.keyResults.map((k) => (
          <div key={k.id} className="grid items-center gap-2 sm:grid-cols-[1fr_180px]">
            <div className="text-[13.5px]">{k.title}<div className="text-muted text-[12px]">{k.kind === "done" ? "Done or not" : `From ${fmtKr(k.kind, k.start, k.unit)} to ${fmtKr(k.kind, k.target, k.unit)}`}</div></div>
            {k.kind === "done" ? (
              <Segmented value={values[k.id] === "1" ? "1" : "0"} onChange={(v) => setValues({ ...values, [k.id]: v })} options={[{ value: "0", label: "Not yet" }, { value: "1", label: "Done" }]} />
            ) : <Input type="number" value={values[k.id]} onChange={(e) => setValues({ ...values, [k.id]: e.target.value })} aria-label={`Now: ${k.title}`} />}
          </div>
        ))}
        <Field label="How confident are you?">
          <Segmented value={confidence} onChange={setConfidence} options={CONFIDENCE.map((c) => ({ value: c, label: CONFIDENCE_LABEL[c] }))} />
        </Field>
        <Field label="Note" hint="Optional. What moved, and what's in the way."><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="!min-h-[64px]" /></Field>
      </div>
    </Dialog>
  );
}

interface Detail extends Objective { history: { id: string; progress: number; confidence: Confidence; note: string; byName: string | null; createdAt: string }[]; children: Objective[]; parent: { id: string; title: string; level: OkrLevel } | null }

function HistoryDialog({ base, id, onClose }: { base: string; id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["okrs", "one", id], queryFn: () => api.get<Detail>(`${base}/${id}`) });
  const d = q.data;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={d?.title ?? "Objective"} description={d ? `${OKR_LEVEL_LABEL[d.level]} · ${d.period}${d.owner ? ` · ${d.owner.name}` : ""}` : undefined} width={620}>
      {!d ? <Loading /> : (
        <div className="flex flex-col gap-3">
          {d.description ? <p className="m-0 whitespace-pre-wrap text-[14px]">{d.description}</p> : null}
          {d.parent ? <div className="text-muted inline-flex items-center gap-1 text-[13px]">Lines up under <ChevronRight size={13} /> {OKR_LEVEL_LABEL[d.parent.level]}: {d.parent.title}</div> : null}
          {d.children.length ? <div className="text-[13px]"><div className="card-kicker mb-1">Lined up under this</div>{d.children.map((c) => <div key={c.id} className="flex justify-between gap-3 py-0.5"><span>{c.title}{c.owner ? <span className="text-muted"> · {c.owner.name}</span> : null}</span><span className="num">{c.progress}%</span></div>)}</div> : null}
          <div className="card-kicker mt-1">Check ins</div>
          {d.history.length ? (
            <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
              {d.history.map((h) => (
                <li key={h.id} className="rounded-[var(--radius-md)] px-3 py-2" style={{ background: "var(--tint-1)" }}>
                  <div className="flex flex-wrap items-center gap-2 text-[13px]"><span className="num font-medium">{h.progress}%</span><Tag tone={CONF_TONE[h.confidence]}>{CONFIDENCE_LABEL[h.confidence]}</Tag><span className="text-muted">{h.byName} · {new Date(h.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span></div>
                  {h.note ? <div className="mt-1 text-[13.5px]">{h.note}</div> : null}
                </li>
              ))}
            </ol>
          ) : <div className="text-muted text-[13px]">No check ins yet.</div>}
        </div>
      )}
    </Dialog>
  );
}
