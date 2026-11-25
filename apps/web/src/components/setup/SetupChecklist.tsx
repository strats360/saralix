import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Circle, ChevronRight } from "lucide-react";
import type { SetupItemKey } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";

interface Item {
  key: SetupItemKey;
  required: boolean;
  title: string;
  detail: string;
  to: string;
  manual: boolean;
  done: boolean;
}
interface Data {
  items: Item[];
  requiredDone: number;
  requiredTotal: number;
  complete: boolean;
  hidden: boolean;
}

/** What's left to set up, on the dashboard: required steps first, then the optional ones. */
export function SetupChecklist() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["setup-checklist"], queryFn: () => api.get<Data>("/admin/dashboard/setup"), enabled: can("settings", "configure") });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["setup-checklist"] });
    qc.invalidateQueries({ queryKey: ["me"] });
  };
  const tick = useMutation({ mutationFn: (b: { key: string; done: boolean }) => api.post(`/admin/dashboard/setup/${b.key}`, { done: b.done }), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const finish = useMutation({
    mutationFn: (hideOnly: boolean) => api.post("/admin/dashboard/setup-finish", { hideOnly }),
    onSuccess: (_r, hideOnly) => {
      if (!hideOnly) toast.success("Setup complete. You're ready to run payroll.");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const d = q.data;
  if (!d || d.hidden) return null;
  const allRequired = d.requiredDone === d.requiredTotal;
  const optional = d.items.filter((i) => !i.required);
  const Row = ({ i }: { i: Item }) => (
    <div className="flex items-center gap-3 rounded-[var(--radius-md)] px-2 py-2 hover:bg-[var(--tint-1)]">
      {i.done ? <CheckCircle2 size={18} className="shrink-0 text-[var(--color-ok)]" /> : <Circle size={18} className="text-muted shrink-0" />}
      <Link to={i.to} className="flex min-w-0 flex-1 items-center justify-between gap-2 no-underline" style={{ color: "inherit" }}>
        <span className="min-w-0">
          <span className={`block text-[14px] ${i.done ? "text-muted line-through" : "font-medium"}`}>{i.title}</span>
          {!i.done ? <span className="text-muted block text-[12.5px]">{i.detail}</span> : null}
        </span>
        {!i.done ? <ChevronRight size={16} className="text-muted shrink-0" /> : null}
      </Link>
      {i.manual ? (
        <Button size="sm" variant="ghost" onClick={() => tick.mutate({ key: i.key, done: !i.done })}>{i.done ? "Undo" : "Mark as done"}</Button>
      ) : null}
    </div>
  );
  return (
    <Card className="!gap-3">
      <CardHeader
        title="Get started"
        sub={allRequired ? "The essentials are done. Finish the optional steps when you like." : `${d.requiredDone} of ${d.requiredTotal} essential steps done. You need these before your first payroll.`}
        actions={
          allRequired && !d.complete ? (
            <Button variant="primary" loading={finish.isPending && !finish.variables} onClick={() => finish.mutate(false)}>Finish setup</Button>
          ) : (
            <Button variant="ghost" size="sm" loading={finish.isPending && !!finish.variables} onClick={() => finish.mutate(true)}>Hide</Button>
          )
        }
      />
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--tint-2)]">
        <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${Math.round((d.requiredDone / d.requiredTotal) * 100)}%` }} />
      </div>
      <div className="grid gap-x-6 gap-y-1 lg:grid-cols-2">
        <div>
          <div className="card-kicker mb-1 flex items-center gap-2">Essential <Tag tone={allRequired ? "ok" : "warn"}>{d.requiredDone}/{d.requiredTotal}</Tag></div>
          {d.items.filter((i) => i.required).map((i) => <Row key={i.key} i={i} />)}
        </div>
        <div>
          <div className="card-kicker mb-1 flex items-center gap-2">Optional <Tag>{optional.filter((i) => i.done).length}/{optional.length}</Tag></div>
          {optional.map((i) => <Row key={i.key} i={i} />)}
        </div>
      </div>
    </Card>
  );
}
