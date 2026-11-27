import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronLeft, Download, Plus, Trash2 } from "lucide-react";
import { fmtDate, FORM_FIELD_LABEL, FORM_FIELD_TYPES, STEP_KIND_LABEL, STEP_KINDS, type FormField, type FormStep, type StepKind, type SubmissionStatus } from "@hrms/shared";
import { api, download, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Checkbox, Field, Input, Segmented, Select, Textarea } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { ErrorState, Loading, Notice, PageHeader } from "@/components/ui/page";
import { PillTabs, RouteTabs } from "@/components/ui/tabs";
import { SearchSelect } from "@/components/ui/search-select";
import { Tag, type Tone } from "@/components/ui/tag";
import { useLookups } from "@/components/recruitment/shared";
import { RequestStatus, RequestView, type RequestDetail, type RequestRow } from "@/components/forms/RequestView";

interface FormRow { id: string; title: string; description: string; fields: FormField[]; steps: FormStep[]; audience: { departmentIds: string[]; branchIds: string[] }; status: "draft" | "published" | "archived"; publishedAt: string | null; updatedAt: string; total?: number; pending?: number }
const STATUS: Record<FormRow["status"], [string, Tone]> = { draft: ["Draft", "neutral"], published: ["Live", "ok"], archived: ["Archived", "outline"] };
const uid = () => Math.random().toString(36).slice(2, 9);
export const FORMS_TABS = [{ to: "/forms", label: "Forms", end: true }, { to: "/forms/requests", label: "Requests" }];

/** Admin → Forms: request forms HR built, with their approval steps. */
export default function Forms() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["forms", "admin"], queryFn: () => api.get<FormRow[]>("/admin/forms") });
  const columns = useMemo<ColumnDef<FormRow>[]>(
    () => [
      { id: "title", header: "Form", accessorKey: "title", cell: ({ row: { original: f } }) => <div className="max-w-[420px] whitespace-normal"><div className="font-medium">{f.title}</div><div className="text-muted text-[12px]">{f.fields.length} fields · {f.steps.length ? f.steps.map((s) => STEP_KIND_LABEL[s.kind as StepKind]).join(", then ") : "no approval"}</div></div> },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row: { original: f } }) => <Tag tone={STATUS[f.status][1]}>{STATUS[f.status][0]}</Tag> },
      { id: "total", header: "Requests", cell: ({ row: { original: f } }) => (f.total ? <span className="num">{f.total}</span> : "—") },
      { id: "pending", header: "Waiting", cell: ({ row: { original: f } }) => (f.pending ? <Tag tone="warn">{f.pending}</Tag> : "—") },
    ],
    [],
  );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Forms and workflows" sub="Your own request forms, each with its approval steps" actions={<Button variant="primary" onClick={() => nav("/forms/new")}><Plus size={16} /> New form</Button>} />
      <RouteTabs tabs={FORMS_TABS} />
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <TableCard>
        <DataTable data={q.data ?? []} columns={columns} getRowId={(r) => r.id} loading={q.isFetching} onRowClick={(r) => nav(`/forms/${r.id}`)} storageKey="forms" empty="No forms yet. Try a laptop request, an ID card request or a work from abroad request." />
      </TableCard>
    </div>
  );
}

function RequestTable({ rows, loading, empty }: { rows: RequestRow[]; loading: boolean; empty: string }) {
  const nav = useNavigate();
  const columns = useMemo<ColumnDef<RequestRow>[]>(
    () => [
      { id: "code", header: "Request", accessorKey: "code", cell: ({ row: { original: r } }) => <div><div className="font-medium">{r.title}</div><div className="text-muted num text-[12px]">{r.code}</div></div> },
      { id: "who", header: "From", cell: ({ row: { original: r } }) => (r.employee ? <div><div>{r.employee.name}</div><div className="text-muted text-[12px]">{r.employee.code}</div></div> : "—") },
      { id: "sent", header: "Sent", accessorKey: "createdAt", cell: ({ getValue }) => fmtDate(getValue<string>().slice(0, 10)) },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row: { original: r } }) => <RequestStatus r={r} /> },
    ],
    [],
  );
  return <DataTable data={rows} columns={columns} getRowId={(r) => r.id} loading={loading} onRowClick={(r) => nav(`/forms/requests/${r.id}`)} storageKey="form-requests" empty={empty} />;
}

