import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Plane } from "lucide-react";
import { fmtDate, fmtMoney, todayLocal, TRAVEL_MODE_LABEL, TRAVEL_MODES, TRAVEL_STATUS_LABEL, type TravelMode, type TravelStatus } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, TableCard } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { Empty, ErrorState } from "@/components/ui/page";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { Tag, type Tone } from "@/components/ui/tag";

export interface Trip {
  id: string;
  code: string;
  purpose: string;
  fromCity: string;
  toCity: string;
  startDate: string;
  endDate: string;
  mode: TravelMode;
  estimatedCost: number;
  advanceAmount: number;
  notes: string;
  status: TravelStatus;
  advancePaidOn: string | null;
  advanceReference: string | null;
  rejectionReason: string | null;
  employee: { id: string; name: string; code: string } | null;
  claims: { claimed: number; open: number; count: number };
  settlement: { advance: number; claimed: number; net: number };
  canDecide?: boolean;
  canFinance?: boolean;
}
export const TRIP_TONE: Record<TravelStatus, Tone> = { pending_manager: "warn", pending_finance: "warn", approved: "ok", rejected: "bad", cancelled: "outline", settled: "neutral" };
export const useMyTrips = (enabled = true) => useQuery({ queryKey: ["travel", "mine"], queryFn: () => api.get<Trip[]>("/ess/travel"), enabled });
const route = (t: Trip) => `${t.fromCity} → ${t.toCity}`;
const dates = (t: Trip) => (t.startDate === t.endDate ? fmtDate(t.startDate) : `${fmtDate(t.startDate)} to ${fmtDate(t.endDate)}`);

/** Self-service: my trips, under my claims. */
export function MyTrips() {
  const qc = useQueryClient();
  const q = useMyTrips();
  const [asking, setAsking] = useState(false);
  const cancel = useMutation({ mutationFn: (id: string) => api.post(`/ess/travel/${id}/cancel`), onSuccess: () => (toast.success("Cancelled"), qc.invalidateQueries({ queryKey: ["travel"] })), onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Card className="gap-3">
      <CardHeader className="!p-0" title="Trips" sub="Ask before you travel, with an advance if you need one. Then link your claims to the trip." actions={<Button onClick={() => setAsking(true)}><Plane size={15} /> Request a trip</Button>} />
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      {q.data && !q.data.length ? <Empty title="No trips yet" sub="Travelling for work? Ask here first, so the cost is approved before you book." /> : null}
      {q.data?.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{route(t)}</span><Tag tone={TRIP_TONE[t.status]}>{TRAVEL_STATUS_LABEL[t.status]}</Tag></div>
            <div className="text-muted text-[12.5px]">{t.code} · {dates(t)} · {TRAVEL_MODE_LABEL[t.mode]} · {t.purpose}</div>
            {t.status === "rejected" && t.rejectionReason ? <div className="text-[12.5px]" style={{ color: "var(--bad)" }}>{t.rejectionReason}</div> : null}
          </div>
          <div className="text-end text-[12.5px]">
            {t.advanceAmount ? <div>Advance {fmtMoney(t.advanceAmount)}{t.advancePaidOn ? " · paid" : ""}</div> : null}
            {t.claims.count ? <div className="text-muted">{t.claims.count} claim{t.claims.count === 1 ? "" : "s"} · {fmtMoney(t.claims.claimed)} approved</div> : null}
          </div>
          {t.status === "pending_manager" || t.status === "pending_finance" || (t.status === "approved" && !t.advancePaidOn && !t.claims.count) ? <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables === t.id} onClick={() => cancel.mutate(t.id)}>Cancel</Button> : null}
        </div>
      ))}
      {asking ? <TripDialog onClose={() => setAsking(false)} /> : null}
    </Card>
  );
}

function TripDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ purpose: "", fromCity: "", toCity: "", startDate: todayLocal(), endDate: todayLocal(), mode: "train" as TravelMode, estimatedCost: "", advanceAmount: "", notes: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const go = useMutation({
    mutationFn: () => api.post<{ code: string }>("/ess/travel", { ...f, estimatedCost: Number(f.estimatedCost || 0), advanceAmount: Number(f.advanceAmount || 0) }),
    onSuccess: (r) => (toast.success(`${r.code} sent for approval`), qc.invalidateQueries({ queryKey: ["travel"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ready = f.purpose.trim().length >= 5 && f.fromCity.trim().length >= 2 && f.toCity.trim().length >= 2 && f.endDate >= f.startDate;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Request a trip" description="Your manager approves it. If you ask for an advance, finance approves it too and pays it before you go." width={620} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={go.isPending} disabled={!ready} onClick={() => go.mutate()}>Send for approval</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What's it for?" span><Input value={f.purpose} onChange={set("purpose")} maxLength={300} placeholder="Client workshop at the Mumbai office" /></Field>
        <Field label="From"><Input value={f.fromCity} onChange={set("fromCity")} maxLength={80} placeholder="Ahmedabad" /></Field>
        <Field label="To"><Input value={f.toCity} onChange={set("toCity")} maxLength={80} placeholder="Mumbai" /></Field>
        <Field label="Leaving"><Input type="date" value={f.startDate} onChange={set("startDate")} /></Field>
        <Field label="Back"><Input type="date" min={f.startDate} value={f.endDate} onChange={set("endDate")} /></Field>
        <Field label="Travelling by"><Select value={f.mode} onChange={set("mode")}>{TRAVEL_MODES.map((m) => <option key={m} value={m}>{TRAVEL_MODE_LABEL[m]}</option>)}</Select></Field>
        <Field label="Estimated cost (₹)" hint="Fares, hotel and local travel."><Input inputMode="decimal" value={f.estimatedCost} onChange={(e) => setF({ ...f, estimatedCost: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
        <Field label="Advance you need (₹)" hint="Optional. Taken back from your salary once the trip is settled, and your claims are paid in full." span><Input inputMode="decimal" value={f.advanceAmount} onChange={(e) => setF({ ...f, advanceAmount: e.target.value.replace(/[^\d.]/g, "") })} placeholder="0" /></Field>
        <Field label="Anything else" hint="Optional." span><Textarea value={f.notes} onChange={set("notes")} maxLength={1000} className="!min-h-[64px]" /></Field>
      </div>
    </Dialog>
  );
}

/** Admin → Reimbursements → Travel: approve trips, pay advances, settle. */
export function AdminTravel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["travel", "admin"], queryFn: () => api.get<Trip[]>("/admin/travel") });
  const [rejecting, setRejecting] = useState<Trip | null>(null);
  const [paying, setPaying] = useState<Trip | null>(null);
  const done = (msg: string) => (toast.success(msg), qc.invalidateQueries({ queryKey: ["travel"] }));
  const decide = useMutation({ mutationFn: (v: { id: string; decision: "approve" | "reject"; reason?: string }) => api.post(`/admin/travel/${v.id}/decision`, v), onSuccess: (_r, v) => done(v.decision === "approve" ? "Approved" : "Rejected"), onError: (e) => toast.error(errorMessage(e)) });
  const settle = useMutation({ mutationFn: (id: string) => api.post<{ settlement: Trip["settlement"] }>(`/admin/travel/${id}/settle`), onSuccess: (r) => done(r.settlement.advance ? `Settled. The ${fmtMoney(r.settlement.advance)} advance is taken back in the next payroll.` : "Settled"), onError: (e) => toast.error(errorMessage(e)) });
  const columns = useMemo<ColumnDef<Trip>[]>(
    () => [
      { id: "who", header: "Employee", cell: ({ row: { original: t } }) => <div><div className="font-medium">{t.employee?.name}</div><div className="text-muted text-[12px]">{t.code}</div></div> },
      { id: "trip", header: "Trip", cell: ({ row: { original: t } }) => <div className="max-w-[340px] whitespace-normal"><div>{route(t)} · {TRAVEL_MODE_LABEL[t.mode]}</div><div className="text-muted text-[12px]">{dates(t)} · {t.purpose}</div></div> },
      { id: "money", header: "Cost", cell: ({ row: { original: t } }) => <div className="text-[12.5px]"><div>Est. {fmtMoney(t.estimatedCost)}</div>{t.advanceAmount ? <div className="text-muted">Advance {fmtMoney(t.advanceAmount)}{t.advancePaidOn ? ` paid ${fmtDate(t.advancePaidOn)}` : ""}</div> : null}{t.claims.count ? <div className="text-muted">Claimed {fmtMoney(t.claims.claimed)}{t.claims.open ? ` · ${t.claims.open} waiting` : ""}</div> : null}</div> },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row: { original: t } }) => <Tag tone={TRIP_TONE[t.status]}>{TRAVEL_STATUS_LABEL[t.status]}</Tag> },
      {
        id: "act",
        header: "",
        cell: ({ row: { original: t } }) => {
          const items = [
            ...(t.canDecide ? [{ label: "Approve", onSelect: () => decide.mutate({ id: t.id, decision: "approve" }) }, { label: "Reject", onSelect: () => setRejecting(t), danger: true }] : []),
            ...(t.canFinance && t.status === "approved" && t.advanceAmount && !t.advancePaidOn ? [{ label: "Mark advance paid", onSelect: () => setPaying(t) }] : []),
            ...(t.canFinance && t.status === "approved" && t.endDate <= todayLocal() ? [{ label: "Settle the trip", onSelect: () => settle.mutate(t.id) }] : []),
          ];
          return items.length ? <div className="flex justify-end"><Menu trigger={<Button size="sm">Manage</Button>} items={items} /></div> : null;
        },
      },
    ],
    [decide, settle],
  );
  return (
    <>
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      <TableCard>
        <CardHeader className="py-2" title="Trips" sub="The manager approves first; finance approves trips with an advance, pays it, and settles once the claims are in. The advance is then taken back in the next payroll." />
        <DataTable data={q.data ?? []} columns={columns} getRowId={(r) => r.id} loading={q.isFetching} storageKey="travel" empty="No trips yet. Employees request them from self-service, under Claims." />
      </TableCard>
      {rejecting ? <ReasonDialog open onOpenChange={(v) => !v && setRejecting(null)} title={`Reject ${rejecting.code}?`} confirmLabel="Reject" onConfirm={(reason) => (decide.mutate({ id: rejecting.id, decision: "reject", reason }), setRejecting(null))} /> : null}
      {paying ? <PayDialog t={paying} onClose={() => setPaying(null)} /> : null}
    </>
  );
}

function PayDialog({ t, onClose }: { t: Trip; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ paidOn: todayLocal(), reference: "" });
  const go = useMutation({ mutationFn: () => api.post(`/admin/travel/${t.id}/advance-paid`, f), onSuccess: () => (toast.success("Advance marked paid"), qc.invalidateQueries({ queryKey: ["travel"] }), onClose()), onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Pay the ${fmtMoney(t.advanceAmount)} advance`} description={`${t.employee?.name}, ${t.code}. Pay it from your bank, then record it here.`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={go.isPending} onClick={() => go.mutate()}>Mark paid</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Paid on"><Input type="date" max={todayLocal()} value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
        <Field label="Reference" hint="Optional, like the UTR."><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} maxLength={80} /></Field>
      </div>
    </Dialog>
  );
}

