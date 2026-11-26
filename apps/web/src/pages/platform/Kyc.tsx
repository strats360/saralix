import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { ENTITY_TYPE_LABEL, KYC_DOC_LABEL, KYC_STATUS_LABEL, needsRegNo, type EntityType, type KycDetails, type KycDocKind, type KycStatus } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Field, Segmented, Textarea } from "@/components/ui/field";
import { ErrorState, KV, Loading, Notice, PageHeader } from "@/components/ui/page";
import { Tag, type Tone } from "@/components/ui/tag";

export const KYC_TONE: Record<KycStatus, Tone> = { draft: "neutral", submitted: "accent", needs_info: "warn", approved: "ok", rejected: "bad" };
interface Row { tenantId: string; name: string; code: string; status: KycStatus; createdAt: string; submittedAt: string | null; reviewedAt: string | null; legalName: string | null; entityType: EntityType | null }
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");

/** Companies waiting for KYC, and ones still filling it in. */
export default function KycQueue() {
  const nav = useNavigate();
  const [status, setStatus] = useState<"submitted" | "needs_info" | "draft" | "rejected">("submitted");
  const q = useQuery({ queryKey: ["platform-kyc", status], queryFn: () => api.get<Row[]>(`/platform/kyc?status=${status}`) });
  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "name", header: "Company", accessorKey: "name", cell: ({ row: { original: r } }) => <div><div className="font-medium">{r.legalName ?? r.name}</div><div className="text-muted text-[12px]">{r.code}{r.entityType ? ` · ${ENTITY_TYPE_LABEL[r.entityType]}` : ""}</div></div> },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ getValue }) => <Tag tone={KYC_TONE[getValue<KycStatus>()]}>{KYC_STATUS_LABEL[getValue<KycStatus>()]}</Tag> },
      { id: "submittedAt", header: "Sent", accessorKey: "submittedAt", cell: ({ getValue }) => when(getValue<string | null>()) },
      { id: "createdAt", header: "Signed up", accessorKey: "createdAt", cell: ({ getValue }) => when(getValue<string>()) },
    ],
    [],
  );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Company KYC" sub="Check each new company before it can add employees or run payroll. Aim to decide within one working day." />
      <Segmented value={status} onChange={setStatus} options={[{ value: "submitted", label: "To check" }, { value: "needs_info", label: "Sent back" }, { value: "draft", label: "Not sent yet" }, { value: "rejected", label: "Rejected" }]} />
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <TableCard>
        <DataTable data={q.data ?? []} columns={columns} getRowId={(r) => r.tenantId} loading={q.isFetching} onRowClick={(r) => nav(`/platform/kyc/${r.tenantId}`)} storageKey="platform-kyc" empty={status === "submitted" ? "Nothing to check. All caught up." : "None."} />
      </TableCard>
    </div>
  );
}

interface Detail {
  tenant: { id: string; name: string; code: string; createdAt: string; contactEmail: string | null };
  status: KycStatus;
  details: Partial<KycDetails>;
  documents: { id: string; kind: KycDocKind; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }[];
  required: KycDocKind[];
  gaps: string[];
  submittedAt: string | null;
  reviewNote: string | null;
  history: { at: string; by: string; action: string; note?: string }[];
  admins: { name: string; email: string }[];
}

