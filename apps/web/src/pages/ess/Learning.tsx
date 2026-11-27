import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronLeft, ExternalLink, FileText, GraduationCap } from "lucide-react";
import { ENROLLMENT_STATE_LABEL, fmtDate, type CourseKind, type EnrollmentState, type Lesson } from "@hrms/shared";
import { api, errorMessage, openFile } from "@/lib/api";
import { Body } from "@/components/announcements/Body";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/field";
import { Empty, ErrorState, Loading, Notice } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { STATE_TONE } from "@/pages/admin/learning/Learning";

interface Item { id: string; kind: CourseKind; title: string; description: string; lessons: number; quiz: number; dueOn: string; state: EnrollmentState; lessonsDone: number; score: number | null; completedAt: string | null }
interface Detail {
  id: string;
  kind: CourseKind;
  title: string;
  description: string;
  lessons: Lesson[];
  quiz: { id: string; question: string; options: string[] }[];
  passMark: number;
  acknowledgement: string;
  hasFile: boolean;
  fileName: string | null;
  enrollment: { dueOn: string; state: EnrollmentState; lessonsDone: string[]; attempts: number; score: number | null; completedAt: string | null };
}

export const useMyLearning = () => useQuery({ queryKey: ["learning", "mine"], queryFn: () => api.get<Item[]>("/ess/learning") });

/** Me → Learning: what I've been asked to do, and what I've finished. */
export default function MyLearning() {
  const q = useMyLearning();
  const nav = useNavigate();
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data) return <Loading />;
  const todo = q.data.filter((i) => i.state !== "completed");
  const done = q.data.filter((i) => i.state === "completed");
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[22px] font-semibold">Learning</h1>
        <div className="text-muted text-[13px]">Courses and policies your company has asked you to go through.</div>
      </div>
      {!q.data.length ? <Empty title="Nothing to do" sub="When HR shares a course or a policy with you, it shows up here." /> : null}
      {todo.length ? <div className="card-kicker">To do</div> : null}
      {todo.map((i) => <Row key={i.id} i={i} onOpen={() => nav(`/me/learning/${i.id}`)} />)}
      {done.length ? <div className="card-kicker mt-2">Done</div> : null}
      {done.map((i) => <Row key={i.id} i={i} onOpen={() => nav(`/me/learning/${i.id}`)} />)}
    </div>
  );
}

function Row({ i, onOpen }: { i: Item; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="card flex items-center gap-3 text-left">
      <GraduationCap size={20} className="text-muted shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{i.title}</div>
        <div className="text-muted text-[12px]">
          {i.kind === "policy" ? "Policy to read and confirm" : `${i.lessonsDone} of ${i.lessons} lessons${i.quiz ? ", then a quiz" : ""}`}
          {i.state === "completed" ? ` · finished ${fmtDate(i.completedAt!.slice(0, 10))}` : ` · due ${fmtDate(i.dueOn)}`}
        </div>
      </div>
      <Tag tone={STATE_TONE[i.state]}>{ENROLLMENT_STATE_LABEL[i.state]}</Tag>
    </button>
  );
}

