import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ScanFace } from "lucide-react";
import { fmtDate } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm";
import { ErrorState, Loading, Notice } from "@/components/ui/page";
import { FaceEnroll } from "@/components/face/FaceEnroll";

export const useMyFace = (enabled = true) => useQuery({ queryKey: ["face", "mine"], queryFn: () => api.get<{ enrolled: boolean; enrolledAt: string | null; via: string | null }>("/ess/face"), enabled });

/** Me → Face punch: enrol my face for the attendance kiosk, or remove it. */
export default function MyFace() {
  const qc = useQueryClient();
  const q = useMyFace();
  const save = useMutation({ mutationFn: (d: number[][]) => api.post("/ess/face", { descriptors: d, consent: true }), onSuccess: () => (toast.success("Done. Look at the kiosk to punch."), qc.invalidateQueries({ queryKey: ["face"] })), onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: () => api.del("/ess/face"), onSuccess: () => (toast.success("Removed"), qc.invalidateQueries({ queryKey: ["face"] })), onError: (e) => toast.error(errorMessage(e)) });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Loading />;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[22px] font-semibold">Face punch</h1>
        <div className="text-muted text-[13px]">Punch in and out by looking at the kiosk at the entrance.</div>
      </div>
      {q.data.enrolled ? (
        <Notice tone="ok">
          <span className="inline-flex items-center gap-2"><ScanFace size={16} /> Your face is set up{q.data.enrolledAt ? ` since ${fmtDate(q.data.enrolledAt.slice(0, 10))}` : ""}{q.data.via === "hr" ? ", by HR" : ""}.</span>
        </Notice>
      ) : null}
      <Card className="gap-3">
        <div className="text-[15px] font-medium">{q.data.enrolled ? "Set it up again" : "Set it up"}</div>
        <div className="text-muted text-[13px]">Good light, no cap or sunglasses. It takes three quick readings.</div>
        <FaceEnroll who="I" consentText="I agree to my face being used to record my attendance. I can remove it here at any time." busy={save.isPending} onDone={(d) => save.mutate(d)} />
      </Card>
      {q.data.enrolled ? (
        <Button className="self-start" loading={remove.isPending} onClick={async () => { if (await confirmAction({ title: "Remove your face?", body: "The kiosk won't recognise you until you set it up again.", confirmLabel: "Remove", danger: true })) remove.mutate(); }}>Remove my face</Button>
      ) : null}
    </div>
  );
}
