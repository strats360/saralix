import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Building2, ScanFace, Workflow, type LucideIcon } from "lucide-react";
import { fmtMoney } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Segmented, Textarea, Checkbox } from "@/components/ui/field";
import { Tag } from "@/components/ui/tag";

const ICON: Record<string, LucideIcon> = { "addon.ai_assistant": Bot, "addon.work_tools": Building2, "addon.face_kiosk": ScanFace, "addon.workflows": Workflow };
interface Mine { currency: string; seats: number; trial: boolean; addons: { key: string; name: string; description: string; pricing: "per_employee" | "flat"; price: number; on: boolean; since: string | null; monthly: number }[] }
const priceText = (a: { pricing: string; price: number }) => (a.pricing === "flat" ? `${fmtMoney(a.price)} a month` : `${fmtMoney(a.price)} per employee a month`);

/** Settings → Billing: the paid add-ons a company can switch on and off. */
export function AddonsCard() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["billing", "addons"], queryFn: () => api.get<Mine>("/admin/billing/addons") });
  const [confirm, setConfirm] = useState<Mine["addons"][number] | null>(null);
  const toggle = useMutation({
    mutationFn: (v: { key: string; on: boolean }) => api.post(`/admin/billing/addons/${v.key}`, { on: v.on }),
    onSuccess: (_r, v) => (toast.success(v.on ? "Switched on. It's ready to use." : "Switched off"), qc.invalidateQueries({ queryKey: ["billing"] }), qc.invalidateQueries({ queryKey: ["me"] }), setConfirm(null)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const d = q.data;
  if (!d?.addons.length) return null;
  const edit = can("billing", "edit");
  return (
    <Card className="!gap-3" style={{ padding: 18 }}>
      <CardHeader title="Add-ons" sub={`Extra features on top of your plan, billed monthly with your invoice, plus GST. Switch them off any time; you pay for the months they were on.${d.trial ? " Free while you're on trial." : ""}`} />
      <div className="grid gap-3 md:grid-cols-2">
        {d.addons.map((a) => {
          const Icon = ICON[a.key] ?? Bot;
          return (
            <div key={a.key} className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3.5">
              <span className="grid h-10 w-10 flex-none place-items-center rounded-full" style={{ background: "var(--color-accent-tint)", color: "var(--color-accent)" }} aria-hidden><Icon size={19} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="text-[14.5px] font-medium">{a.name}</span>{a.on ? <Tag tone="ok">On</Tag> : null}</div>
                <p className="text-muted m-0 mt-0.5 text-[13px] leading-relaxed">{a.description}</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12.5px]">{priceText(a)}{a.pricing === "per_employee" ? <span className="text-muted"> · about {fmtMoney(a.monthly)} for your {d.seats} employees</span> : null}</span>
                  {edit ? <Button size="sm" variant={a.on ? "secondary" : "primary"} loading={toggle.isPending && toggle.variables?.key === a.key} onClick={() => (a.on ? toggle.mutate({ key: a.key, on: false }) : setConfirm(a))}>{a.on ? "Switch off" : "Switch on"}</Button> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {confirm ? (
        <Dialog open onOpenChange={(v) => !v && setConfirm(null)} title={`Switch on ${confirm.name}?`} description={d.trial ? "It's free while you're on trial. After that it's added to your monthly invoice." : "It's added to your next invoice, for each month it's on."} footer={<><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant="primary" loading={toggle.isPending} onClick={() => toggle.mutate({ key: confirm.key, on: true })}>Switch on</Button></>}>
          <div className="text-[14px]">{priceText(confirm)}{confirm.pricing === "per_employee" ? `, about ${fmtMoney(confirm.monthly)} a month for your ${d.seats} employees today` : ""}, plus GST.</div>
        </Dialog>
      ) : null}
    </Card>
  );
}

interface PlatformAddon { key: string; name: string; description: string; pricing: "per_employee" | "flat"; price: number; active: boolean; companies: number }

/** Platform console → Plans: the add-on catalogue and its prices. */
export function PlatformAddons({ superAdmin }: { superAdmin: boolean }) {
  const q = useQuery({ queryKey: ["platform", "addons"], queryFn: () => api.get<PlatformAddon[]>("/platform/billing/addons") });
  const [edit, setEdit] = useState<PlatformAddon | null>(null);
  return (
    <Card className="!gap-3" style={{ padding: 18 }}>
      <CardHeader title="Add-ons" sub="Sold on top of any plan. A feature flag on the same key can also give one free to a company, say for a pilot." />
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))" }}>
        {(q.data ?? []).map((a) => (
          <div key={a.key} className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3.5" style={{ opacity: a.active ? 1 : 0.6 }}>
            <div className="flex items-center justify-between gap-2"><span className="font-medium">{a.name}</span>{a.active ? null : <Tag tone="outline">Not on sale</Tag>}</div>
            <div className="text-[18px] font-medium">{priceText(a)}</div>
            <div className="text-muted text-[12.5px]">{a.companies} {a.companies === 1 ? "company has" : "companies have"} it · <code>{a.key}</code></div>
            {superAdmin ? <Button size="sm" className="mt-1 self-start" onClick={() => setEdit(a)}>Edit</Button> : null}
          </div>
        ))}
      </div>
      {edit ? <EditAddon a={edit} onClose={() => setEdit(null)} /> : null}
    </Card>
  );
}

function EditAddon({ a, onClose }: { a: PlatformAddon; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: a.name, description: a.description, pricing: a.pricing, price: String(a.price), active: a.active });
  const save = useMutation({
    mutationFn: () => api.put(`/platform/billing/addons/${a.key}`, { ...f, price: Number(f.price || 0) }),
    onSuccess: () => (toast.success("Saved. New prices apply from the next invoice."), qc.invalidateQueries({ queryKey: ["platform", "addons"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Edit ${a.name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} /></Field>
        <Field label="Description" hint="Customers see this on their billing page."><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} className="!min-h-[64px]" /></Field>
        <Field label="Charged"><Segmented value={f.pricing} onChange={(v) => setF({ ...f, pricing: v })} options={[{ value: "per_employee", label: "Per employee" }, { value: "flat", label: "Flat a month" }]} /></Field>
        <Field label={f.pricing === "flat" ? "Price a month (₹)" : "Price per employee a month (₹)"} hint="Before GST."><Input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
        <Checkbox checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="On sale. Companies that already have it keep it either way." />
      </div>
    </Dialog>
  );
}
