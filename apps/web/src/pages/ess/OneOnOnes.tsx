import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus, Lock, Plus, Trash2 } from "lucide-react";
import { ONE_ON_ONE_REPEAT, ONE_ON_ONE_REPEAT_LABEL, todayLocal, zonedDateTime, type ActionItem, type AgendaItem, type OneOnOneRepeat } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Empty, ErrorState, Loading } from "@/components/ui/page";
import { RouteTabs } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { ESS_PERFORMANCE_TABS } from "./Okrs";

interface Meeting {
  id: string;
  role: "manager" | "employee";
  with: { id: string; name: string };
  scheduledFor: string;
  repeat: OneOnOneRepeat;
  status: "scheduled" | "done" | "cancelled";
  agenda: AgendaItem[];
  actions: ActionItem[];
  sharedNotes: string;
  myNotes: string;
}
interface List { upcoming: Meeting[]; past: Meeting[]; people: { id: string; name: string; relation: "manager" | "report" }[] }
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const uid = () => Math.random().toString(36).slice(2, 10);

/** 1:1s with my manager and with the people who report to me. */
export default function OneOnOnes() {
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ["one-on-ones"], queryFn: () => api.get<List>("/ess/one-on-ones") });
  const [booking, setBooking] = useState(false);
  const all = [...(q.data?.upcoming ?? []), ...(q.data?.past ?? [])];
  const id = params.get("id") ?? q.data?.upcoming[0]?.id ?? q.data?.past[0]?.id ?? null;
  const Item = ({ m }: { m: Meeting }) => (
    <button type="button" onClick={() => setParams({ id: m.id })} className="flex w-full cursor-pointer items-center gap-2 border-0 border-b border-[var(--color-divider)] bg-transparent px-4 py-3 text-start text-[var(--color-text)] last:border-b-0" style={{ background: m.id === id ? "var(--sel-bg)" : undefined }}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium">{m.with.name}</div>
        <div className="text-muted text-[12px]">{when(m.scheduledFor)}</div>
      </div>
      {m.status === "cancelled" ? <Tag tone="outline">Cancelled</Tag> : m.status === "done" ? <Tag tone="ok">Done</Tag> : m.role === "manager" ? <Tag tone="neutral">Your report</Tag> : <Tag tone="accent">Your manager</Tag>}
    </button>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="!mb-1 text-[26px]">Performance</h1>
          <div className="text-muted text-[13.5px]">Regular 1:1s with your manager and your team: a shared agenda, notes and follow ups.</div>
        </div>
        {q.data?.people.length ? <Button variant="primary" onClick={() => setBooking(true)}><CalendarPlus size={16} /> Book a 1:1</Button> : null}
      </div>
      <RouteTabs tabs={ESS_PERFORMANCE_TABS} />
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      {q.isLoading ? <Loading /> : null}
      {q.data && !all.length ? (
        <Card><Empty title="No 1:1s yet" sub={q.data.people.length ? "A short 1:1 every week or two is the best way to stay in step. Book the first one." : "You don't have a manager or team set in Saralix yet."} action={q.data.people.length ? <Button variant="primary" onClick={() => setBooking(true)}>Book a 1:1</Button> : undefined} /></Card>
      ) : null}
      {all.length ? (
        <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Card padded={false} className="!gap-0 overflow-hidden">
            {q.data!.upcoming.length ? <div className="card-kicker px-4 pb-1 pt-3">Coming up</div> : null}
            {q.data!.upcoming.map((m) => <Item key={m.id} m={m} />)}
            {q.data!.past.length ? <div className="card-kicker px-4 pb-1 pt-3">Earlier</div> : null}
            {q.data!.past.map((m) => <Item key={m.id} m={m} />)}
          </Card>
          {id ? <Detail key={id} id={id} onMoved={(next) => setParams(next ? { id: next } : {})} /> : null}
        </div>
      ) : null}
      {booking && q.data ? <BookDialog people={q.data.people} onClose={() => setBooking(false)} onBooked={(nid) => setParams({ id: nid })} /> : null}
    </div>
  );
}

/** Saves a text field a moment after typing stops. */
function useAutosave(value: string, initial: string, save: (v: string) => void) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    if (value === initial) return;
    const t = setTimeout(() => save(value), 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}

function Detail({ id, onMoved }: { id: string; onMoved: (next: string | null) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["one-on-ones", id], queryFn: () => api.get<Meeting>(`/ess/one-on-ones/${id}`) });
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data) return <Loading />;
  return <MeetingView m={q.data} onChange={(m) => qc.setQueryData(["one-on-ones", id], m)} onMoved={onMoved} />;
}

