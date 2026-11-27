import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";
import { fmtDate, STEP_KIND_LABEL, type FormField, type StepKind } from "@hrms/shared";
import { api, ApiError, errorMessage } from "@/lib/api";
import { Body } from "@/components/announcements/Body";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Empty, ErrorState, Loading } from "@/components/ui/page";
import { PillTabs } from "@/components/ui/tabs";
import { useSession } from "@/lib/session";
import { RequestStatus, RequestView, type RequestDetail, type RequestRow } from "@/components/forms/RequestView";

interface Home { forms: { id: string; title: string; description: string; steps: number }[]; mine: RequestRow[]; toApprove: number }
export const useMyForms = () => useQuery({ queryKey: ["forms", "mine"], queryFn: () => api.get<Home>("/ess/forms") });

/** Me → Forms: send a request, follow it, and approve ones waiting for me. */
export default function MyForms() {
  const q = useMyForms();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "new" | "mine" | "approve") ?? "new";
  const approvals = useQuery({ queryKey: ["forms", "approvals"], queryFn: () => api.get<{ waiting: RequestRow[]; decided: RequestRow[] }>("/ess/forms/approvals"), enabled: tab === "approve" });
  const nav = useNavigate();
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data) return <Loading />;
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[22px] font-semibold">Forms</h1>
        <div className="text-muted text-[13px]">Requests your company handles through its own forms.</div>
      </div>
      <PillTabs value={tab} onChange={(v) => setParams(v === "new" ? {} : { tab: v }, { replace: true })} tabs={[{ value: "new", label: "New request" }, { value: "mine", label: `My requests${d.mine.length ? ` (${d.mine.length})` : ""}` }, ...(d.toApprove || tab === "approve" ? [{ value: "approve" as const, label: `To approve${d.toApprove ? ` (${d.toApprove})` : ""}` }] : [])]} />
      {tab === "new" ? (
        d.forms.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {d.forms.map((f) => (
              <button key={f.id} type="button" className="card flex items-start gap-3 text-left" onClick={() => nav(`/me/forms/new/${f.id}`)}>
                <ClipboardList size={20} className="text-muted mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1"><div className="font-medium">{f.title}</div>{f.description ? <div className="text-muted line-clamp-2 text-[13px]">{f.description}</div> : null}</div>
                <ChevronRight size={16} className="text-muted mt-1" />
              </button>
            ))}
          </div>
        ) : <Empty title="No forms yet" sub="When HR sets up a request form for you, it shows up here." />
      ) : tab === "mine" ? (
        <List rows={d.mine} empty="You haven't sent any requests." />
      ) : approvals.data ? (
        <>
          <List rows={approvals.data.waiting} empty="Nothing is waiting for you." who />
          {approvals.data.decided.length ? <><div className="card-kicker mt-2">You decided</div><List rows={approvals.data.decided} empty="" who /></> : null}
        </>
      ) : <Loading />}
    </div>
  );
}

function List({ rows, empty, who }: { rows: RequestRow[]; empty: string; who?: boolean }) {
  const nav = useNavigate();
  if (!rows.length) return empty ? <Empty title={empty} /> : null;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <button key={r.id} type="button" className="card flex items-center gap-3 text-left" onClick={() => nav(`/me/forms/${r.id}`)}>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{r.title}</div>
            <div className="text-muted text-[12px]"><span className="num">{r.code}</span>{who && r.employee ? ` · ${r.employee.name}` : ""} · {fmtDate(r.createdAt.slice(0, 10))}</div>
          </div>
          <RequestStatus r={r} />
        </button>
      ))}
    </div>
  );
}

