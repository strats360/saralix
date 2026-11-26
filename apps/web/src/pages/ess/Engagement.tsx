import { useState } from "react";
import { Link, useParams } from "react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronLeft, Lock, PartyPopper, X } from "lucide-react";
import { checkAnswers, fmtDate, SURVEY_KIND_LABEL, type Answer, type CompanyValue, type Question, type SurveyKind } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { Empty, ErrorState, Loading, Notice } from "@/components/ui/page";
import { SearchSelect } from "@/components/ui/search-select";
import { Tag } from "@/components/ui/tag";
import { KudosCard, SurveyResults, type KudosItem, type Results } from "@/components/engagement/shared";

interface MySurvey { id: string; title: string; description: string; kind: SurveyKind; anonymous: boolean; status: "open" | "closed"; closesOn: string | null; questions: number; answered: boolean; resultsShared: boolean }
type Settings = { values: CompanyValue[]; kudosEnabled: boolean };
type Person = { id: string; name: string; code: string; department: string | null; designation: string | null };

const useSettings = () => useQuery({ queryKey: ["engagement-settings", "ess"], queryFn: () => api.get<Settings>("/ess/engagement/settings"), staleTime: 60_000 });

/** Self-service: open surveys, and the kudos wall. */
export default function EssEngagement() {
  const surveys = useQuery({ queryKey: ["surveys", "ess"], queryFn: () => api.get<MySurvey[]>("/ess/engagement/surveys") });
  const settings = useSettings();
  const feed = useInfiniteQuery({
    queryKey: ["kudos", "ess"],
    queryFn: ({ pageParam }) => api.get<{ items: KudosItem[]; next: string | null }>(`/ess/engagement/kudos${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ""}`),
    initialPageParam: "" as string,
    getNextPageParam: (p) => p.next ?? undefined,
  });
  const [give, setGive] = useState(false);
  const todo = (surveys.data ?? []).filter((s) => s.status === "open" && !s.answered);
  const other = (surveys.data ?? []).filter((s) => !(s.status === "open" && !s.answered));
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const values = settings.data?.values ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="!m-0 text-[26px]">Kudos and surveys</h1>
          <div className="text-muted text-[13.5px]">Thank a colleague, and tell the company how things are going.</div>
        </div>
        {settings.data?.kudosEnabled ? <Button variant="primary" onClick={() => setGive(true)}><PartyPopper size={16} /> Give kudos</Button> : null}
      </div>
      {todo.length ? (
        <Card className="gap-2">
          <CardHeader className="!p-0" title={`Waiting for your answer · ${todo.length}`} />
          {todo.map((s) => (
            <Link key={s.id} to={`/me/engagement/surveys/${s.id}`} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2.5 no-underline hover:no-underline" style={{ color: "inherit" }}>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{s.title}</div>
                <div className="text-muted text-[12.5px]">{SURVEY_KIND_LABEL[s.kind]} · {s.questions} question{s.questions === 1 ? "" : "s"}{s.anonymous ? " · anonymous" : ""}{s.closesOn ? ` · closes ${fmtDate(s.closesOn)}` : ""}</div>
              </div>
              <span className="btn btn-primary">Answer</span>
            </Link>
          ))}
        </Card>
      ) : null}
      {surveys.error ? <ErrorState error={surveys.error} retry={() => surveys.refetch()} /> : null}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-3">
          {settings.data && !settings.data.kudosEnabled ? <Notice tone="sel">Kudos isn't switched on for your company.</Notice> : null}
          {feed.error ? <ErrorState error={feed.error} retry={() => feed.refetch()} /> : null}
          {feed.isLoading ? <Loading /> : null}
          {feed.data && !items.length && settings.data?.kudosEnabled ? <Card><Empty title="No kudos yet" sub="Be the first to thank someone for something they did." action={<Button variant="primary" onClick={() => setGive(true)}>Give kudos</Button>} /></Card> : null}
          {items.map((k) => <KudosCard key={k.id} k={k} values={values} />)}
          {feed.hasNextPage ? <Button className="self-center" loading={feed.isFetchingNextPage} onClick={() => feed.fetchNextPage()}>Show older</Button> : null}
        </div>
        <Card className="gap-2">
          <div className="text-[14px] font-medium">Earlier surveys</div>
          {other.length ? other.map((s) => (
            <Link key={s.id} to={`/me/engagement/surveys/${s.id}`} className="flex items-center justify-between gap-2 py-1 text-[13.5px]">
              <span className="truncate">{s.title}</span>
              {s.resultsShared ? <Tag tone="accent">Results</Tag> : <Tag tone="ok"><Check size={12} /> Answered</Tag>}
            </Link>
          )) : <div className="text-muted text-[13px]">Nothing yet.</div>}
        </Card>
      </div>
      {give && settings.data ? <GiveKudos values={values} onClose={() => setGive(false)} /> : null}
    </div>
  );
}

