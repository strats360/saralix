import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, FileText, Trash2, Upload } from "lucide-react";
import { ENTITY_TYPE_LABEL, ENTITY_TYPES, INDIAN_STATES, KYC_DOC_HINT, KYC_DOC_LABEL, needsRegNo, requiredDocs, type EntityType, type KycDetails, type KycDocKind, type KycStatus } from "@hrms/shared";
import { api, errorMessage, getActiveTenant } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, Loading, Notice, PageHeader } from "@/components/ui/page";
import { KycStatusCard } from "@/components/kyc/KycStatus";

interface Doc { id: string; kind: KycDocKind; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }
interface Kyc { status: KycStatus; details: Partial<KycDetails>; documents: Doc[]; required: KycDocKind[]; gaps: string[]; submittedAt: string | null; reviewNote: string | null }
type Form = Record<keyof KycDetails, string>;

const EMPTY: Form = { entityType: "private_limited", legalName: "", pan: "", gstin: "", noGstReason: "", regNo: "", address: "", state: "Gujarat", pincode: "", website: "", signatoryName: "", signatoryRole: "", signatoryEmail: "", signatoryPhone: "" };
const toForm = (d: Partial<KycDetails>): Form => Object.fromEntries(Object.keys(EMPTY).map((k) => [k, (d as Record<string, unknown>)[k] == null ? EMPTY[k as keyof Form] : String((d as Record<string, unknown>)[k])])) as Form;
const toBody = (f: Form) => ({ ...f, gstin: f.gstin.trim() || null, noGstReason: f.gstin.trim() ? null : f.noGstReason.trim() || null, regNo: needsRegNo(f.entityType as EntityType) ? f.regNo.trim() || null : null, website: f.website.trim() || null });
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The company's KYC: business details, documents, and sending it for checking. */
export default function KycPage() {
  const q = useQuery({ queryKey: ["kyc"], queryFn: () => api.get<Kyc>("/admin/kyc") });
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data) return <Loading />;
  return <KycForm k={q.data} />;
}