export function FormRequests() {
  const [status, setStatus] = useState<"queue" | SubmissionStatus | "all">("queue");
  const q = useQuery({ queryKey: ["forms", "requests", status], queryFn: () => api.get<RequestRow[]>(`/admin/forms/requests${status === "queue" ? "?queue=1" : status === "all" ? "" : `?status=${status}`}`) });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Forms and workflows" sub="Requests people sent through your forms" />
      <RouteTabs tabs={FORMS_TABS} />
      <Segmented value={status} onChange={setStatus} options={[{ value: "queue", label: "Waiting for HR" }, { value: "pending", label: "All waiting" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "all", label: "Everything" }]} />
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <TableCard><RequestTable rows={q.data ?? []} loading={q.isFetching} empty={status === "queue" ? "Nothing is waiting for HR." : "No requests here."} /></TableCard>
    </div>
  );
}

export function FormRequestPage() {
  const { sid = "" } = useParams();
  const q = useQuery({ queryKey: ["forms", "request", sid], queryFn: () => api.get<RequestDetail>(`/admin/forms/requests/${sid}`) });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Loading />;
  const r = q.data;
  return (
    <div className="flex flex-col gap-4">
      <Link to="/forms/requests" className="inline-flex items-center gap-1 self-start text-[13px] no-underline"><ChevronLeft size={15} /> Requests</Link>
      <PageHeader title={r.title} sub={<span className="inline-flex items-center gap-2"><span className="num">{r.code}</span><RequestStatus r={r} /></span>} />
      {r.status === "pending" && r.stepKind !== "hr" ? <Notice tone="sel">This step is for {r.approver?.name ?? "someone else"} to approve. HR acts when it reaches an HR step.</Notice> : null}
      <RequestView r={r} base={`/admin/forms/requests/${r.id}`} decide={r.stepKind === "hr" ? `/admin/forms/requests/${r.id}/decision` : undefined} />
    </div>
  );
}

export function FormPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ["forms", "admin", id], queryFn: () => api.get<FormRow>(`/admin/forms/${id}`), enabled: !!id && id !== "new" });
  const [tab, setTab] = useState<"form" | "requests">("form");
  const reqs = useQuery({ queryKey: ["forms", "requests", "form", id], queryFn: () => api.get<RequestRow[]>(`/admin/forms/requests?formId=${id}`), enabled: tab === "requests" });
  if (id && id !== "new" && !q.data) return q.error ? <ErrorState error={q.error} /> : <Loading />;
  const row = id === "new" ? null : q.data!;
  return (
    <div className="flex flex-col gap-4">
      <Link to="/forms" className="inline-flex items-center gap-1 self-start text-[13px] no-underline"><ChevronLeft size={15} /> Forms</Link>
      {row && row.status !== "draft" ? <PillTabs value={tab} onChange={setTab} tabs={[{ value: "form", label: "Form" }, { value: "requests", label: "Requests" }]} /> : null}
      {tab === "requests" && row ? (
        <>
          <PageHeader title={row.title} actions={<Button onClick={() => download(`/admin/forms/${row.id}/export`, "requests.csv").catch((e) => toast.error(errorMessage(e)))}><Download size={15} /> Export CSV</Button>} />
          <TableCard><RequestTable rows={reqs.data ?? []} loading={reqs.isFetching} empty="Nobody has used this form yet." /></TableCard>
        </>
      ) : (
        <Editor row={row} key={row?.id ?? "new"} />
      )}
    </div>
  );
}