function GiveKudos({ values, onClose }: { values: CompanyValue[]; onClose: () => void }) {
  const qc = useQueryClient();
  const people = useQuery({ queryKey: ["engagement-people"], queryFn: () => api.get<Person[]>("/ess/engagement/people"), staleTime: 60_000 });
  const [to, setTo] = useState<string[]>([]);
  const [value, setValue] = useState(values[0]?.key ?? "");
  const [message, setMessage] = useState("");
  const byId = new Map((people.data ?? []).map((p) => [p.id, p]));
  const send = useMutation({
    mutationFn: () => api.post("/ess/engagement/kudos", { toEmployeeIds: to, value, message }),
    onSuccess: () => (toast.success("Kudos sent"), qc.invalidateQueries({ queryKey: ["kudos"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Give kudos"
      description="Everyone in the company sees it on the kudos wall, and the people you pick get an email."
      width={560}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={send.isPending} disabled={!to.length || !value || message.trim().length < 5} onClick={() => send.mutate()}>Send kudos</Button></>}
    >
      <div className="flex flex-col gap-4">
        <Field label="Who's it for?" hint="Up to 10 people.">
          <SearchSelect
            value=""
            onChange={(id) => id && !to.includes(id) && to.length < 10 && setTo([...to, id])}
            options={(people.data ?? []).filter((p) => !to.includes(p.id)).map((p) => ({ value: p.id, label: p.name, hint: [p.designation, p.department].filter(Boolean).join(", ") }))}
            placeholder={people.isLoading ? "Loading colleagues…" : "Search colleagues"}
            aria-label="Who's it for"
          />
        </Field>
        {to.length ? (
          <div className="-mt-2 flex flex-wrap gap-1.5">
            {to.map((id) => (
              <span key={id} className="tag tag-accent gap-1">{byId.get(id)?.name}<button type="button" className="ms-1 inline-flex cursor-pointer border-0 bg-transparent p-0 text-inherit" aria-label={`Remove ${byId.get(id)?.name}`} onClick={() => setTo(to.filter((x) => x !== id))}><X size={12} /></button></span>
            ))}
          </div>
        ) : null}
        <div>
          <div className="mb-1.5 text-[12px]" style={{ color: "var(--color-muted)" }}>For which value?</div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Value">
            {values.map((v) => (
              <button key={v.key} type="button" role="radio" aria-checked={value === v.key} onClick={() => setValue(v.key)} className="cursor-pointer rounded-full border px-3 py-1.5 text-[13px]" style={{ borderColor: value === v.key ? "var(--color-accent)" : "var(--color-control-border)", background: value === v.key ? "var(--color-accent-tint)" : "transparent", color: value === v.key ? "var(--color-accent)" : "var(--color-text)" }}>
                {v.emoji} {v.label}
              </button>
            ))}
          </div>
        </div>
        <Field label="What did they do?" hint={`${message.length} of 500`}>
          <Textarea value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} placeholder="Thanks for staying late to get the client demo ready. It went really well." />
        </Field>
      </div>
    </Dialog>
  );
}

interface SurveyDetail { id: string; title: string; description: string; kind: SurveyKind; anonymous: boolean; status: "open" | "closed"; closesOn: string | null; questions: Question[]; answered: boolean; resultsShared: boolean }

export function EssSurvey() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["surveys", "ess", id], queryFn: () => api.get<SurveyDetail>(`/ess/engagement/surveys/${id}`) });
  const results = useQuery({ queryKey: ["surveys", "ess", id, "results"], queryFn: () => api.get<Results>(`/ess/engagement/surveys/${id}/results`), enabled: !!q.data?.resultsShared });
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [err, setErr] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => api.post(`/ess/engagement/surveys/${id}/respond`, { answers }),
    onSuccess: () => (toast.success("Thanks for answering"), qc.invalidateQueries({ queryKey: ["surveys"] })),
    onError: (e) => setErr(errorMessage(e)),
  });
  const s = q.data;
  const submit = () => {
    if (!s) return;
    const c = checkAnswers(s.questions, answers);
    if (!c.ok) return setErr(c.error);
    setErr(null);
    send.mutate();
  };
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      <Link to="/me/engagement" className="inline-flex items-center gap-1 self-start text-[13px] no-underline"><ChevronLeft size={15} /> Kudos and surveys</Link>
      {q.error ? <ErrorState error={q.error} /> : null}
      {!s ? (q.isLoading ? <Loading /> : null) : (
        <>
          <div>
            <div className="card-kicker">{SURVEY_KIND_LABEL[s.kind]}{s.closesOn && s.status === "open" ? ` · closes ${fmtDate(s.closesOn)}` : ""}</div>
            <h1 className="!m-0 mt-1 text-[26px]">{s.title}</h1>
            {s.description ? <p className="text-muted mt-1 whitespace-pre-wrap text-[14px]">{s.description}</p> : null}
            {s.anonymous ? <div className="mt-2 inline-flex items-center gap-1.5 text-[13px]" style={{ color: "var(--color-accent)" }}><Lock size={14} /> Anonymous: nobody, including HR, can see who said what.</div> : null}
          </div>
          {s.resultsShared ? (results.data ? <SurveyResults r={results.data} anonymous={s.anonymous} /> : <Loading />) : s.answered || send.isSuccess ? (
            <Card className="items-center gap-2 py-8 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full" style={{ background: "var(--color-accent-tint)", color: "var(--color-accent)" }}><Check size={22} /></span>
              <div className="text-[17px] font-medium">Thanks, you've answered this one</div>
              <div className="text-muted text-[13.5px]">{s.anonymous ? "Your answers are anonymous." : "HR will read every answer."}</div>
            </Card>
          ) : s.status !== "open" ? (
            <Notice tone="sel">This survey has closed.</Notice>
          ) : (
            <>
              {s.questions.map((x, i) => <QuestionInput key={x.id} n={i + 1} q={x} value={answers[x.id]} onChange={(v) => setAnswers({ ...answers, [x.id]: v })} />)}
              {err ? <Notice tone="bad">{err}</Notice> : null}
              <div className="flex justify-end"><Button variant="primary" loading={send.isPending} onClick={submit}>Send my answers</Button></div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Scale({ from, to, value, onChange, low, high }: { from: number; to: number; value: Answer | undefined; onChange: (v: number) => void; low: string; high: string }) {
  const nums = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5" role="radiogroup">
        {nums.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} onClick={() => onChange(n)} className="num grid h-10 min-w-10 flex-1 cursor-pointer place-items-center rounded-[var(--radius-md)] border text-[14px] font-medium" style={{ borderColor: value === n ? "var(--color-accent)" : "var(--color-control-border)", background: value === n ? "var(--color-accent-tint)" : "var(--color-surface)", color: value === n ? "var(--color-accent)" : "var(--color-text)" }}>
            {n}
          </button>
        ))}
      </div>
      <div className="text-muted flex justify-between text-[12px]"><span>{low}</span><span>{high}</span></div>
    </div>
  );
}