function KycForm({ k }: { k: Kyc }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(() => toForm(k.details));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editable = k.status === "draft" || k.status === "needs_info";
  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [key]: key === "pan" || key === "gstin" || key === "regNo" ? e.target.value.toUpperCase() : e.target.value }));
  const save = useMutation({
    mutationFn: () => api.put<{ valid: boolean; errors: Record<string, string> }>("/admin/kyc", toBody(f)),
    onSuccess: (r) => (setErrors(r.errors), qc.invalidateQueries({ queryKey: ["kyc"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = useMutation({
    mutationFn: async () => {
      const r = await api.put<{ valid: boolean; errors: Record<string, string> }>("/admin/kyc", toBody(f));
      setErrors(r.errors);
      if (!r.valid) throw new Error("Fix the highlighted details first");
      return api.post("/admin/kyc/submit");
    },
    onSuccess: () => (toast.success("Sent. We'll email you within one working day."), qc.invalidateQueries({ queryKey: ["kyc"] }), qc.invalidateQueries({ queryKey: ["me"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  // save the draft quietly as people type, so nothing is lost
  const first = useRef(true);
  useEffect(() => {
    if (first.current || !editable) return void (first.current = false);
    const t = setTimeout(() => save.mutate(), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);
  const type = f.entityType as EntityType;
  const required = requiredDocs(type, !!f.gstin.trim());
  const optional: KycDocKind[] = (["authorisation", "other"] as KycDocKind[]).filter((d) => !required.includes(d));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Company KYC" sub="We verify every company before it can pay salaries through Saralix. It keeps your employees' data and money safe." />
      {k.status !== "draft" ? <KycStatusCard status={k.status} note={k.reviewNote} compact /> : null}
      <fieldset disabled={!editable} className="m-0 flex flex-col gap-4 border-0 p-0">
        <Card className="gap-4">
          <CardHeader className="!p-0" title="Business details" sub="As on your PAN and registration certificate." />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type of business" span>
              <Select value={f.entityType} onChange={set("entityType")}>{ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_TYPE_LABEL[t]}</option>)}</Select>
            </Field>
            <Field label="Legal name" error={errors.legalName} span><Input value={f.legalName} onChange={set("legalName")} maxLength={200} invalid={!!errors.legalName} autoComplete="organization" /></Field>
            <Field label="PAN" error={errors.pan} hint="Of the business. For a proprietorship, the owner's PAN."><Input value={f.pan} onChange={set("pan")} maxLength={10} invalid={!!errors.pan} placeholder="AAKCS1234M" className="font-mono" /></Field>
            {needsRegNo(type) ? (
              <Field label={type === "llp" ? "LLPIN" : "CIN"} error={errors.regNo}><Input value={f.regNo} onChange={set("regNo")} maxLength={25} invalid={!!errors.regNo} placeholder={type === "llp" ? "AAB-1234" : "U72900GJ2019PTC123456"} className="font-mono" /></Field>
            ) : <div className="hidden sm:block" />}
            <Field label="GSTIN" error={errors.gstin} hint="Leave blank if you're not registered for GST."><Input value={f.gstin} onChange={set("gstin")} maxLength={15} invalid={!!errors.gstin} placeholder="24AAKCS1234M1Z5" className="font-mono" /></Field>
            {!f.gstin.trim() ? <Field label="Why no GSTIN?" error={errors.noGstReason}><Input value={f.noGstReason} onChange={set("noGstReason")} maxLength={300} invalid={!!errors.noGstReason} placeholder="Turnover below the GST limit" /></Field> : <div className="hidden sm:block" />}
            <Field label="Registered address" error={errors.address} span><Textarea value={f.address} onChange={set("address")} maxLength={500} className="!min-h-[64px]" /></Field>
            <Field label="State" error={errors.state}><Select value={f.state} onChange={set("state")}>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <Field label="PIN code" error={errors.pincode}><Input value={f.pincode} onChange={set("pincode")} inputMode="numeric" maxLength={6} invalid={!!errors.pincode} /></Field>
            <Field label="Website" hint="Optional."><Input value={f.website} onChange={set("website")} maxLength={200} placeholder="https://" /></Field>
          </div>
        </Card>
        <Card className="gap-4">
          <CardHeader className="!p-0" title="Authorised signatory" sub="The director, partner or owner who can sign for the business. We may call to confirm." />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" error={errors.signatoryName}><Input value={f.signatoryName} onChange={set("signatoryName")} maxLength={120} invalid={!!errors.signatoryName} /></Field>
            <Field label="Role" error={errors.signatoryRole}><Input value={f.signatoryRole} onChange={set("signatoryRole")} maxLength={80} invalid={!!errors.signatoryRole} placeholder="Director" /></Field>
            <Field label="Email" error={errors.signatoryEmail}><Input type="email" value={f.signatoryEmail} onChange={set("signatoryEmail")} invalid={!!errors.signatoryEmail} /></Field>
            <Field label="Mobile" error={errors.signatoryPhone}><Input type="tel" value={f.signatoryPhone} onChange={set("signatoryPhone")} invalid={!!errors.signatoryPhone} placeholder="98765 43210" /></Field>
          </div>
        </Card>
      </fieldset>
      <Card className="gap-3">
        <CardHeader className="!p-0" title="Documents" sub="PDF, JPG or PNG, up to 10 MB each. Clear scans or photos of the originals." />
        {required.map((d) => <DocRow key={d} kind={d} docs={k.documents.filter((x) => x.kind === d)} required editable={editable} />)}
        {optional.map((d) => <DocRow key={d} kind={d} docs={k.documents.filter((x) => x.kind === d)} editable={editable} />)}
      </Card>
      {editable ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-muted flex-1 text-[13px]">{save.isPending ? "Saving…" : k.gaps.length ? `Still to do: ${k.gaps.join(", ").toLowerCase()}.` : "Everything's here. Send it when you're ready."}</div>
          <Button variant="primary" loading={submit.isPending} onClick={() => submit.mutate()}>{k.status === "needs_info" ? "Send again" : "Send for checking"}</Button>
        </div>
      ) : null}
    </div>
  );
}

function DocRow({ kind, docs, required, editable }: { kind: KycDocKind; docs: Doc[]; required?: boolean; editable: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const up = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", file);
      return api.post("/admin/kyc/documents", fd);
    },
    onSuccess: () => (toast.success("Uploaded"), qc.invalidateQueries({ queryKey: ["kyc"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/admin/kyc/documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kyc"] }),
  });
  const done = docs.length > 0;
  const open = async (d: Doc) => {
    const res = await fetch(`/api/admin/kyc/documents/${d.id}`, { credentials: "include", headers: { "X-Tenant-Id": getActiveTenant() ?? "" } });
    if (!res.ok) return toast.error("Couldn't open it");
    window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
  };
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-3 sm:flex-row sm:items-center">
      <span className="grid h-8 w-8 flex-none place-items-center rounded-full" style={{ background: done ? "var(--color-accent-tint)" : "var(--tint-2)", color: done ? "var(--color-accent)" : "var(--color-muted)" }} aria-hidden>{done ? <Check size={16} /> : <FileText size={15} />}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{KYC_DOC_LABEL[kind]}{required ? "" : <span className="text-muted font-normal"> · optional</span>}</div>
        <div className="text-muted text-[12.5px]">{KYC_DOC_HINT[kind]}</div>
        {docs.map((d) => (
          <div key={d.id} className="mt-1 flex items-center gap-2 text-[12.5px]">
            <button type="button" className="cursor-pointer truncate border-0 bg-transparent p-0 text-start text-[var(--color-accent)] hover:underline" onClick={() => open(d)}>{d.fileName}</button>
            <span className="text-muted">{kb(d.sizeBytes)}</span>
            {editable ? <Button variant="ghost" size="sm" aria-label={`Remove ${d.fileName}`} onClick={() => del.mutate(d.id)}><Trash2 size={13} /></Button> : null}
          </div>
        ))}
      </div>
      {editable ? (
        <>
          <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) up.mutate(file); e.target.value = ""; }} />
          <Button size="sm" loading={up.isPending} onClick={() => input.current?.click()}><Upload size={14} /> {done && kind !== "other" ? "Replace" : "Upload"}</Button>
        </>
      ) : null}
    </div>
  );
}