export function CoursePlayer() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["learning", "mine", id], queryFn: () => api.get<Detail>(`/ess/learning/${id}`) });
  const [open, setOpen] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<{ score: number; passed: boolean; wrong: number } | null>(null);
  const [agree, setAgree] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["learning", "mine"] });
  const lesson = useMutation({ mutationFn: (lid: string) => api.post<{ completed: boolean }>(`/ess/learning/${id}/lessons/${lid}`), onSuccess: (r) => (refresh(), r.completed ? toast.success("All done") : undefined), onError: (e) => toast.error(errorMessage(e)) });
  const quiz = useMutation({ mutationFn: () => api.post<{ score: number; passed: boolean; wrong: number }>(`/ess/learning/${id}/quiz`, { answers }), onSuccess: (r) => (setResult(r), refresh()), onError: (e) => toast.error(errorMessage(e)) });
  const ack = useMutation({ mutationFn: () => api.post(`/ess/learning/${id}/acknowledge`), onSuccess: () => (toast.success("Thanks, that's recorded"), refresh()), onError: (e) => toast.error(errorMessage(e)) });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Loading />;
  const c = q.data;
  const e = c.enrollment;
  const done = e.state === "completed";
  const lessonsLeft = c.lessons.filter((l) => !e.lessonsDone.includes(l.id)).length;
  const file = () => openFile(`/ess/learning/${c.id}/file`).catch((err) => toast.error(errorMessage(err)));
  return (
    <div className="flex flex-col gap-4">
      <Link to="/me/learning" className="inline-flex items-center gap-1 self-start text-[13px] no-underline"><ChevronLeft size={15} /> Learning</Link>
      <div>
        <h1 className="text-[22px] font-semibold">{c.title}</h1>
        <div className="text-muted mt-1 flex flex-wrap items-center gap-2 text-[13px]"><Tag tone={STATE_TONE[e.state]}>{ENROLLMENT_STATE_LABEL[e.state]}</Tag>{done ? `Finished ${fmtDate(e.completedAt!.slice(0, 10))}` : `Due ${fmtDate(e.dueOn)}`}{e.score !== null ? ` · best score ${e.score}%` : ""}</div>
        {c.description ? <Body text={c.description} className="mt-2" /> : null}
      </div>
      {c.kind === "policy" ? (
        <Card className="gap-3">
          {c.hasFile ? <Button className="self-start" onClick={file}><FileText size={15} /> Open {c.fileName ?? "the policy"}</Button> : null}
          {c.lessons[0]?.body ? <Body text={c.lessons[0].body} /> : null}
          {done ? <Notice tone="ok">You confirmed this on {fmtDate(e.completedAt!.slice(0, 10))}.</Notice> : (
            <>
              <Checkbox checked={agree} onChange={setAgree} label={c.acknowledgement} />
              <Button variant="primary" className="self-start" disabled={!agree} loading={ack.isPending} onClick={() => ack.mutate()}>Confirm</Button>
            </>
          )}
        </Card>
      ) : (
        <>
          {c.lessons.map((l, i) => {
            const seen = e.lessonsDone.includes(l.id);
            const isOpen = open === l.id || (open === null && !seen && c.lessons.findIndex((x) => !e.lessonsDone.includes(x.id)) === i);
            return (
              <Card key={l.id} className="gap-3">
                <button type="button" className="flex items-center gap-3 text-left" onClick={() => setOpen(isOpen ? "" : l.id)} aria-expanded={isOpen}>
                  <span className={`grid size-7 shrink-0 place-items-center rounded-full text-[13px] ${seen ? "bg-[var(--ok-bg)] text-[var(--ok-fg)]" : "bg-[var(--tint-1)]"}`}>{seen ? <Check size={15} /> : i + 1}</span>
                  <span className="flex-1 font-medium">{l.title}</span>
                </button>
                {isOpen ? (
                  <>
                    {l.body ? <Body text={l.body} /> : null}
                    {l.videoUrl ? <a href={l.videoUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 self-start text-[14px]"><ExternalLink size={14} /> Watch the video</a> : null}
                    {!seen ? <Button className="self-start" loading={lesson.isPending} onClick={() => lesson.mutate(l.id, { onSuccess: () => setOpen(null) })}>Mark as done</Button> : null}
                  </>
                ) : null}
              </Card>
            );
          })}
          {c.quiz.length ? (
            <Card className="gap-4">
              <div>
                <div className="text-[15px] font-medium">Quiz</div>
                <div className="text-muted text-[13px]">{lessonsLeft ? `Finish the ${lessonsLeft === 1 ? "last lesson" : `${lessonsLeft} lessons`} first. ` : ""}You need {c.passMark}% to pass. You can try as many times as you like.</div>
              </div>
              {result ? <Notice tone={result.passed ? "ok" : "warn"}>{result.passed ? `You passed with ${result.score}%.` : `You got ${result.score}%. ${result.wrong} ${result.wrong === 1 ? "answer was" : "answers were"} wrong; have another go.`}</Notice> : null}
              {done && !result ? <Notice tone="ok">You've passed this. You can take the quiz again for practice.</Notice> : null}
              {c.quiz.map((x, i) => (
                <fieldset key={x.id} className="flex flex-col gap-2" disabled={!!lessonsLeft}>
                  <legend className="mb-1 font-medium">{i + 1}. {x.question}</legend>
                  {x.options.map((o, j) => (
                    <label key={j} className="radio"><input type="radio" name={x.id} checked={answers[x.id] === j} onChange={() => (setAnswers({ ...answers, [x.id]: j }), setResult(null))} /><span className="dot" />{o}</label>
                  ))}
                </fieldset>
              ))}
              <Button variant="primary" className="self-start" disabled={!!lessonsLeft || Object.keys(answers).length < c.quiz.length} loading={quiz.isPending} onClick={() => quiz.mutate()}>Submit answers</Button>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
