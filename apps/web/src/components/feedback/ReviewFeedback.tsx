import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { FEEDBACK_MIN, FEEDBACK_RELATION_LABEL, FEEDBACK_RELATIONS, type FeedbackRelation } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Tag } from "@/components/ui/tag";
import { useLookups } from "@/components/recruitment/shared";
import { FeedbackCard, type FeedbackItem } from "@/pages/ess/Feedback";
import { PeoplePicker } from "./PeoplePicker";

/** 360 feedback on a review: who was asked, who answered, and what they said. For the manager and HR. */
export function ReviewFeedback({ reviewId, employeeId, name, open }: { reviewId: string; employeeId: string; name: string; open: boolean }) {
  const q = useQuery({ queryKey: ["review-feedback", reviewId], queryFn: () => api.get<FeedbackItem[]>(`/admin/review-feedback/${reviewId}`) });
  const [asking, setAsking] = useState(false);
  const list = q.data ?? [];
  const done = list.filter((f) => f.status === "submitted");
  const waiting = list.filter((f) => f.status === "requested");
  const avg = done.filter((f) => f.rating).length ? Math.round((done.reduce((s, f) => s + (f.rating ?? 0), 0) / done.filter((f) => f.rating).length) * 10) / 10 : null;
  return (
    <Card className="gap-3">
      <CardHeader className="!p-0" title="360 feedback" sub={`Colleagues' views on ${name}. You and HR see names; ${name.split(" ")[0]} sees the words without names once the review is shared, if at least ${FEEDBACK_MIN} people answered.`} actions={open ? <Button size="sm" onClick={() => setAsking(true)}><Plus size={14} /> Ask colleagues</Button> : null} />
      {list.length ? (
        <div className="text-muted text-[13px]">{done.length} of {list.length} answered{avg ? ` · average ${avg} of 5` : ""}</div>
      ) : <div className="text-muted text-[13px]">Nobody has been asked yet.</div>}
      {waiting.length ? <div className="flex flex-wrap gap-1.5">{waiting.map((f) => <Tag key={f.id} tone="neutral">{f.from?.name} · waiting</Tag>)}</div> : null}
      {done.map((f) => <FeedbackCard key={f.id} f={f} show="from" />)}
      {asking ? <AskDialog reviewId={reviewId} exclude={[employeeId, ...list.map((f) => f.from?.id ?? "")]} onClose={() => setAsking(false)} /> : null}
    </Card>
  );
}

function AskDialog({ reviewId, exclude, onClose }: { reviewId: string; exclude: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const L = useLookups();
  const [from, setFrom] = useState<string[]>([]);
  const [relation, setRelation] = useState<FeedbackRelation>("peer");
  const [prompt, setPrompt] = useState("");
  const go = useMutation({
    mutationFn: () => api.post<{ asked: number }>(`/admin/review-feedback/${reviewId}`, { fromEmployeeIds: from, relation, prompt }),
    onSuccess: (r) => (toast.success(`Asked ${r.asked} ${r.asked === 1 ? "person" : "people"}`), qc.invalidateQueries({ queryKey: ["review-feedback", reviewId] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Ask colleagues for feedback" description="They get an email and answer from self-service, by the manager review due date." width={560} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={go.isPending} disabled={!from.length} onClick={() => go.mutate()}>Ask</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Who to ask" hint="Three to six people who work closely with them gives a fair picture."><PeoplePicker value={from} onChange={setFrom} people={(L.data?.employees ?? []).filter((e) => !exclude.includes(e.id)).map((e) => ({ id: e.id, name: e.name, hint: e.code }))} /></Field>
        <Field label="How they work together"><Select value={relation} onChange={(e) => setRelation(e.target.value as FeedbackRelation)}>{FEEDBACK_RELATIONS.map((r) => <option key={r} value={r}>{FEEDBACK_RELATION_LABEL[r]}</option>)}</Select></Field>
        <Field label="Question" hint="Optional."><Input value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={500} placeholder="How has it been working with them this year?" /></Field>
      </div>
    </Dialog>
  );
}
