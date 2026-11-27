import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronLeft, FileText, Plus, Trash2, Upload } from "lucide-react";
import { COURSE_KIND_LABEL, ENROLLMENT_STATE_LABEL, fmtDate, type CourseKind, type EnrollmentState, type Lesson, type QuizQuestion } from "@hrms/shared";
import { api, errorMessage, openFile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, StatCard, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Checkbox, Field, Input, Segmented, Select, Textarea } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { ErrorState, Loading, Notice, PageHeader } from "@/components/ui/page";
import { PillTabs } from "@/components/ui/tabs";
import { Tag, type Tone } from "@/components/ui/tag";
import { useLookups } from "@/components/recruitment/shared";

interface CourseRow {
  id: string;
  kind: CourseKind;
  title: string;
  description: string;
  lessons: Lesson[];
  quiz: QuizQuestion[];
  passMark: number;
  acknowledgement: string;
  audience: { departmentIds: string[]; branchIds: string[] };
  dueDays: number;
  status: "draft" | "published" | "archived";
  publishedAt: string | null;
  hasFile: boolean;
  fileName: string | null;
  assigned?: number;
  done?: number;
  overdue?: number;
}
const STATUS: Record<CourseRow["status"], [string, Tone]> = { draft: ["Draft", "neutral"], published: ["Published", "ok"], archived: ["Archived", "outline"] };
export const STATE_TONE: Record<EnrollmentState, Tone> = { not_started: "neutral", in_progress: "accent", completed: "ok", overdue: "bad" };
const uid = () => Math.random().toString(36).slice(2, 9);

/** Admin → Learning: courses and policies, with how far everyone has got. */
export default function Learning() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["learning", "admin"], queryFn: () => api.get<CourseRow[]>("/admin/learning") });
  const columns = useMemo<ColumnDef<CourseRow>[]>(
    () => [
      { id: "title", header: "Course", accessorKey: "title", cell: ({ row: { original: c } }) => <div className="max-w-[420px] whitespace-normal"><div className="font-medium">{c.title}</div><div className="text-muted text-[12px]">{COURSE_KIND_LABEL[c.kind]}{c.kind === "course" ? ` · ${c.lessons.length} lessons${c.quiz.length ? `, ${c.quiz.length} question quiz` : ""}` : ""}</div></div> },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row: { original: c } }) => <Tag tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Tag> },
      { id: "done", header: "Done", cell: ({ row: { original: c } }) => (c.assigned ? <div><span className="num">{c.done} of {c.assigned}</span><div className="text-muted text-[12px]">{Math.round(((c.done ?? 0) / c.assigned) * 100)}%</div></div> : "—") },
      { id: "overdue", header: "Overdue", cell: ({ row: { original: c } }) => (c.overdue ? <Tag tone="bad">{c.overdue}</Tag> : "—") },
    ],
    [],
  );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Learning" sub="Short courses with a quiz, and policies people read and confirm" actions={<Menu trigger={<Button variant="primary"><Plus size={16} /> New</Button>} items={[{ label: "Course", onSelect: () => nav("/learning/new?kind=course") }, { label: "Policy to read and confirm", onSelect: () => nav("/learning/new?kind=policy") }]} />} />
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <TableCard>
        <DataTable data={q.data ?? []} columns={columns} getRowId={(r) => r.id} loading={q.isFetching} onRowClick={(r) => nav(`/learning/${r.id}`)} storageKey="learning" empty="Nothing yet. Start with your POSH course or your leave policy." />
      </TableCard>
    </div>
  );
}

export function CoursePage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ["learning", id], queryFn: () => api.get<CourseRow>(`/admin/learning/${id}`), enabled: !!id && id !== "new" });
  const [tab, setTab] = useState<"content" | "progress">("content");
  if (id && id !== "new" && !q.data) return q.error ? <ErrorState error={q.error} /> : <Loading />;
  const row = id === "new" ? null : q.data!;
  return (
    <div className="flex flex-col gap-4">
      <Link to="/learning" className="inline-flex items-center gap-1 self-start text-[13px] no-underline"><ChevronLeft size={15} /> Learning</Link>
      {row && row.status !== "draft" ? <PillTabs value={tab} onChange={setTab} tabs={[{ value: "content", label: "Content" }, { value: "progress", label: "Who's done it" }]} /> : null}
      {tab === "progress" && row ? <Progress c={row} /> : <Editor row={row} key={row?.id ?? "new"} />}
    </div>
  );
}

