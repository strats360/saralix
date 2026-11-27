import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CircleDot, FileText, X } from "lucide-react";
import { fmtAnswer, fmtDate, STEP_KIND_LABEL, SUBMISSION_STATUS_LABEL, type FormField, type FormStep, type StepKind, type SubmissionStatus } from "@hrms/shared";
import { api, errorMessage, openFile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { Tag, type Tone } from "@/components/ui/tag";

export interface RequestRow {
  id: string;
  code: string;
  formId: string;
  title: string;
  status: SubmissionStatus;
  stepIndex: number;
  steps: number;
  stepKind: StepKind | null;
  employee: { id: string; name: string; code: string } | null;
  approver: { id: string | null; name: string } | null;
  createdAt: string;
  decidedAt: string | null;
}
export interface RequestDetail extends RequestRow {
  fields: FormField[];
  answers: Record<string, string | number | boolean | null>;
  files: Record<string, { name: string; size: number }>;
  history: { step: number; kind: string; byName: string; decision: string; note: string; at: string }[];
  stepList: FormStep[];
  mine?: boolean;
}

export const REQUEST_TONE: Record<SubmissionStatus, Tone> = { pending: "warn", approved: "ok", rejected: "bad", withdrawn: "outline" };
export const RequestStatus = ({ r }: { r: Pick<RequestRow, "status" | "approver"> }) => (
  <span className="inline-flex flex-wrap items-center gap-1.5">
    <Tag tone={REQUEST_TONE[r.status]}>{SUBMISSION_STATUS_LABEL[r.status]}</Tag>
    {r.status === "pending" && r.approver ? <span className="text-muted text-[12px]">on {r.approver.name}</span> : null}
  </span>
);

/** A filled in form: the answers, and where it is in its approval steps. */
export function RequestView({ r, base, decide, onWithdraw }: { r: RequestDetail; base: string; decide?: string; onWithdraw?: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: (decision: "approve" | "reject") => api.post<RequestDetail>(decide!, { decision, note }),
    onSuccess: (_, d) => (toast.success(d === "approve" ? "Approved" : "Rejected"), setNote(""), qc.invalidateQueries({ queryKey: ["forms"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="gap-4">
        <div className="text-muted text-[13px]">{r.employee ? `${r.employee.name} (${r.employee.code}) · ` : ""}sent {fmtDate(r.createdAt.slice(0, 10))}</div>
        <dl className="flex flex-col gap-3">
          {r.fields.map((f) => (
            <div key={f.id}>
              <dt className="text-muted text-[12.5px]">{f.label}</dt>
              <dd className="m-0 whitespace-pre-wrap text-[14.5px]">
                {f.type === "file" ? (
                  r.files[f.id] ? <button type="button" className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[14px] underline" style={{ color: "var(--color-accent)" }} onClick={() => openFile(`${base}/files/${f.id}`).catch((e) => toast.error(errorMessage(e)))}><FileText size={14} /> {r.files[f.id]!.name}</button> : <span className="text-muted">None</span>
                ) : fmtAnswer(f, r.answers[f.id]) || <span className="text-muted">Not given</span>}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
      <div className="flex flex-col gap-3">
        <Card className="gap-3">
          <div className="text-[15px] font-medium">Approvals</div>
          {!r.stepList.length ? <div className="text-muted text-[13px]">No approval needed.</div> : null}
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {r.stepList.map((s, i) => {
              const h = r.history.filter((x) => x.step === i).at(-1);
              const current = r.status === "pending" && r.stepIndex === i;
              const skipped = !h && !current && (i < r.stepIndex || r.status === "approved");
              return (
                <li key={s.id} className="flex gap-2.5">
                  <span className="mt-0.5">{h?.decision === "approve" ? <Check size={16} style={{ color: "var(--ok-fg)" }} /> : h?.decision === "reject" ? <X size={16} style={{ color: "var(--bad)" }} /> : <CircleDot size={16} className={current ? "" : "text-muted"} />}</span>
                  <div className="min-w-0 text-[13.5px]">
                    <div className="font-medium">{current && r.approver ? r.approver.name : h ? h.byName : STEP_KIND_LABEL[s.kind]}</div>
                    <div className="text-muted text-[12px]">{h ? `${h.decision === "approve" ? "Approved" : "Rejected"} ${fmtDate(h.at.slice(0, 10))}` : current ? "Waiting" : skipped ? "Skipped" : r.status === "pending" ? "Later" : "Not needed"}</div>
                    {h?.note ? <div className="mt-1 whitespace-pre-wrap text-[13px]">"{h.note}"</div> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
        {decide && r.status === "pending" ? (
          <Card className="gap-3">
            <Field label="Note" hint="Needed if you reject it. They'll see it."><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="!min-h-[70px]" /></Field>
            <div className="flex gap-2">
              <Button variant="primary" loading={m.isPending && m.variables === "approve"} onClick={() => m.mutate("approve")}>Approve</Button>
              <Button loading={m.isPending && m.variables === "reject"} disabled={note.trim().length < 3} onClick={() => m.mutate("reject")}>Reject</Button>
            </div>
          </Card>
        ) : null}
        {onWithdraw && r.status === "pending" ? <Button className="self-start" onClick={onWithdraw}>Withdraw request</Button> : null}
      </div>
    </div>
  );
}
