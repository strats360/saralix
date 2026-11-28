import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Image, Plus, Tablet } from "lucide-react";
import { fmtDate } from "@hrms/shared";
import { api, errorMessage, openFile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, TableCard } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm";
import { DataTable } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Segmented, Select } from "@/components/ui/field";
import { Menu } from "@/components/ui/menu";
import { Empty, ErrorState, Notice } from "@/components/ui/page";
import { PillTabs } from "@/components/ui/tabs";
import { Tag, type Tone } from "@/components/ui/tag";
import { useLookups } from "@/components/recruitment/shared";
import { FaceEnroll } from "@/components/face/FaceEnroll";
import { BlinkTest } from "@/components/face/BlinkTest";

interface KioskRow { id: string; name: string; branchId: string | null; branch: string | null; active: boolean; requireBlink: boolean; paired: boolean; pairExpiresAt: string | null; lastSeenAt: string | null; lastPunchAt: string | null; punchCount: number; code?: string }
interface Person { id: string; name: string; code: string; enrolledAt: string | null; via: "self" | "hr" | null }
interface Event { id: string; result: string; distance: number | null; blinked: boolean; hasPhoto: boolean; createdAt: string; kiosk: string; employee: string | null; code: string | null }

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Never");
const RESULT: Record<string, [string, Tone]> = { punched: ["Punched", "ok"], repeat: ["Repeat, ignored", "neutral"], unknown: ["Not recognised", "warn"], unsure: ["Unsure, asked again", "warn"], undone: ["Taken back", "bad"] };

/** Attendance → Face kiosk: the tablets and phones at the door, whose faces they know, and what they saw. */
export default function FaceKiosk() {
  const [tab, setTab] = useState<"kiosks" | "people" | "activity">("kiosks");
  return (
    <div className="flex flex-col gap-4">
      <PillTabs value={tab} onChange={setTab} tabs={[{ value: "kiosks", label: "Kiosks" }, { value: "people", label: "Faces" }, { value: "activity", label: "Activity" }]} />
      {tab === "kiosks" ? <Kiosks /> : tab === "people" ? <People /> : <Activity />}
    </div>
  );
}