function Editor({ row }: { row: CourseRow | null }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const L = useLookups();
  const kind = (row?.kind ?? (new URLSearchParams(location.search).get("kind") === "policy" ? "policy" : "course")) as CourseKind;
  const [f, setF] = useState({
    title: row?.title ?? "",
    description: row?.description ?? "",
    lessons: row?.lessons ?? (kind === "policy" ? [{ id: "policy", title: "The policy", body: "", videoUrl: null }] : [{ id: uid(), title: "", body: "", videoUrl: null }]),
    quiz: row?.quiz ?? [],
    passMark: row?.passMark ?? 70,
    acknowledgement: row?.acknowledgement ?? "I have read and understood this policy, and I will follow it.",
    departmentIds: row?.audience.departmentIds ?? [],
    branchIds: row?.audience.branchIds ?? [],
    dueDays: row?.dueDays ?? 14,
  });
  const [file, setFile] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: async (publish: boolean) => {
      const body = { ...f, kind, lessons: f.lessons.filter((l) => l.title.trim()).map((l) => ({ ...l, videoUrl: l.videoUrl || null })) };
      const saved = row ? await api.put<CourseRow>(`/admin/learning/${row.id}`, body) : await api.post<CourseRow>("/admin/learning", body);
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        await api.post(`/admin/learning/${saved.id}/file`, fd);
      }
      const r = publish ? await api.post<{ assigned: number }>(`/admin/learning/${saved.id}/publish`) : null;
      return { id: saved.id, assigned: r?.assigned };
    },
    onSuccess: (r) => (toast.success(r.assigned !== undefined ? `Published to ${r.assigned} people` : "Saved"), qc.invalidateQueries({ queryKey: ["learning"] }), setFile(null), nav(`/learning/${r.id}`, { replace: true })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const act = useMutation({
    mutationFn: (a: "archive" | "remind" | "delete") => (a === "delete" ? api.del(`/admin/learning/${row!.id}`) : api.post<{ sent?: number }>(`/admin/learning/${row!.id}/${a}`)),
    onSuccess: (r, a) => (toast.success(a === "remind" ? `Reminded ${(r as { sent?: number }).sent ?? 0} people` : a === "archive" ? "Archived" : "Deleted"), qc.invalidateQueries({ queryKey: ["learning"] }), a === "delete" ? nav("/learning") : undefined),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setL = (i: number, p: Partial<Lesson>) => setF({ ...f, lessons: f.lessons.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const setQ = (i: number, p: Partial<QuizQuestion>) => setF({ ...f, quiz: f.quiz.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const move = (i: number, d: -1 | 1) => { const ls = [...f.lessons]; [ls[i], ls[i + d]] = [ls[i + d]!, ls[i]!]; setF({ ...f, lessons: ls }); };
  const toggle = (k: "departmentIds" | "branchIds", id: string) => setF({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] });
  const published = row?.status === "published";
  const ready = f.title.trim().length >= 3 && (kind === "policy" ? !!(file || row?.hasFile || f.lessons[0]?.body.trim()) : f.lessons.some((l) => l.title.trim().length >= 2)) && f.quiz.every((q) => q.question.trim().length >= 3 && q.options.filter((o) => o.trim()).length >= 2);
  return (
    <>
      <PageHeader
        title={row ? row.title : kind === "policy" ? "New policy" : "New course"}
        sub={row ? <span className="inline-flex items-center gap-2"><Tag tone={STATUS[row.status][1]}>{STATUS[row.status][0]}</Tag>{COURSE_KIND_LABEL[row.kind]}</span> : kind === "policy" ? "Attach the document or write it in, then publish. Everyone it's for confirms they've read it." : "A few short lessons, then an optional quiz. People pass when they get the pass mark."}
        actions={row ? <Menu trigger={<Button>More</Button>} items={[...(published ? [{ label: "Remind who hasn't finished", onSelect: () => act.mutate("remind") }, { label: "Archive", onSelect: () => act.mutate("archive"), danger: true }] : []), ...(row.status === "draft" ? [{ label: "Delete draft", onSelect: () => act.mutate("delete"), danger: true }] : [])]} /> : null}
      />
      {published ? <Notice tone="sel">It's published. Changes show straight away; anyone you add to who it's for gets it now.</Notice> : null}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-3">
          <Card className="gap-3">
            <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={150} placeholder={kind === "policy" ? "Leave policy 2027" : "POSH basics"} /></Field>
            <Field label="Description" hint="Optional. Shown in the list and the email."><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} className="!min-h-[64px]" /></Field>
          </Card>
          {kind === "policy" ? (
            <Card className="gap-3">
              <div className="text-[15px] font-medium">The policy</div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="btn btn-secondary cursor-pointer"><Upload size={15} /> {row?.hasFile || file ? "Replace document" : "Attach the document"}<input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
                {file ? <span className="text-[13px]"><FileText size={13} className="inline" /> {file.name}</span> : row?.hasFile ? <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-[13px] underline" style={{ color: "var(--color-accent)" }} onClick={() => openFile(`/admin/learning/${row.id}/file`).catch((e) => toast.error(errorMessage(e)))}><FileText size={13} className="inline" /> {row.fileName}</button> : <span className="text-muted text-[13px]">PDF, up to 20 MB. Or write it in below.</span>}
              </div>
              <Field label="Or write it in"><Textarea value={f.lessons[0]?.body ?? ""} onChange={(e) => setL(0, { body: e.target.value })} maxLength={20000} className="!min-h-[160px]" /></Field>
              <Field label="What people confirm"><Input value={f.acknowledgement} onChange={(e) => setF({ ...f, acknowledgement: e.target.value })} maxLength={500} /></Field>
            </Card>
          ) : (
            <>
              {f.lessons.map((l, i) => (
                <Card key={l.id} className="gap-3">
                  <div className="flex items-center gap-2">
                    <div className="card-kicker flex-1">Lesson {i + 1}</div>
                    <Button variant="ghost" size="sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></Button>
                    <Button variant="ghost" size="sm" aria-label="Move down" disabled={i === f.lessons.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></Button>
                    <Button variant="ghost" size="sm" aria-label="Remove lesson" disabled={f.lessons.length === 1} onClick={() => setF({ ...f, lessons: f.lessons.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
                  </div>
                  <Field label="Title"><Input value={l.title} onChange={(e) => setL(i, { title: e.target.value })} maxLength={150} /></Field>
                  <Field label="Text" hint="Plain text. Leave a blank line between paragraphs; links work."><Textarea value={l.body} onChange={(e) => setL(i, { body: e.target.value })} maxLength={20000} className="!min-h-[120px]" /></Field>
                  <Field label="Video link" hint="Optional. YouTube, Vimeo or any link."><Input value={l.videoUrl ?? ""} onChange={(e) => setL(i, { videoUrl: e.target.value || null })} placeholder="https://" /></Field>
                </Card>
              ))}
              <Button className="self-start" disabled={f.lessons.length >= 30} onClick={() => setF({ ...f, lessons: [...f.lessons, { id: uid(), title: "", body: "", videoUrl: null }] })}><Plus size={15} /> Add lesson</Button>
              <Card className="gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-[15px] font-medium">Quiz</div>{f.quiz.length ? <Field label="Pass mark (%)"><Input type="number" min={0} max={100} value={f.passMark} onChange={(e) => setF({ ...f, passMark: Number(e.target.value) })} className="!w-24" /></Field> : null}</div>
                {f.quiz.length ? null : <div className="text-muted text-[13px]">No quiz. People finish once they've been through the lessons.</div>}
                {f.quiz.map((q, i) => (
                  <div key={q.id} className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                    <div className="flex gap-2"><Input value={q.question} onChange={(e) => setQ(i, { question: e.target.value })} maxLength={300} placeholder={`Question ${i + 1}`} aria-label={`Question ${i + 1}`} /><Button variant="ghost" aria-label="Remove question" onClick={() => setF({ ...f, quiz: f.quiz.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button></div>
                    {q.options.map((o, j) => (
                      <div key={j} className="flex items-center gap-2"><input type="radio" className="size-4 shrink-0 accent-[var(--color-accent)]" name={`ans-${q.id}`} checked={q.answer === j} onChange={() => setQ(i, { answer: j })} aria-label={`Option ${j + 1} is the right answer`} /><Input value={o} onChange={(e) => setQ(i, { options: q.options.map((x, k) => (k === j ? e.target.value : x)) })} maxLength={200} placeholder={`Option ${j + 1}`} aria-label={`Option ${j + 1}`} />{q.options.length > 2 ? <Button variant="ghost" size="sm" aria-label="Remove option" onClick={() => setQ(i, { options: q.options.filter((_, k) => k !== j), answer: q.answer === j ? 0 : q.answer > j ? q.answer - 1 : q.answer })}><Trash2 size={13} /></Button> : null}</div>
                    ))}
                    <div className="flex items-center gap-2"><Button size="sm" disabled={q.options.length >= 6} onClick={() => setQ(i, { options: [...q.options, ""] })}><Plus size={13} /> Option</Button><span className="text-muted text-[12px]">Tick the right answer.</span></div>
                  </div>
                ))}
                <Button size="sm" className="self-start" disabled={f.quiz.length >= 30} onClick={() => setF({ ...f, quiz: [...f.quiz, { id: uid(), question: "", options: ["", ""], answer: 0 }] })}><Plus size={14} /> Add question</Button>
              </Card>
            </>
          )}
        </div>
        <div className="flex flex-col gap-3 lg:sticky lg:top-4">
          <Card className="gap-2">
            <Field label="Due" hint="Days after it's assigned to someone, including people who join later."><Select value={String(f.dueDays)} onChange={(e) => setF({ ...f, dueDays: Number(e.target.value) })}>{[3, 7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>Within {d} days</option>)}</Select></Field>
            <div className="mt-1 text-[14px] font-medium">Who it's for</div>
            <div className="text-muted text-[12px]">Leave everything unticked for everyone.</div>
            {L.data?.departments.length ? <div className="card-kicker mt-1">Departments</div> : null}
            {L.data?.departments.map((d) => <Checkbox key={d.id} checked={f.departmentIds.includes(d.id)} onChange={() => toggle("departmentIds", d.id)} label={d.name} />)}
            {L.data?.branches.length ? <div className="card-kicker mt-1">Branches</div> : null}
            {L.data?.branches.map((b) => <Checkbox key={b.id} checked={f.branchIds.includes(b.id)} onChange={() => toggle("branchIds", b.id)} label={b.name} />)}
          </Card>
          <div className="flex flex-wrap justify-end gap-2">
            <Button loading={save.isPending && save.variables === false} disabled={!ready} onClick={() => save.mutate(false)}>Save</Button>
            {!published ? <Button variant="primary" loading={save.isPending && save.variables === true} disabled={!ready} onClick={() => save.mutate(true)}>Publish</Button> : null}
          </div>
        </div>
      </div>
    </>
  );
}

interface ProgressRow { employeeId: string; name: string; code: string; dueOn: string; state: EnrollmentState; lessonsDone: number; lessons: number; attempts: number; score: number | null; completedAt: string | null }

function Progress({ c }: { c: CourseRow }) {
  const q = useQuery({ queryKey: ["learning", c.id, "progress"], queryFn: () => api.get<ProgressRow[]>(`/admin/learning/${c.id}/progress`) });
  const [state, setState] = useState<"all" | EnrollmentState>("all");
  const rows = (q.data ?? []).filter((r) => state === "all" || r.state === state);
  const count = (s: EnrollmentState) => (q.data ?? []).filter((r) => r.state === s).length;
  const columns = useMemo<ColumnDef<ProgressRow>[]>(
    () => [
      { id: "name", header: "Employee", accessorKey: "name", cell: ({ row: { original: r } }) => <div><div className="font-medium">{r.name}</div><div className="text-muted text-[12px]">{r.code}</div></div> },
      { id: "state", header: "Status", accessorKey: "state", cell: ({ row: { original: r } }) => <Tag tone={STATE_TONE[r.state]}>{ENROLLMENT_STATE_LABEL[r.state]}</Tag> },
      { id: "due", header: "Due", accessorKey: "dueOn", cell: ({ getValue }) => fmtDate(getValue<string>()) },
      ...(c.kind === "course" ? [{ id: "lessons", header: "Lessons", cell: ({ row: { original: r } }: { row: { original: ProgressRow } }) => `${r.lessonsDone} of ${r.lessons}` }, { id: "score", header: "Best score", cell: ({ row: { original: r } }: { row: { original: ProgressRow } }) => (r.score === null ? "—" : `${r.score}%${r.attempts > 1 ? ` · ${r.attempts} tries` : ""}`) }] : []),
      { id: "done", header: "Finished", accessorKey: "completedAt", cell: ({ getValue }) => (getValue<string | null>() ? fmtDate(getValue<string>().slice(0, 10)) : "—") },
    ],
    [c.kind],
  );
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Assigned" value={q.data?.length ?? "—"} />
        <StatCard label="Done" value={count("completed")} />
        <StatCard label="In progress" value={count("in_progress")} />
        <StatCard label="Overdue" value={count("overdue")} />
      </div>
      <Segmented value={state} onChange={setState} options={[{ value: "all", label: "Everyone" }, { value: "overdue", label: "Overdue" }, { value: "not_started", label: "Not started" }, { value: "in_progress", label: "In progress" }, { value: "completed", label: "Done" }]} />
      <TableCard>
        <CardHeader className="py-2" title={c.title} />
        <DataTable data={rows} columns={columns} getRowId={(r) => r.employeeId} loading={q.isFetching} storageKey="learning-progress" empty="Nobody here." />
      </TableCard>
    </>
  );
}