function Editor({ row }: { row: FormRow | null }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const L = useLookups();
  const [f, setF] = useState({
    title: row?.title ?? "",
    description: row?.description ?? "",
    fields: row?.fields ?? [{ id: uid(), label: "", type: "text" as const, required: true, help: "", options: [] }],
    steps: row?.steps ?? [{ id: uid(), kind: "manager" as StepKind, employeeId: null }],
    departmentIds: row?.audience.departmentIds ?? [],
    branchIds: row?.audience.branchIds ?? [],
  });
  const save = useMutation({
    mutationFn: async (publish: boolean) => {
      const body = { ...f, fields: f.fields.map((x) => ({ ...x, options: x.type === "select" ? x.options.filter((o) => o.trim()) : [] })) };
      const saved = row ? await api.put<FormRow>(`/admin/forms/${row.id}`, body) : await api.post<FormRow>("/admin/forms", body);
      if (publish) await api.post(`/admin/forms/${saved.id}/publish`);
      return { id: saved.id, publish };
    },
    onSuccess: (r) => (toast.success(r.publish ? "It's live. People can find it under Forms." : "Saved"), qc.invalidateQueries({ queryKey: ["forms"] }), nav(`/forms/${r.id}`, { replace: true })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const act = useMutation({
    mutationFn: (a: "archive" | "delete") => (a === "delete" ? api.del(`/admin/forms/${row!.id}`) : api.post(`/admin/forms/${row!.id}/archive`)),
    onSuccess: (_, a) => (toast.success(a === "delete" ? "Deleted" : "Archived"), qc.invalidateQueries({ queryKey: ["forms"] }), nav("/forms")),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setFld = (i: number, p: Partial<FormField>) => setF({ ...f, fields: f.fields.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const move = (i: number, d: -1 | 1) => { const xs = [...f.fields]; [xs[i], xs[i + d]] = [xs[i + d]!, xs[i]!]; setF({ ...f, fields: xs }); };
  const setStep = (i: number, p: Partial<FormStep>) => setF({ ...f, steps: f.steps.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const toggle = (k: "departmentIds" | "branchIds", id: string) => setF({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] });
  const people = (L.data?.employees ?? []).map((e) => ({ value: e.id, label: e.name, hint: e.code }));
  const ready = f.title.trim().length >= 3 && f.fields.length > 0 && f.fields.every((x) => x.label.trim().length >= 2 && (x.type !== "select" || x.options.filter((o) => o.trim()).length >= 2)) && f.steps.every((s) => s.kind !== "person" || s.employeeId);
  const live = row?.status === "published";
  return (
    <>
      <PageHeader
        title={row ? row.title : "New form"}
        sub={row ? <Tag tone={STATUS[row.status][1]}>{STATUS[row.status][0]}</Tag> : "Add the fields people fill in, then who approves it, in order."}
        actions={row && row.status !== "archived" ? <Menu trigger={<Button>More</Button>} items={[...(live ? [{ label: "Archive", onSelect: () => act.mutate("archive"), danger: true }] : []), ...(row.status === "draft" ? [{ label: "Delete", onSelect: () => act.mutate("delete"), danger: true }] : [])]} /> : null}
      />
      {live ? <Notice tone="sel">It's live. Changes apply to new requests; ones already sent keep the fields and steps they had.</Notice> : null}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-3">
          <Card className="gap-3">
            <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={150} placeholder="Laptop request" /></Field>
            <Field label="Description" hint="Optional. Tell people when to use this form."><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} className="!min-h-[64px]" /></Field>
          </Card>
          {f.fields.map((x, i) => (
            <Card key={x.id} className="gap-3">
              <div className="flex items-center gap-2">
                <div className="card-kicker flex-1">Field {i + 1}</div>
                <Button variant="ghost" size="sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></Button>
                <Button variant="ghost" size="sm" aria-label="Move down" disabled={i === f.fields.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></Button>
                <Button variant="ghost" size="sm" aria-label="Remove field" disabled={f.fields.length === 1} onClick={() => setF({ ...f, fields: f.fields.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                <Field label="Question"><Input value={x.label} onChange={(e) => setFld(i, { label: e.target.value })} maxLength={150} /></Field>
                <Field label="Answer type"><Select value={x.type} onChange={(e) => setFld(i, { type: e.target.value as FormField["type"], options: e.target.value === "select" && x.options.length < 2 ? ["", ""] : x.options })}>{FORM_FIELD_TYPES.map((t) => <option key={t} value={t}>{FORM_FIELD_LABEL[t]}</option>)}</Select></Field>
              </div>
              {x.type === "select" ? (
                <div className="flex flex-col gap-2">
                  {x.options.map((o, j) => (
                    <div key={j} className="flex gap-2"><Input value={o} onChange={(e) => setFld(i, { options: x.options.map((y, k) => (k === j ? e.target.value : y)) })} maxLength={150} placeholder={`Option ${j + 1}`} aria-label={`Option ${j + 1}`} />{x.options.length > 2 ? <Button variant="ghost" aria-label="Remove option" onClick={() => setFld(i, { options: x.options.filter((_, k) => k !== j) })}><Trash2 size={13} /></Button> : null}</div>
                  ))}
                  <Button size="sm" className="self-start" disabled={x.options.length >= 30} onClick={() => setFld(i, { options: [...x.options, ""] })}><Plus size={13} /> Option</Button>
                </div>
              ) : null}
              <Field label="Help text" hint="Optional. Shown under the question."><Input value={x.help} onChange={(e) => setFld(i, { help: e.target.value })} maxLength={300} /></Field>
              <Checkbox checked={x.required} onChange={(v) => setFld(i, { required: v })} label={x.type === "checkbox" ? "They must tick it" : "Required"} />
            </Card>
          ))}
          <Button className="self-start" disabled={f.fields.length >= 40} onClick={() => setF({ ...f, fields: [...f.fields, { id: uid(), label: "", type: "text", required: false, help: "", options: [] }] })}><Plus size={15} /> Add field</Button>
        </div>
        <div className="flex flex-col gap-3 lg:sticky lg:top-4">
          <Card className="gap-3">
            <div>
              <div className="text-[14px] font-medium">Approval steps</div>
              <div className="text-muted text-[12px]">In order. A manager step is skipped for people without a manager. With no steps, requests are approved straight away.</div>
            </div>
            {f.steps.map((s, i) => (
              <div key={s.id} className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-muted w-5 text-[12px]">{i + 1}.</span>
                  <Select value={s.kind} onChange={(e) => setStep(i, { kind: e.target.value as StepKind, employeeId: null })} aria-label={`Step ${i + 1}`}>{STEP_KINDS.map((k) => <option key={k} value={k}>{STEP_KIND_LABEL[k]}</option>)}</Select>
                  <Button variant="ghost" size="sm" aria-label="Remove step" onClick={() => setF({ ...f, steps: f.steps.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
                </div>
                {s.kind === "person" ? <SearchSelect value={s.employeeId ?? ""} onChange={(v) => setStep(i, { employeeId: v || null })} options={people} placeholder="Pick who approves" aria-label={`Step ${i + 1} approver`} /> : null}
              </div>
            ))}
            <Button size="sm" className="self-start" disabled={f.steps.length >= 5} onClick={() => setF({ ...f, steps: [...f.steps, { id: uid(), kind: "hr", employeeId: null }] })}><Plus size={14} /> Add step</Button>
          </Card>
          <Card className="gap-2">
            <div className="text-[14px] font-medium">Who can use it</div>
            <div className="text-muted text-[12px]">Leave everything unticked for everyone.</div>
            {L.data?.departments.length ? <div className="card-kicker mt-1">Departments</div> : null}
            {L.data?.departments.map((d) => <Checkbox key={d.id} checked={f.departmentIds.includes(d.id)} onChange={() => toggle("departmentIds", d.id)} label={d.name} />)}
            {L.data?.branches.length ? <div className="card-kicker mt-1">Branches</div> : null}
            {L.data?.branches.map((b) => <Checkbox key={b.id} checked={f.branchIds.includes(b.id)} onChange={() => toggle("branchIds", b.id)} label={b.name} />)}
          </Card>
          {row?.status !== "archived" ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button loading={save.isPending && save.variables === false} disabled={!ready} onClick={() => save.mutate(false)}>Save</Button>
              {!live ? <Button variant="primary" loading={save.isPending && save.variables === true} disabled={!ready} onClick={() => save.mutate(true)}>Publish</Button> : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