function Kiosks() {
  const qc = useQueryClient();
  const L = useLookups();
  const q = useQuery({ queryKey: ["kiosks"], queryFn: () => api.get<KioskRow[]>("/admin/face-kiosk/kiosks") });
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", branchId: "" });
  const [code, setCode] = useState<{ name: string; code: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const add = useMutation({ mutationFn: () => api.post<KioskRow>("/admin/face-kiosk/kiosks", { name: f.name, branchId: f.branchId || null }), onSuccess: (r) => (setAdding(false), setF({ name: "", branchId: "" }), setCode({ name: r.name, code: r.code! }), qc.invalidateQueries({ queryKey: ["kiosks"] })), onError: (e) => toast.error(errorMessage(e)) });
  const pair = useMutation({ mutationFn: (k: KioskRow) => api.post<KioskRow>(`/admin/face-kiosk/kiosks/${k.id}/pair`), onSuccess: (r) => (setCode({ name: r.name, code: r.code! }), qc.invalidateQueries({ queryKey: ["kiosks"] })), onError: (e) => toast.error(errorMessage(e)) });
  const toggle = useMutation({ mutationFn: (k: KioskRow) => api.patch(`/admin/face-kiosk/kiosks/${k.id}`, { active: !k.active }), onSuccess: () => qc.invalidateQueries({ queryKey: ["kiosks"] }), onError: (e) => toast.error(errorMessage(e)) });
  const blink = useMutation({ mutationFn: (k: KioskRow) => api.patch(`/admin/face-kiosk/kiosks/${k.id}`, { requireBlink: !k.requireBlink }), onSuccess: () => qc.invalidateQueries({ queryKey: ["kiosks"] }), onError: (e) => toast.error(errorMessage(e)) });
  const askBlink = async (k: KioskRow) => {
    if (k.requireBlink && !(await confirmAction({ title: "Stop asking for a blink?", body: "Without it, a photo of someone held up to the camera could punch them in. Turn it off only if the camera can't keep up.", confirmLabel: "Stop asking", danger: true }))) return;
    blink.mutate(k);
  };
  const link = `${location.origin}/kiosk`;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-muted max-w-[640px] text-[13px]">Any tablet or phone with a front camera can be a kiosk. Open <span className="font-medium">{link}</span> in its browser and type the pairing code. Put it at the entrance, plugged in, at face height.</div>
        <div className="flex gap-2">
          <Button onClick={() => setTesting(true)}>Test the blink check</Button>
          <Button variant="primary" onClick={() => setAdding(true)}><Plus size={16} /> Add kiosk</Button>
        </div>
      </div>
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : null}
      {q.data && !q.data.length ? <Card><Empty title="No kiosks yet" sub="Add one, then pair a tablet or phone at the entrance." /></Card> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {q.data?.map((k) => (
          <Card key={k.id} className="gap-2">
            <div className="flex items-start gap-3">
              <Tablet size={20} className="text-muted mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{k.name}</div>
                <div className="text-muted text-[12.5px]">{k.branch ?? "Any branch"} · last seen {when(k.lastSeenAt)}</div>
              </div>
              <Tag tone={!k.active ? "outline" : k.pairExpiresAt ? "warn" : "ok"}>{!k.active ? "Off" : k.pairExpiresAt ? "Waiting to pair" : "Running"}</Tag>
              <Menu trigger={<Button size="sm">More</Button>} items={[{ label: "New pairing code", onSelect: () => pair.mutate(k) }, { label: k.requireBlink ? "Stop asking for a blink" : "Ask people to blink", onSelect: () => void askBlink(k) }, { label: k.active ? "Turn off" : "Turn on", onSelect: () => toggle.mutate(k), danger: k.active }]} />
            </div>
            <div className="text-muted text-[12.5px]"><span className="num">{k.punchCount}</span> punches · last punch {when(k.lastPunchAt)} · {k.requireBlink ? "asks for a blink" : <span style={{ color: "var(--warn-fg)" }}>no blink check</span>}</div>
          </Card>
        ))}
      </div>
      <Dialog open={testing} onOpenChange={setTesting} title="Test the blink check" description="Kiosks ask people to blink, so a photo can't punch. Open this page on the tablet or phone you'll use as a kiosk and check it catches your blinks." width={460}>
        {testing ? <BlinkTest /> : null}
      </Dialog>
      <Dialog open={adding} onOpenChange={setAdding} title="Add a kiosk" footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" disabled={f.name.trim().length < 2} loading={add.isPending} onClick={() => add.mutate()}>Add</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Name" hint="Where it is, so you can tell kiosks apart."><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Main gate" maxLength={80} /></Field>
          <Field label="Branch"><Select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="">Any branch</option>{L.data?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        </div>
      </Dialog>
      <Dialog open={!!code} onOpenChange={(o) => !o && setCode(null)} title={`Pair ${code?.name ?? "the kiosk"}`} footer={<Button variant="primary" onClick={() => setCode(null)}>Done</Button>}>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="text-[14px]">On the tablet or phone, open <span className="font-medium">{link}</span> and type this code:</div>
          <div className="num rounded-[var(--radius-md)] bg-[var(--tint-1)] px-5 py-3 font-mono text-[30px] tracking-[0.25em]">{code?.code}</div>
          <div className="text-muted text-[12.5px]">It works once, for the next 30 minutes. A tablet paired with an older code stops working when this one is used.</div>
        </div>
      </Dialog>
    </>
  );
}

function People() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["kiosk-people"], queryFn: () => api.get<Person[]>("/admin/face-kiosk/people") });
  const [filter, setFilter] = useState<"all" | "missing" | "enrolled">("all");
  const [enrolling, setEnrolling] = useState<Person | null>(null);
  const save = useMutation({ mutationFn: (d: number[][]) => api.post(`/admin/face-kiosk/people/${enrolling!.id}`, { descriptors: d, consent: true }), onSuccess: () => (toast.success(`${enrolling!.name}'s face is saved`), setEnrolling(null), qc.invalidateQueries({ queryKey: ["kiosk-people"] })), onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (p: Person) => api.del(`/admin/face-kiosk/people/${p.id}`), onSuccess: () => (toast.success("Removed"), qc.invalidateQueries({ queryKey: ["kiosk-people"] })), onError: (e) => toast.error(errorMessage(e)) });
  const rows = (q.data ?? []).filter((p) => filter === "all" || (filter === "enrolled" ? !!p.enrolledAt : !p.enrolledAt));
  const enrolled = (q.data ?? []).filter((p) => p.enrolledAt).length;
  const columns = useMemo<ColumnDef<Person>[]>(
    () => [
      { id: "name", header: "Employee", accessorKey: "name", cell: ({ row: { original: p } }) => <div><div className="font-medium">{p.name}</div><div className="text-muted text-[12px]">{p.code}</div></div> },
      { id: "face", header: "Face", cell: ({ row: { original: p } }) => (p.enrolledAt ? <div><Tag tone="ok">Enrolled</Tag><div className="text-muted mt-0.5 text-[12px]">{p.via === "hr" ? "by HR" : "by them"}, {fmtDate(p.enrolledAt.slice(0, 10))}</div></div> : <Tag tone="neutral">Not yet</Tag>) },
      {
        id: "act",
        header: "",
        cell: ({ row: { original: p } }) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={(e) => (e.stopPropagation(), setEnrolling(p))}>{p.enrolledAt ? "Enrol again" : "Enrol"}</Button>
            {p.enrolledAt ? <Button size="sm" variant="ghost" onClick={async (e) => { e.stopPropagation(); if (await confirmAction({ title: `Remove ${p.name}'s face?`, body: "The kiosk won't recognise them until they enrol again.", confirmLabel: "Remove", danger: true })) remove.mutate(p); }}>Remove</Button> : null}
          </div>
        ),
      },
    ],
    [remove],
  );
  return (
    <>
      <Notice tone="sel">People can enrol themselves from the employee app (Face punch), on their own phone. You can also enrol someone here on this device, with them in front of the camera and agreeing to it.</Notice>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: "Everyone" }, { value: "missing", label: "Not enrolled" }, { value: "enrolled", label: "Enrolled" }]} />
        <div className="text-muted text-[13px]"><span className="num">{enrolled}</span> of <span className="num">{q.data?.length ?? 0}</span> enrolled</div>
      </div>
      <TableCard><DataTable data={rows} columns={columns} getRowId={(r) => r.id} loading={q.isFetching} storageKey="kiosk-people" empty="Nobody here." /></TableCard>
      <Dialog open={!!enrolling} onOpenChange={(o) => !o && setEnrolling(null)} title={`Enrol ${enrolling?.name ?? ""}`} description="Ask them to look at this device's camera." width={500}>
        {enrolling ? <FaceEnroll who={enrolling.name} consentText="{who} is here and agrees to their face being used for attendance." busy={save.isPending} onDone={(d) => save.mutate(d)} /> : null}
      </Dialog>
    </>
  );
}