export function KycReview() {
  const { tenantId } = useParams();
  const q = useQuery({ queryKey: ["platform-kyc", "one", tenantId], queryFn: () => api.get<Detail>(`/platform/kyc/${tenantId}`) });
  const [decide, setDecide] = useState(false);
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data) return <Loading />;
  const k = q.data;
  const d = k.details;
  const open = async (id: string) => {
    const res = await fetch(`/api/platform/kyc/${tenantId}/documents/${id}`, { credentials: "include" });
    if (!res.ok) return toast.error("Couldn't open it");
    window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
  };
  const ACTION: Record<string, string> = { submitted: "Sent", resubmitted: "Sent again", needs_info: "Sent back", approved: "Approved", rejected: "Rejected" };
  return (
    <div className="flex flex-col gap-4">
      <Link to="/platform/kyc" className="inline-flex items-center gap-1 self-start text-[13px] no-underline"><ChevronLeft size={15} /> All companies</Link>
      <PageHeader
        title={d.legalName ?? k.tenant.name}
        sub={<span className="inline-flex flex-wrap items-center gap-2"><Tag tone={KYC_TONE[k.status]}>{KYC_STATUS_LABEL[k.status]}</Tag>{k.tenant.code} · signed up as {k.tenant.name}</span>}
        actions={k.status === "submitted" ? <Button variant="primary" onClick={() => setDecide(true)}>Decide</Button> : k.status !== "approved" ? <Button onClick={() => setDecide(true)}>Approve anyway</Button> : null}
      />
      {k.reviewNote && k.status !== "submitted" ? <Notice tone={k.status === "rejected" ? "bad" : "warn"}>Last note to the company: {k.reviewNote}</Notice> : null}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <Card className="gap-3">
            <CardHeader className="!p-0" title="Business" />
            <div className="grid gap-3 sm:grid-cols-2">
              <KV label="Type">{d.entityType ? ENTITY_TYPE_LABEL[d.entityType] : "—"}</KV>
              <KV label="PAN"><span className="font-mono">{d.pan ?? "—"}</span></KV>
              <KV label="GSTIN">{d.gstin ? <span className="font-mono">{d.gstin}</span> : <span>None. {d.noGstReason}</span>}</KV>
              {d.entityType && needsRegNo(d.entityType) ? <KV label={d.entityType === "llp" ? "LLPIN" : "CIN"}><span className="font-mono">{d.regNo ?? "—"}</span></KV> : null}
              <KV label="Registered address" span>{d.address ? `${d.address}, ${d.state} ${d.pincode}` : "—"}</KV>
              <KV label="Website">{d.website ? <a href={d.website.startsWith("http") ? d.website : `https://${d.website}`} target="_blank" rel="noopener noreferrer">{d.website}</a> : "—"}</KV>
            </div>
          </Card>
          <Card className="gap-3">
            <CardHeader className="!p-0" title="Authorised signatory" />
            <div className="grid gap-3 sm:grid-cols-2">
              <KV label="Name">{d.signatoryName ?? "—"}</KV>
              <KV label="Role">{d.signatoryRole ?? "—"}</KV>
              <KV label="Email">{d.signatoryEmail ?? "—"}</KV>
              <KV label="Mobile">{d.signatoryPhone ?? "—"}</KV>
            </div>
          </Card>
          <Card className="gap-2">
            <CardHeader className="!p-0" title="Documents" sub={k.gaps.length ? `Missing: ${k.gaps.join(", ").toLowerCase()}` : "Everything required is here."} />
            {k.documents.length ? k.documents.map((doc) => (
              <button key={doc.id} type="button" onClick={() => open(doc.id)} className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-3 py-2.5 text-start text-[var(--color-text)] hover:bg-[var(--tint-1)]">
                <div className="min-w-0 flex-1"><div className="text-[14px] font-medium">{KYC_DOC_LABEL[doc.kind]}</div><div className="text-muted truncate text-[12.5px]">{doc.fileName} · {when(doc.uploadedAt)}</div></div>
                <ExternalLink size={15} className="text-muted flex-none" />
              </button>
            )) : <div className="text-muted text-[13px]">No documents yet.</div>}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card className="gap-2">
            <div className="text-[14px] font-medium">Company admins</div>
            {k.admins.map((a) => <div key={a.email} className="text-[13px]">{a.name}<div className="text-muted">{a.email}</div></div>)}
          </Card>
          <Card className="gap-2">
            <div className="text-[14px] font-medium">History</div>
            {k.history.length ? (
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {[...k.history].reverse().map((h, i) => <li key={i} className="text-[13px]"><b className="font-medium">{ACTION[h.action] ?? h.action}</b> by {h.by}<div className="text-muted text-[12px]">{when(h.at)}</div>{h.note ? <div className="mt-1 text-[12.5px]">{h.note}</div> : null}</li>)}
              </ol>
            ) : <div className="text-muted text-[13px]">Not sent yet.</div>}
          </Card>
        </div>
      </div>
      {decide ? <DecideDialog tenantId={k.tenant.id} name={d.legalName ?? k.tenant.name} submitted={k.status === "submitted"} onClose={() => setDecide(false)} /> : null}
    </div>
  );
}

function DecideDialog({ tenantId, name, submitted, onClose }: { tenantId: string; name: string; submitted: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [decision, setDecision] = useState<"approve" | "needs_info" | "reject">("approve");
  const [note, setNote] = useState("");
  const go = useMutation({
    mutationFn: () => api.post(`/platform/kyc/${tenantId}/decision`, { decision, note }),
    onSuccess: () => (toast.success(decision === "approve" ? `${name} is verified` : decision === "needs_info" ? "Sent back to the company" : "Rejected"), qc.invalidateQueries({ queryKey: ["platform-kyc"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Decide on ${name}`} description="The company's admins get an email with your decision and any note." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={go.isPending} disabled={decision !== "approve" && note.trim().length < 10} onClick={() => go.mutate()}>{decision === "approve" ? "Approve" : decision === "needs_info" ? "Send back" : "Reject"}</Button></>}>
      <div className="flex flex-col gap-3">
        {submitted ? <Segmented value={decision} onChange={setDecision} options={[{ value: "approve", label: "Approve" }, { value: "needs_info", label: "Ask for more" }, { value: "reject", label: "Reject" }]} /> : <Notice tone="warn">They haven't sent it yet. Approve only if you've checked them another way.</Notice>}
        {decision !== "approve" ? (
          <Field label="Note to the company" hint="Say exactly what's wrong or missing. They see this in the email and in Saralix.">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder={decision === "needs_info" ? "The address proof is older than three months. Upload a recent electricity bill or bank statement." : "The PAN doesn't match the business name on the incorporation certificate."} />
          </Field>
        ) : <Field label="Note" hint="Optional, kept in the history."><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} className="!min-h-[64px]" /></Field>}
      </div>
    </Dialog>
  );
}
