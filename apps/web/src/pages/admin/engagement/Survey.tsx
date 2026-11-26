import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronLeft, Plus, Trash2 } from "lucide-react";
import { fmtDate, QUESTION_TYPE_LABEL, QUESTION_TYPES, SURVEY_KIND_LABEL, SURVEY_KINDS, SURVEY_TEMPLATES, todayLocal, type QuestionType, type SurveyKind } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, Loading, Notice, PageHeader } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { useLookups } from "@/components/recruitment/shared";
import { SurveyResults, type Results } from "@/components/engagement/shared";
import { SURVEY_STATE, type SurveyRow } from "./Engagement";

type Q = SurveyRow["questions"][number];
type Form = { title: string; description: string; kind: SurveyKind; anonymous: boolean; departmentIds: string[]; branchIds: string[]; questions: Q[]; closesOn: string; shareResults: boolean };

const blank = (): Form => ({ title: "", description: "", kind: "pulse", anonymous: true, departmentIds: [], branchIds: [], questions: [{ id: "q1", type: "scale", text: "", options: [], required: true }], closesOn: "", shareResults: false });
const fromRow = (s: SurveyRow): Form => ({ title: s.title, description: s.description, kind: s.kind, anonymous: s.anonymous, departmentIds: s.audience.departmentIds, branchIds: s.audience.branchIds, questions: s.questions, closesOn: s.closesOn ?? "", shareResults: s.shareResults });
const nextId = (qs: Q[]) => `q${Math.max(0, ...qs.map((q) => Number(q.id.replace(/\D/g, "")) || 0)) + 1}`;

export default function Survey() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ["surveys", id], queryFn: () => api.get<SurveyRow>(`/admin/engagement/surveys/${id}`), enabled: !!id && id !== "new" });
  if (!id || id === "new") return <Editor />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data) return <Loading />;
  return q.data.status === "draft" ? <Editor row={q.data} /> : <Detail s={q.data} />;
}

function Back() {
  return <Link to="/engagement" className="inline-flex items-center gap-1 self-start text-[13px] no-underline"><ChevronLeft size={15} /> All surveys</Link>;
}