function Activity() {
  const [result, setResult] = useState<"all" | "punched" | "unknown" | "undone">("all");
  const q = useQuery({ queryKey: ["kiosk-events", result], queryFn: () => api.get<Event[]>(`/admin/face-kiosk/events${result === "all" ? "" : `?result=${result}`}`) });
  const columns = useMemo<ColumnDef<Event>[]>(
    () => [
      { id: "at", header: "When", accessorKey: "createdAt", cell: ({ getValue }) => when(getValue<string>()) },
      { id: "who", header: "Who", cell: ({ row: { original: e } }) => (e.employee ? <div><div>{e.employee}</div><div className="text-muted text-[12px]">{e.code}</div></div> : <span className="text-muted">Unknown face</span>) },
      { id: "result", header: "Result", accessorKey: "result", cell: ({ row: { original: e } }) => <Tag tone={RESULT[e.result]?.[1] ?? "neutral"}>{RESULT[e.result]?.[0] ?? e.result}</Tag> },
      { id: "match", header: "Match", cell: ({ row: { original: e } }) => (e.distance === null ? "—" : e.distance < 0.35 ? "Strong" : e.distance < 0.5 ? "Good" : "Weak") },
      { id: "blink", header: "Blink", cell: ({ row: { original: e } }) => (e.blinked ? "Yes" : <span className="text-muted">No</span>) },
      { id: "kiosk", header: "Kiosk", accessorKey: "kiosk" },
      { id: "photo", header: "", cell: ({ row: { original: e } }) => (e.hasPhoto ? <Button size="sm" variant="ghost" aria-label="See the photo" onClick={() => openFile(`/admin/face-kiosk/events/${e.id}/photo`).catch((x) => toast.error(errorMessage(x)))}><Image size={15} /></Button> : null) },
    ],
    [],
  );
  return (
    <>
      <Segmented value={result} onChange={setResult} options={[{ value: "all", label: "Everything" }, { value: "punched", label: "Punches" }, { value: "unknown", label: "Not recognised" }, { value: "undone", label: "Taken back" }]} />
      <TableCard><DataTable data={q.data ?? []} columns={columns} getRowId={(r) => r.id} loading={q.isFetching} storageKey="kiosk-events" empty="Nothing yet." /></TableCard>
      <div className="text-muted text-[12px]">Photos are kept for 90 days. Kiosks ask people to blink, so a photo held up to the camera won't punch. A video of someone could still get through, so check the pictures if a punch looks wrong.</div>
    </>
  );
}
