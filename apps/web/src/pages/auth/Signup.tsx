import { useState } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import { accountSignupSchema, workEmailError } from "@hrms/shared";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";
import { StepRail, WizardFrame } from "@/components/onboarding/PublicShell";
import { apiFieldErrors, zodErrors } from "@/components/onboarding/form";

const EMPTY = { name: "", email: "", phone: "", password: "" };

/** The three steps of signing up, shown on the left. */
export const SIGNUP_STEPS = [
  { label: "Create your account", hint: "Work email and password" },
  { label: "Confirm your email", hint: "Open the link we send" },
  { label: "Add your company", hint: "Name and state; the rest later" },
];

/** Company sign-up, step 1: the person, with a work email. The company comes after the email is confirmed. */
export default function Signup() {
  const [f, setF] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const signup = useMutation({
    mutationFn: (body: unknown) => api.post<{ email: string }>("/public/signup", body),
    meta: { silent: true },
    onSuccess: (r) => setSentTo(r.email),
    onError: (e) => {
      setErrors(apiFieldErrors(e));
      setFormErr(e instanceof Error ? e.message : "Sign up failed");
    },
  });
  const resend = useMutation({ mutationFn: () => api.post("/public/signup/resend", { email: sentTo }), meta: { silent: true } });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr(null);
    const parsed = accountSignupSchema.safeParse({ ...f, phone: f.phone || null });
    if (!parsed.success) return setErrors(zodErrors(parsed.error));
    setErrors({});
    signup.mutate(parsed.data);
  };
  // say it as soon as they leave the field, not only on submit
  const checkEmail = () => {
    const err = f.email.includes("@") ? workEmailError(f.email) : null;
    setErrors((x) => ({ ...x, email: err ?? "" }));
  };

  return (
    <WizardFrame
      rail={
        <>
          <div>
            <div className="text-[22px] font-medium tracking-[-0.01em]">Start with Saralix</div>
            <div className="text-muted text-[13px]">Two minutes to get in. Set up the rest from your dashboard, at your own pace.</div>
          </div>
          <StepRail steps={SIGNUP_STEPS.map((s, i) => ({ ...s, state: sentTo ? (i === 0 ? "done" : i === 1 ? "current" : "todo") : i === 0 ? "current" : "todo" }))} />
        </>
      }
      footnote="30-day trial · no card needed · data stored in India"
    >
      {sentTo ? (
        <div className="flex flex-col gap-4">
          <MailCheck size={32} className="text-[var(--color-accent)]" />
          <div className="text-[26px] font-medium tracking-[-0.015em]">Check your email</div>
          <p className="!m-0 text-[14.5px]">
            We sent a link to <b className="font-semibold">{sentTo}</b>. Open it to confirm your email, then sign in and add your company. The link works for 24 hours.
          </p>
          <div className="text-muted text-[13px]">Nothing there after a few minutes? Check spam, or send it again.</div>
          <div className="flex flex-wrap gap-2">
            <Button loading={resend.isPending} disabled={resend.isSuccess} onClick={() => resend.mutate()}>{resend.isSuccess ? "Sent again" : "Send the link again"}</Button>
            <Button variant="ghost" onClick={() => { setSentTo(null); resend.reset(); }}>Use a different email</Button>
          </div>
          {resend.error ? <Notice tone="bad">{errorMessage(resend.error)}</Notice> : null}
        </div>
      ) : (
        <>
          <div>
            <div className="card-kicker">Step 1 of 3</div>
            <div className="text-[26px] font-medium tracking-[-0.015em]">Create your account</div>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Your name" error={errors.name}>
                <Input value={f.name} onChange={set("name")} autoComplete="name" invalid={!!errors.name} />
              </Field>
              <Field label="Work email" error={errors.email} hint={errors.email ? undefined : "Your company address, not Gmail or Yahoo"}>
                <Input type="email" value={f.email} onChange={set("email")} onBlur={checkEmail} autoComplete="email" placeholder="you@yourcompany.com" invalid={!!errors.email} />
              </Field>
              <Field label="Mobile" error={errors.phone}>
                <Input type="tel" value={f.phone} onChange={set("phone")} placeholder="+91 98240 11872" autoComplete="tel" invalid={!!errors.phone} />
              </Field>
              <Field label="Password" error={errors.password} hint="At least 10 characters">
                <Input type="password" value={f.password} onChange={set("password")} autoComplete="new-password" invalid={!!errors.password} />
              </Field>
            </div>
            {formErr ? <Notice tone="bad">{formErr}</Notice> : null}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-divider)] pt-3">
              <div className="text-muted text-[13px]">
                Already have an account? <Link to="/login">Sign in</Link>
              </div>
              <Button type="submit" variant="primary" loading={signup.isPending}>
                Create account
              </Button>
            </div>
            <div className="text-muted text-[12px]">By continuing you agree to the terms of service and privacy policy. Your data is processed under the DPDP Act, 2023.</div>
          </form>
        </>
      )}
    </WizardFrame>
  );
}