function QuestionInput({ q, n, value, onChange }: { q: Question; n: number; value: Answer | undefined; onChange: (v: Answer) => void }) {
  return (
    <Card className="gap-3">
      <div>
        <div className="card-kicker">Question {n}{q.required ? "" : " · optional"}</div>
        <div className="text-[15px] font-medium">{q.text}</div>
      </div>
      {q.type === "scale" ? <Scale from={1} to={5} value={value} onChange={onChange} low="Strongly disagree" high="Strongly agree" /> : null}
      {q.type === "enps" ? <Scale from={0} to={10} value={value} onChange={onChange} low="Not at all likely" high="Extremely likely" /> : null}
      {q.type === "choice" ? (
        <div className="flex flex-col gap-2" role="radiogroup">
          {q.options.map((o) => <label key={o} className="radio"><input type="radio" name={q.id} checked={value === o} onChange={() => onChange(o)} /><span className="dot" />{o}</label>)}
        </div>
      ) : null}
      {q.type === "multi" ? (
        <div className="flex flex-col gap-2">
          {q.options.map((o) => {
            const list = Array.isArray(value) ? value : [];
            return <label key={o} className="check"><input type="checkbox" checked={list.includes(o)} onChange={(e) => onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} /><span className="box" />{o}</label>;
          })}
        </div>
      ) : null}
      {q.type === "text" ? <Textarea value={typeof value === "string" ? value : ""} maxLength={4000} onChange={(e) => onChange(e.target.value)} placeholder="Write as much or as little as you like" /> : null}
    </Card>
  );
}
