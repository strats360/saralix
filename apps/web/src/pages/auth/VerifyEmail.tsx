import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CheckCircle2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Loading, Notice } from "@/components/ui/page";
import { StepRail, WizardFrame } from "@/components/onboarding/PublicShell";
import { SIGNUP_STEPS } from "./Signup";

/** Sign-up, step 2: the link from the email. */
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<{ ok: true; email: string } | { ok: false; error: string } | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    if (!token) return setState({ ok: false, error: "This link is missing its code. Open the link from the email again." });
    api
      .post<{ email: string }>("/public/signup/verify", { token })
      .then((r) => setState({ ok: true, email: r.email }))
      .catch((e) => setState({ ok: false, error: errorMessage(e) }));
  }, [token]);
  return (
    <WizardFrame
      rail={
        <>
          <div className="text-[22px] font-medium tracking-[-0.01em]">Start with Saralix</div>
          <StepRail steps={SIGNUP_STEPS.map((s, i) => ({ ...s, state: state?.ok ? (i < 2 ? "done" : "current") : i === 0 ? "done" : i === 1 ? "current" : "todo" }))} />
        </>
      }
      footnote="30-day trial · no card needed · data stored in India"
    >
      {!state ? (
        <Loading label="Confirming your email…" />
      ) : state.ok ? (
        <div className="flex flex-col gap-4">
          <CheckCircle2 size={32} className="text-[var(--color-ok)]" />
          <div className="text-[26px] font-medium tracking-[-0.015em]">Your email is confirmed</div>
          <p className="!m-0 text-[14.5px]">Sign in with <b className="font-semibold">{state.email}</b> and the password you chose. Next, add your company.</p>
          <div>
            <Link to={`/login#email=${encodeURIComponent(state.email)}`} className="btn btn-primary">Sign in</Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Notice tone="bad">{state.error}</Notice>
          <div className="flex gap-2">
            <Link to="/signup" className="btn btn-primary">Sign up again</Link>
            <Link to="/login" className="btn">Sign in</Link>
          </div>
        </div>
      )}
    </WizardFrame>
  );
}