function MeetingView({ m, onChange, onMoved }: { m: Meeting; onChange: (m: Meeting) => void; onMoved: (next: string | null) => void }) {
  const qc = useQueryClient();
  const [shared, setShared] = useState(m.sharedNotes);
  const [mine, setMine] = useState(m.myNotes);
  const [newAgenda, setNewAgenda] = useState("");
  const [newAction, setNewAction] = useState("");
  const [saving, setSaving] = useState(false);
  const live = m.status !== "cancelled";
  const patch = useMutation({
    mutationFn: (b: Record<string, unknown>) => api.patch<Meeting>(`/ess/one-on-ones/${m.id}`, b),
    onMutate: () => setSaving(true),
    onSettled: () => setSaving(false),
    onSuccess: (r) => (onChange(r), qc.invalidateQueries({ queryKey: ["one-on-ones"], exact: true })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  useAutosave(shared, m.sharedNotes, (v) => patch.mutate({ sharedNotes: v }));
  useAutosave(mine, m.myNotes, (v) => patch.mutate({ myNotes: v }));
  const done = useMutation({
    mutationFn: () => api.post<{ nextId: string | null }>(`/ess/one-on-ones/${m.id}/complete`),
    onSuccess: (r) => (toast.success(r.nextId ? "Done. The next one is booked, with anything left over." : "Done"), qc.invalidateQueries({ queryKey: ["one-on-ones"] }), onMoved(r.nextId ?? m.id)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/ess/one-on-ones/${m.id}/cancel`),
    onSuccess: () => (toast.success("Cancelled"), qc.invalidateQueries({ queryKey: ["one-on-ones"] })),
  });
  const setAgenda = (agenda: AgendaItem[]) => patch.mutate({ agenda });
  const setActions = (actions: ActionItem[]) => patch.mutate({ actions });
  const other = m.role === "manager" ? "employee" : "manager";
  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-1">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[20px] font-medium">1:1 with {m.with.name}</div>
            <div className="text-muted text-[13px]">{when(m.scheduledFor)} · {ONE_ON_ONE_REPEAT_LABEL[m.repeat]}{saving ? " · saving…" : ""}</div>
          </div>
          {m.status === "scheduled" ? (
            <div className="flex gap-2">
              <Button variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel</Button>
              <Button variant="primary" loading={done.isPending} onClick={() => done.mutate()}>Mark as done</Button>
            </div>
          ) : <Tag tone={m.status === "done" ? "ok" : "outline"}>{m.status === "done" ? "Done" : "Cancelled"}</Tag>}
        </div>
      </Card>
      <Card className="gap-2">
        <div className="text-[15px] font-medium">Agenda</div>
        {m.agenda.length ? m.agenda.map((a) => (
          <div key={a.id} className="flex items-center gap-2">
            <Checkbox checked={a.done} disabled={!live} onChange={(v) => setAgenda(m.agenda.map((x) => (x.id === a.id ? { ...x, done: v } : x)))} label={<span style={{ textDecoration: a.done ? "line-through" : undefined }}>{a.text}</span>} />
            <span className="text-muted text-[12px]">{a.by === m.role ? "you" : m.with.name.split(" ")[0]}</span>
            <div className="flex-1" />
            {live && a.by === m.role ? <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => setAgenda(m.agenda.filter((x) => x.id !== a.id))}><Trash2 size={13} /></Button> : null}
          </div>
        )) : <div className="text-muted text-[13px]">Nothing yet. Add what you'd like to talk about.</div>}
        {live ? (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newAgenda.trim().length < 2) return; setAgenda([...m.agenda, { id: uid(), text: newAgenda.trim(), by: m.role, done: false }]); setNewAgenda(""); }}>
            <Input value={newAgenda} onChange={(e) => setNewAgenda(e.target.value)} maxLength={500} placeholder="Add a topic" aria-label="Add a topic" />
            <Button type="submit"><Plus size={15} /> Add</Button>
          </form>
        ) : null}
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="gap-2">
          <div className="text-[15px] font-medium">Shared notes</div>
          <div className="text-muted -mt-1 text-[12.5px]">You and {m.with.name.split(" ")[0]} both see these.</div>
          <Textarea value={shared} onChange={(e) => setShared(e.target.value)} disabled={!live} maxLength={20000} className="!min-h-[160px]" placeholder="What you talked about and agreed" />
        </Card>
        <Card className="gap-2">
          <div className="inline-flex items-center gap-1.5 text-[15px] font-medium"><Lock size={14} /> My private notes</div>
          <div className="text-muted -mt-1 text-[12.5px]">Only you see these.</div>
          <Textarea value={mine} onChange={(e) => setMine(e.target.value)} maxLength={20000} className="!min-h-[160px]" placeholder="Things to remember for next time" />
        </Card>
      </div>
      <Card className="gap-2">
        <div className="text-[15px] font-medium">Follow ups</div>
        {m.actions.length ? m.actions.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2">
            <Checkbox checked={a.done} disabled={!live} onChange={(v) => setActions(m.actions.map((x) => (x.id === a.id ? { ...x, done: v } : x)))} label={<span style={{ textDecoration: a.done ? "line-through" : undefined }}>{a.text}</span>} />
            <Tag tone="neutral">{a.owner === m.role ? "You" : m.with.name.split(" ")[0]}</Tag>
            {a.due ? <span className="text-muted text-[12px]">by {new Date(a.due).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span> : null}
            <div className="flex-1" />
            {live ? <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => setActions(m.actions.filter((x) => x.id !== a.id))}><Trash2 size={13} /></Button> : null}
          </div>
        )) : <div className="text-muted text-[13px]">No follow ups. Anything not done moves to the next 1:1.</div>}
        {live ? <AddAction role={m.role} otherName={m.with.name.split(" ")[0]!} other={other} value={newAction} setValue={setNewAction} onAdd={(a) => setActions([...m.actions, a])} /> : null}
      </Card>
    </div>
  );
}

function AddAction({ role, other, otherName, value, setValue, onAdd }: { role: "manager" | "employee"; other: "manager" | "employee"; otherName: string; value: string; setValue: (v: string) => void; onAdd: (a: ActionItem) => void }) {
  const [owner, setOwner] = useState<"manager" | "employee">(role);
  const [due, setDue] = useState("");
  return (
    <form className="grid gap-2 sm:grid-cols-[1fr_130px_150px_auto]" onSubmit={(e) => { e.preventDefault(); if (value.trim().length < 2) return; onAdd({ id: uid(), text: value.trim(), owner, due: due || null, done: false }); setValue(""); setDue(""); }}>
      <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={500} placeholder="Add a follow up" aria-label="Add a follow up" />
      <Select value={owner} onChange={(e) => setOwner(e.target.value as "manager" | "employee")} aria-label="Who"><option value={role}>Me</option><option value={other}>{otherName}</option></Select>
      <Input type="date" min={todayLocal()} value={due} onChange={(e) => setDue(e.target.value)} aria-label="By when" />
      <Button type="submit"><Plus size={15} /> Add</Button>
    </form>
  );
}

function BookDialog({ people, onClose, onBooked }: { people: List["people"]; onClose: () => void; onBooked: (id: string) => void }) {
  const qc = useQueryClient();
  const tomorrow = new Date(Date.now() + 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const [f, setF] = useState({ withEmployeeId: people[0]?.id ?? "", date: tomorrow, time: "11:00", repeat: "biweekly" as OneOnOneRepeat, topic: "" });
  const go = useMutation({
    mutationFn: () => api.post<{ id: string }>("/ess/one-on-ones", { withEmployeeId: f.withEmployeeId, scheduledFor: zonedDateTime(f.date, f.time).toISOString(), repeat: f.repeat, agenda: f.topic.trim() ? [f.topic.trim()] : [] }),
    onSuccess: (r) => (toast.success("Booked. We've let them know."), qc.invalidateQueries({ queryKey: ["one-on-ones"] }), onBooked(r.id), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Book a 1:1" description="They get an email and can add to the agenda before you meet." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={go.isPending} disabled={!f.withEmployeeId || !f.date || !f.time} onClick={() => go.mutate()}>Book</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="With"><Select value={f.withEmployeeId} onChange={(e) => setF({ ...f, withEmployeeId: e.target.value })}>{people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.relation === "manager" ? "your manager" : "your report"})</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" min={todayLocal()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Time"><Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
        </div>
        <Field label="Repeats"><Select value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value as OneOnOneRepeat })}>{ONE_ON_ONE_REPEAT.map((r) => <option key={r} value={r}>{ONE_ON_ONE_REPEAT_LABEL[r]}</option>)}</Select></Field>
        <Field label="First topic" hint="Optional."><Input value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} maxLength={500} placeholder="How's the new project going?" /></Field>
      </div>
    </Dialog>
  );
}