function Editor({ row }: { row?: SurveyRow }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const L = useLookups();
  const tpl = SURVEY_TEMPLATES.find((t) => t.key === params.get("template"));
  const [f, setF] = useState<Form>(() => (row ? fromRow(row) : tpl ? { ...blank(), ...tpl.survey } : blank()));
  const save = useMutation({
    mutationFn: async (open: boolean): Promise<SurveyRow & { emailed?: number }> => {
      const body = { ...f, closesOn: f.closesOn || null, questions: f.questions.map((x) => ({ ...x, options: x.type === "choice" || x.type === "multi" ? x.options.filter((o) => o.trim()) : [] })) };
      if (!row) return api.post<SurveyRow & { emailed?: number }>("/admin/engagement/surveys", { ...body, open });
      await api.put(`/admin/engagement/surveys/${row.id}`, body);
      return open ? api.post<SurveyRow & { emailed?: number }>(`/admin/engagement/surveys/${row.id}/open`) : api.get<SurveyRow>(`/admin/engagement/surveys/${row.id}`);
    },
    onSuccess: (r, open) => {
      toast.success(open ? `Opened for ${r.invited} people${r.emailed ? `, emailed ${r.emailed}` : ""}` : "Draft saved");
      qc.invalidateQueries({ queryKey: ["surveys"] });
      nav(`/engagement/surveys/${r.id}`, { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/admin/engagement/surveys/${row!.id}`),
    onSuccess: () => (toast.success("Draft deleted"), qc.invalidateQueries({ queryKey: ["surveys"] }), nav("/engagement")),
  });
  const setQ = (i: number, patch: Partial<Q>) => setF({ ...f, questions: f.questions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const move = (i: number, d: -1 | 1) => {
    const qs = [...f.questions];
    [qs[i], qs[i + d]] = [qs[i + d]!, qs[i]!];
    setF({ ...f, questions: qs });
  };
  const toggle = (k: "departmentIds" | "branchIds", id: string) => setF({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] });
  const problems = [
    f.title.trim().length < 3 && "Give it a title",
    f.questions.some((x) => x.text.trim().length < 3) && "Write every question",
    f.questions.some((x) => (x.type === "choice" || x.type === "multi") && x.options.filter((o) => o.trim()).length < 2) && "Give choice questions at least two options",
  ].filter(Boolean) as string[];
  return (
    <div className="flex flex-col gap-4">
      <Back />
      <PageHeader title={row ? "Edit draft" : "New survey"} sub="Questions and who it's for can't change once it's open, so check them before you send it." />
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-3">
          <Card className="gap-3">
            <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={150} placeholder="December pulse" /></Field>
            <Field label="Note to employees" hint="Optional. Shown above the questions and in the email."><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} className="!min-h-[64px]" /></Field>
          </Card>
          {f.questions.map((x, i) => (
            <Card key={x.id} className="gap-3">
              <div className="flex items-center gap-2">
                <div className="card-kicker flex-1">Question {i + 1}</div>
                <Button variant="ghost" size="sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></Button>
                <Button variant="ghost" size="sm" aria-label="Move down" disabled={i === f.questions.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></Button>
                <Button variant="ghost" size="sm" aria-label="Remove question" disabled={f.questions.length === 1} onClick={() => setF({ ...f, questions: f.questions.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
                <Field label="Question"><Input value={x.text} maxLength={300} onChange={(e) => setQ(i, { text: e.target.value })} placeholder="I have what I need to do my job well." /></Field>
                <Field label="Answer type">
                  <Select value={x.type} onChange={(e) => { const type = e.target.value as QuestionType; setQ(i, { type, options: (type === "choice" || type === "multi") && x.options.length < 2 ? ["", ""] : x.options }); }}>
                    {QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>)}
                  </Select>
                </Field>
              </div>
              {x.type === "choice" || x.type === "multi" ? (
                <div className="flex flex-col gap-2">
                  {x.options.map((o, j) => (
                    <div key={j} className="flex gap-2">
                      <Input value={o} maxLength={120} placeholder={`Option ${j + 1}`} onChange={(e) => setQ(i, { options: x.options.map((y, k) => (k === j ? e.target.value : y)) })} aria-label={`Option ${j + 1}`} />
                      <Button variant="ghost" aria-label="Remove option" disabled={x.options.length <= 2} onClick={() => setQ(i, { options: x.options.filter((_, k) => k !== j) })}><Trash2 size={14} /></Button>
                    </div>
                  ))}
                  <Button size="sm" className="self-start" disabled={x.options.length >= 12} onClick={() => setQ(i, { options: [...x.options, ""] })}><Plus size={14} /> Add option</Button>
                </div>
              ) : null}
              {x.type === "scale" ? <div className="text-muted text-[12.5px]">People answer from 1 (strongly disagree) to 5 (strongly agree).</div> : null}
              {x.type === "enps" ? <div className="text-muted text-[12.5px]">People answer from 0 to 10. The score is the share giving 9 or 10, minus the share giving 0 to 6.</div> : null}
              <Checkbox checked={x.required} onChange={(v) => setQ(i, { required: v })} label="Needs an answer" />
            </Card>
          ))}
          <Button className="self-start" disabled={f.questions.length >= 30} onClick={() => setF({ ...f, questions: [...f.questions, { id: nextId(f.questions), type: "scale", text: "", options: [], required: true }] })}><Plus size={15} /> Add question</Button>
        </div>
        <div className="flex flex-col gap-3 lg:sticky lg:top-4">
          <Card className="gap-3">
            <Field label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as SurveyKind })}>{SURVEY_KINDS.map((k) => <option key={k} value={k}>{SURVEY_KIND_LABEL[k]}</option>)}</Select></Field>
            <Checkbox checked={f.anonymous} onChange={(v) => setF({ ...f, anonymous: v })} label="Anonymous" />
            <div className="text-muted -mt-2 text-[12px]">{f.anonymous ? "Nobody, including HR, can see who said what. Results show once three people have answered." : "You'll see who hasn't answered yet, so you can follow up."}</div>
            <Field label="Closes on" hint="Optional. We remind people the day before."><Input type="date" min={todayLocal()} value={f.closesOn} onChange={(e) => setF({ ...f, closesOn: e.target.value })} /></Field>
            <Checkbox checked={f.shareResults} onChange={(v) => setF({ ...f, shareResults: v })} label="Share the results with everyone once it closes" />
          </Card>
          <Card className="gap-2">
            <div className="text-[14px] font-medium">Who it's for</div>
            <div className="text-muted text-[12px]">Leave everything unticked to send it to everyone.</div>
            {L.data?.departments.length ? <div className="card-kicker mt-1">Departments</div> : null}
            {L.data?.departments.map((d) => <Checkbox key={d.id} checked={f.departmentIds.includes(d.id)} onChange={() => toggle("departmentIds", d.id)} label={d.name} />)}
            {L.data?.branches.length ? <div className="card-kicker mt-1">Branches</div> : null}
            {L.data?.branches.map((b) => <Checkbox key={b.id} checked={f.branchIds.includes(b.id)} onChange={() => toggle("branchIds", b.id)} label={b.name} />)}
          </Card>
          {problems.length ? <div className="text-muted text-[12.5px]">{problems[0]}.</div> : null}
          <div className="flex flex-wrap gap-2">
            {row ? <Button variant="ghost" onClick={() => del.mutate()}>Delete</Button> : null}
            <div className="flex-1" />
            <Button loading={save.isPending && save.variables === false} disabled={!!problems.length} onClick={() => save.mutate(false)}>Save draft</Button>
            <Button variant="primary" loading={save.isPending && save.variables === true} disabled={!!problems.length} onClick={() => save.mutate(true)}>Open and send</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ s }: { s: SurveyRow }) {
  const qc = useQueryClient();
  const results = useQuery({ queryKey: ["surveys", s.id, "results"], queryFn: () => api.get<Results>(`/admin/engagement/surveys/${s.id}/results`) });
  const pending = useQuery({ queryKey: ["surveys", s.id, "pending"], queryFn: () => api.get<{ employeeId: string; name: string }[]>(`/admin/engagement/surveys/${s.id}/pending`), enabled: !s.anonymous && s.status === "open" });
  const [edit, setEdit] = useState(false);
  const done = () => qc.invalidateQueries({ queryKey: ["surveys"] });
  const act = useMutation({
    mutationFn: (a: "close" | "remind" | "reopen") => api.post<{ sent?: number }>(`/admin/engagement/surveys/${s.id}/${a}`, a === "reopen" ? { closesOn: null } : undefined),
    onSuccess: (r, a) => (toast.success(a === "close" ? "Closed" : a === "reopen" ? "Reopened" : `Reminder sent to ${r.sent ?? 0} people`), done()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const r = results.data;
  return (
    <div className="flex flex-col gap-4">
      <Back />
      <PageHeader
        title={s.title}
        sub={<span className="inline-flex flex-wrap items-center gap-2"><Tag tone={SURVEY_STATE[s.status][1]}>{SURVEY_STATE[s.status][0]}</Tag>{SURVEY_KIND_LABEL[s.kind]}{s.anonymous ? " · anonymous" : ""}{s.closesOn ? ` · ${s.status === "open" ? "closes" : "closing date"} ${fmtDate(s.closesOn)}` : ""}</span>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEdit(true)}>Edit details</Button>
            {s.status === "open" ? <Button loading={act.isPending && act.variables === "remind"} onClick={() => act.mutate("remind")}>Remind people</Button> : null}
            {s.status === "open" ? <Button variant="primary" loading={act.isPending && act.variables === "close"} onClick={() => act.mutate("close")}>Close now</Button> : <Button variant="primary" loading={act.isPending && act.variables === "reopen"} onClick={() => act.mutate("reopen")}>Reopen</Button>}
          </div>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Answered" value={r ? `${r.responses} of ${r.invited}` : "—"} />
        <StatCard label="Response rate" value={r && r.invited ? `${Math.round((r.responses / r.invited) * 100)}%` : "—"} />
        <StatCard label="Results shared with staff" value={!s.shareResults ? "No" : s.status === "closed" ? "Yes" : "When it closes"} />
      </div>
      {results.error ? <ErrorState error={results.error} retry={() => results.refetch()} /> : null}
      {r ? <SurveyResults r={r} anonymous={s.anonymous} /> : <Loading />}
      {pending.data?.length ? (
        <Card className="gap-2">
          <CardHeader className="!p-0" title={`Not answered yet · ${pending.data.length}`} sub="Remind people sends an email to just these people." />
          <div className="flex flex-wrap gap-1.5">{pending.data.map((p) => <span key={p.employeeId} className="tag tag-neutral">{p.name}</span>)}</div>
        </Card>
      ) : null}
      {edit ? <EditDetails s={s} onClose={() => setEdit(false)} onSaved={done} /> : null}
    </div>
  );
}

function EditDetails({ s, onClose, onSaved }: { s: SurveyRow; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(fromRow(s));
  const save = useMutation({
    mutationFn: () => api.put(`/admin/engagement/surveys/${s.id}`, { ...f, closesOn: f.closesOn || null }),
    onSuccess: () => (toast.success("Saved"), onSaved(), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Edit details" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <Notice tone="sel">The questions and who it's for are fixed once it's open.</Notice>
        <Field label="Title"><Input value={f.title} maxLength={150} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Note to employees"><Textarea value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} className="!min-h-[64px]" /></Field>
        {s.status === "open" ? <Field label="Closes on"><Input type="date" min={todayLocal()} value={f.closesOn} onChange={(e) => setF({ ...f, closesOn: e.target.value })} /></Field> : null}
        <Checkbox checked={f.shareResults} onChange={(v) => setF({ ...f, shareResults: v })} label="Share the results with everyone once it closes" />
      </div>
    </Dialog>
  );
}
