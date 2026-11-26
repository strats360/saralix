import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, MessageSquarePlus, Send } from "lucide-react";
import { fmtDate, FEEDBACK_VISIBILITY, FEEDBACK_VISIBILITY_LABEL, todayLocal, type FeedbackVisibility } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Segmented, Textarea } from "@/components/ui/field";
import { Empty, ErrorState, Loading } from "@/components/ui/page";
import { SearchSelect } from "@/components/ui/search-select";
import { PillTabs, RouteTabs } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { PeoplePicker } from "@/components/feedback/PeoplePicker";
import { ESS_PERFORMANCE_TABS } from "./Okrs";

export interface FeedbackItem {
  id: string;
  kind: "review" | "request" | "given";
  about: { id: string; name: string };
  from: { id: string; name: string } | null;
  relation: string | null;
  prompt: string;
  status: "requested" | "submitted" | "declined";
  visibility: FeedbackVisibility;
  strengths: string | null;
  improvements: string | null;
  rating: number | null;
  dueOn: string | null;
  submittedAt: string | null;
  createdAt: string;
  requestedByName: string | null;
}
interface Mine { toAnswer: FeedbackItem[]; received: FeedbackItem[]; asked: FeedbackItem[]; given: FeedbackItem[]; team: FeedbackItem[]; minimum: number }
type Person = { id: string; name: string; code: string };
const usePeople = () => useQuery({ queryKey: ["feedback-people"], queryFn: () => api.get<Person[]>("/ess/feedback/people"), staleTime: 60_000 });
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

/** One piece of feedback as it reads to whoever is allowed to see it. */
export function FeedbackCard({ f, show }: { f: FeedbackItem; show: "from" | "about" | "both" }) {
  const who = f.kind === "review" && !f.from ? "A colleague (360 feedback)" : f.from?.name ?? "";
  return (
    <Card className="gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <b className="font-medium">{show === "about" ? `About ${f.about.name}` : show === "both" ? `${who} about ${f.about.name}` : who}</b>
        {f.kind === "review" ? <Tag tone="accent">360</Tag> : f.kind === "request" ? <Tag tone="neutral">Asked for</Tag> : null}
        {f.visibility === "manager" ? <Tag tone="outline"><Lock size={11} /> Manager only</Tag> : null}
        {f.rating ? <span className="text-muted">Rated {f.rating} of 5</span> : null}
        <span className="text-muted ms-auto text-[12px]">{day(f.submittedAt)}</span>
      </div>
      {f.prompt ? <div className="text-muted text-[12.5px] italic">"{f.prompt}"</div> : null}
      <div><div className="card-kicker">Does well</div><p className="m-0 whitespace-pre-wrap text-[14px]">{f.strengths}</p></div>
      {f.improvements ? <div><div className="card-kicker">Could do better</div><p className="m-0 whitespace-pre-wrap text-[14px]">{f.improvements}</p></div> : null}
    </Card>
  );
}

export default function EssFeedback() {
  const q = useQuery({ queryKey: ["feedback", "mine"], queryFn: () => api.get<Mine>("/ess/feedback") });
  const [tab, setTab] = useState<"received" | "given" | "asked" | "team">("received");
  const [give, setGive] = useState(false);
  const [ask, setAsk] = useState(false);
  const [answering, setAnswering] = useState<FeedbackItem | null>(null);
  const d = q.data;
  const lists = { received: d?.received ?? [], given: d?.given ?? [], asked: d?.asked ?? [], team: d?.team ?? [] };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="!mb-1 text-[26px]">Performance</h1>
          <div className="text-muted text-[13.5px]">Tell colleagues what's working, and ask them what you could do better.</div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setAsk(true)}><MessageSquarePlus size={16} /> Ask for feedback</Button>
          <Button variant="primary" onClick={() => setGive(true)}><Send size={15} /> Give feedback</Button>
        </div>
      </div>
      <RouteTabs tabs={ESS_PERFORMANCE_TABS} />
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      {q.isLoading ? <Loading /> : null}
      {d?.toAnswer.length ? (
        <Card className="gap-2">
          <div className="text-[15px] font-medium">Waiting for your feedback · {d.toAnswer.length}</div>
          {d.toAnswer.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{f.about.name}{f.kind === "review" ? <span className="text-muted font-normal"> · for their review</span> : null}</div>
                <div className="text-muted text-[12.5px]">Asked by {f.requestedByName}{f.dueOn ? ` · by ${fmtDate(f.dueOn)}` : ""}{f.kind === "review" ? " · only their manager and HR see your name" : ""}</div>
              </div>
              <Button variant="primary" size="sm" onClick={() => setAnswering(f)}>Answer</Button>
            </div>
          ))}
        </Card>
      ) : null}
      {d ? (
        <>
          <PillTabs value={tab} onChange={setTab} tabs={[{ value: "received", label: `For me (${lists.received.length})` }, { value: "given", label: `I gave (${lists.given.length})` }, { value: "asked", label: `Waiting on others (${lists.asked.length})` }, ...(lists.team.length ? [{ value: "team" as const, label: `My team (${lists.team.length})` }] : [])]} />
          {tab === "asked" ? (
            lists.asked.length ? <Card className="gap-1.5">{lists.asked.map((f) => <div key={f.id} className="flex justify-between gap-3 text-[13.5px]"><span>{f.from?.name}</span><span className="text-muted">{f.status === "declined" ? "Declined" : `Asked ${day(f.createdAt)}`}</span></div>)}</Card> : <Card><Empty title="Nothing waiting" sub="Ask a few colleagues what you could do better. It's the quickest way to grow." /></Card>
          ) : lists[tab].length ? (
            <div className="flex flex-col gap-3">{lists[tab].map((f) => <FeedbackCard key={f.id} f={f} show={tab === "given" ? "about" : tab === "team" ? "both" : "from"} />)}</div>
          ) : (
            <Card><Empty title={tab === "received" ? "No feedback yet" : tab === "given" ? "You haven't given feedback yet" : "Nothing yet"} sub={tab === "received" ? `360 feedback from a review shows here without names once your review is shared and at least ${d.minimum} people have answered.` : undefined} /></Card>
          )}
        </>
      ) : null}
      {give ? <GiveDialog onClose={() => setGive(false)} /> : null}
      {ask ? <AskDialog onClose={() => setAsk(false)} /> : null}
      {answering ? <AnswerDialog f={answering} onClose={() => setAnswering(null)} /> : null}
    </div>
  );
}

function GiveDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const people = usePeople();
  const [f, setF] = useState({ aboutEmployeeId: "", strengths: "", improvements: "", visibility: "private" as FeedbackVisibility });
  const go = useMutation({
    mutationFn: () => api.post("/ess/feedback/give", f),
    onSuccess: () => (toast.success("Feedback sent"), qc.invalidateQueries({ queryKey: ["feedback"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Give feedback" description="Be specific: what they did, and the difference it made." width={600} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={go.isPending} disabled={!f.aboutEmployeeId || f.strengths.trim().length < 10} onClick={() => go.mutate()}>Send</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="About"><SearchSelect value={f.aboutEmployeeId} onChange={(v) => setF({ ...f, aboutEmployeeId: v })} options={(people.data ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.code }))} placeholder="Search colleagues" aria-label="About" /></Field>
        <Field label="What they do well"><Textarea value={f.strengths} onChange={(e) => setF({ ...f, strengths: e.target.value })} maxLength={3000} placeholder="You explained the new tax regime to the whole team in plain words. Everyone got it first time." /></Field>
        <Field label="What they could do better" hint="Optional."><Textarea value={f.improvements} onChange={(e) => setF({ ...f, improvements: e.target.value })} maxLength={3000} className="!min-h-[64px]" /></Field>
        <Field label="Who sees it"><Segmented value={f.visibility} onChange={(v) => setF({ ...f, visibility: v })} options={FEEDBACK_VISIBILITY.map((x) => ({ value: x, label: FEEDBACK_VISIBILITY_LABEL[x] }))} /></Field>
      </div>
    </Dialog>
  );
}

function AskDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const people = usePeople();
  const [from, setFrom] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [dueOn, setDueOn] = useState("");
  const go = useMutation({
    mutationFn: () => api.post<{ asked: number }>("/ess/feedback/ask", { fromEmployeeIds: from, prompt, dueOn: dueOn || null }),
    onSuccess: (r) => (toast.success(r.asked ? `Asked ${r.asked} ${r.asked === 1 ? "person" : "people"}` : "They've already been asked"), qc.invalidateQueries({ queryKey: ["feedback"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Ask for feedback" description="They'll see your name and you'll see theirs." width={560} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={go.isPending} disabled={!from.length} onClick={() => go.mutate()}>Ask</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Who to ask" hint="Up to 10 people."><PeoplePicker value={from} onChange={setFrom} people={(people.data ?? []).map((p) => ({ id: p.id, name: p.name, hint: p.code }))} /></Field>
        <Field label="Anything in particular?" hint="Optional."><Input value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={500} placeholder="How did I do running the client workshop?" /></Field>
        <Field label="By when" hint="Optional."><Input type="date" min={todayLocal()} value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function AnswerDialog({ f, onClose }: { f: FeedbackItem; onClose: () => void }) {
  const qc = useQueryClient();
  const [a, setA] = useState({ strengths: "", improvements: "", rating: 0 });
  const done = () => (qc.invalidateQueries({ queryKey: ["feedback"] }), onClose());
  const go = useMutation({
    mutationFn: () => api.post(`/ess/feedback/${f.id}/answer`, { strengths: a.strengths, improvements: a.improvements, rating: f.kind === "review" ? a.rating : null }),
    onSuccess: () => (toast.success("Thanks, sent"), done()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const decline = useMutation({ mutationFn: () => api.post(`/ess/feedback/${f.id}/decline`), onSuccess: () => (toast.success("Declined"), done()) });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Feedback on ${f.about.name}`}
      description={f.kind === "review" ? "For their performance review. Their manager and HR see your name; they see your words without it." : `${f.about.name} will see your name.`}
      width={600}
      footer={<><Button variant="ghost" loading={decline.isPending} onClick={() => decline.mutate()}>Decline</Button><div className="flex-1" /><Button onClick={onClose}>Later</Button><Button variant="primary" loading={go.isPending} disabled={a.strengths.trim().length < 10 || (f.kind === "review" && !a.rating)} onClick={() => go.mutate()}>Send</Button></>}
    >
      <div className="flex flex-col gap-3">
        {f.prompt ? <div className="rounded-[var(--radius-md)] px-3 py-2 text-[13.5px]" style={{ background: "var(--tint-1)" }}>"{f.prompt}"</div> : null}
        <Field label="What they do well"><Textarea value={a.strengths} onChange={(e) => setA({ ...a, strengths: e.target.value })} maxLength={3000} /></Field>
        <Field label="What they could do better"><Textarea value={a.improvements} onChange={(e) => setA({ ...a, improvements: e.target.value })} maxLength={3000} className="!min-h-[64px]" /></Field>
        {f.kind === "review" ? (
          <Field label="Overall, working with them is">
            <Segmented value={String(a.rating)} onChange={(v) => setA({ ...a, rating: Number(v) })} options={[["1", "Poor"], ["2", "Fair"], ["3", "Good"], ["4", "Very good"], ["5", "Excellent"]].map(([value, label]) => ({ value: value!, label: label! }))} />
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}