export function FillForm() {
  const { formId = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["forms", "fill", formId], queryFn: () => api.get<{ id: string; title: string; description: string; fields: FormField[]; steps: StepKind[] }>(`/ess/forms/form/${formId}`) });
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const send = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("answers", JSON.stringify(answers));
      for (const [k, f] of Object.entries(files)) fd.append(`file:${k}`, f);
      return api.post<{ id: string; code: string; status: string }>(`/ess/forms/form/${formId}`, fd);
    },
    onSuccess: (r) => (toast.success(r.status === "approved" ? `${r.code} is approved` : `${r.code} sent`), qc.invalidateQueries({ queryKey: ["forms"] }), nav(`/me/forms/${r.id}`, { replace: true })),
    onError: (e) => {
      const fields = e instanceof ApiError ? (e.details as { fields?: Record<string, string> } | undefined)?.fields : undefined;
      if (fields) setErrors(fields);
      toast.error(errorMessage(e));
    },
  });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Loading />;
  const f = q.data;
  const set = (id: string, v: string | boolean) => (setAnswers({ ...answers, [id]: v }), setErrors({ ...errors, [id]: "" }));
  return (
    <div className="flex flex-col gap-4">
      <Link to="/me/forms" className="inline-flex items-center gap-1 self-start text-[13px] no-underline"><ChevronLeft size={15} /> Forms</Link>
      <div>
        <h1 className="text-[22px] font-semibold">{f.title}</h1>
        {f.description ? <Body text={f.description} className="mt-1" /> : null}
        <div className="text-muted mt-1 text-[13px]">{f.steps.length ? `Approved by ${f.steps.map((s) => STEP_KIND_LABEL[s].replace("Their manager", "your manager").replace("A named person", "a named person")).join(", then ")}.` : "No approval needed."}</div>
      </div>
      <Card className="gap-4">
        {f.fields.map((x) => {
          const v = answers[x.id];
          const err = errors[x.id] || null;
          const label = `${x.label}${x.required && x.type !== "checkbox" ? "" : x.type === "checkbox" ? "" : " (optional)"}`;
          if (x.type === "checkbox") return <div key={x.id}><Checkbox checked={v === true} onChange={(b) => set(x.id, b)} label={x.label} />{x.help ? <div className="text-muted ms-7 text-[12px]">{x.help}</div> : null}{err ? <div className="ms-7 text-[12px]" style={{ color: "var(--bad)" }}>{err}</div> : null}</div>;
          return (
            <Field key={x.id} label={label} hint={x.help || undefined} error={err}>
              {x.type === "textarea" ? <Textarea value={String(v ?? "")} onChange={(e) => set(x.id, e.target.value)} maxLength={5000} />
                : x.type === "select" ? <Select value={String(v ?? "")} onChange={(e) => set(x.id, e.target.value)}><option value="">Pick one</option>{x.options.map((o) => <option key={o} value={o}>{o}</option>)}</Select>
                : x.type === "file" ? <input type="file" accept="application/pdf,image/*" className="text-[13px]" onChange={(e) => { const file = e.target.files?.[0]; const next = { ...files }; if (file) next[x.id] = file; else delete next[x.id]; setFiles(next); setErrors({ ...errors, [x.id]: "" }); }} />
                : <Input type={x.type === "number" ? "text" : x.type} inputMode={x.type === "number" ? "decimal" : undefined} value={String(v ?? "")} onChange={(e) => set(x.id, e.target.value)} maxLength={300} />}
            </Field>
          );
        })}
        <Button variant="primary" className="self-start" loading={send.isPending} onClick={() => send.mutate()}>Send request</Button>
      </Card>
    </div>
  );
}

export function MyRequest() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { tenant } = useSession();
  const q = useQuery({ queryKey: ["forms", "request", id], queryFn: () => api.get<RequestDetail>(`/ess/forms/requests/${id}`) });
  const withdraw = useMutation({ mutationFn: () => api.post(`/ess/forms/requests/${id}/withdraw`), onSuccess: () => (toast.success("Withdrawn"), qc.invalidateQueries({ queryKey: ["forms"] })), onError: (e) => toast.error(errorMessage(e)) });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Loading />;
  const r = q.data;
  return (
    <div className="flex flex-col gap-4">
      <Link to={r.mine ? "/me/forms?tab=mine" : "/me/forms?tab=approve"} className="inline-flex items-center gap-1 self-start text-[13px] no-underline"><ChevronLeft size={15} /> Forms</Link>
      <div>
        <h1 className="text-[22px] font-semibold">{r.title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px]"><span className="num text-muted">{r.code}</span><RequestStatus r={r} /></div>
      </div>
      <RequestView r={r} base={`/ess/forms/requests/${r.id}`} decide={r.approver?.id && r.approver.id === tenant?.employeeId ? `/ess/forms/requests/${r.id}/decision` : undefined} onWithdraw={r.mine ? () => withdraw.mutate() : undefined} />
    </div>
  );
}
