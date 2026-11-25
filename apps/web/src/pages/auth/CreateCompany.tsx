import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { companyCreateSchema, INDIAN_STATES } from "@hrms/shared";
import { api, setActiveTenant } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { StepRail, WizardFrame } from "@/components/onboarding/PublicShell";
import { apiFieldErrors, zodErrors } from "@/components/onboarding/form";
import { SIGNUP_STEPS } from "./Signup";

const EMPTY = { companyName: "", legalName: "", state: "Gujarat", role: "HR head", companySize: "21–100" };

/** Sign-up, step 3: just enough to create the company. The dashboard lists what's left to set up. */
export default function CreateCompany() {
  const { me } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const create = useMutation({
    mutationFn: (body: unknown) => api.post<{ tenantId: string }>("/me/company", body),
    meta: { silent: true },
    onSuccess: async (r) => {
      setActiveTenant(r.tenantId);
      await qc.invalidateQueries({ queryKey: ["me"] });
      nav("/", { replace: true });
    },
    onError: (e) => {
      setErrors(apiFieldErrors(e));
      setFormErr(e instanceof Error ? e.message : "Could not create the company");
    },
  });
  if (me && !me.canCreateCompany) return <Navigate to="/" replace />;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr(null);
    const parsed = companyCreateSchema.safeParse({ ...f, legalName: f.legalName || f.companyName });
    if (!parsed.success) return setErrors(zodErrors(parsed.error));
    setErrors({});
    create.mutate(parsed.data);
  };
  return (
    <WizardFrame
      rail={
        <>
          <div className="text-[22px] font-medium tracking-[-0.01em]">Welcome{me ? `, ${me.user.name.split(" ")[0]}` : ""}</div>
          <StepRail steps={SIGNUP_STEPS.map((s, i) => ({ ...s, state: i < 2 ? "done" : "current" }))} />
        </>
      }
      footnote="30-day trial · no card needed · data stored in India"
    >
      <div>
        <div className="card-kicker">Step 3 of 3</div>
        <div className="text-[26px] font-medium tracking-[-0.015em]">Add your company</div>
        <div className="text-muted mt-1 text-[13.5px]">Just the basics. Your dashboard lists the rest, like PAN, PF and ESI, branches and employees, to do when you're ready.</div>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name" error={errors.companyName}>
            <Input value={f.companyName} onChange={set("companyName")} autoComplete="organization" invalid={!!errors.companyName} />
          </Field>
          <Field label="Legal name" hint="As on your GST or PAN. Leave blank if same." error={errors.legalName}>
            <Input value={f.legalName} onChange={set("legalName")} />
          </Field>
          <Field label="State of registered office" error={errors.state}>
            <Select value={f.state} onChange={set("state")}>
              {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Company size">
            <Select value={f.companySize} onChange={set("companySize")}>
              {["1–20", "21–100", "101–500", "500+"].map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Your role">
            <Select value={f.role} onChange={set("role")}>
              {["HR head", "Founder / director", "Finance / accounts", "Payroll consultant (CA)"].map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
        </div>
        {formErr ? <Notice tone="bad">{formErr}</Notice> : null}
        <div className="mt-2 flex justify-end border-t border-[var(--color-divider)] pt-3">
          <Button type="submit" variant="primary" loading={create.isPending}>Create company</Button>
        </div>
      </form>
    </WizardFrame>
  );
}
