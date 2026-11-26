import { useEffect } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router";
import { RefreshCw, Compass, Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/layout/Header";
import { BrandMark } from "@/components/onboarding/PublicShell";
import { isStaleBuildError, reloadForNewVersion } from "@/lib/stale-build";

type Kind = "notFound" | "updated" | "broken";

const COPY: Record<Kind, { code: string; title: string; body: string }> = {
  notFound: {
    code: "404",
    title: "We couldn't find that page",
    body: "The link may be old, or the page may have moved. Head back to your dashboard and pick up from there.",
  },
  updated: {
    code: "New version",
    title: "Saralix has just been updated",
    body: "This tab is still running the older version. Reload to get the latest one. Nothing you saved is lost.",
  },
  broken: {
    code: "Something went wrong",
    title: "This page didn't load properly",
    body: "Try reloading. If it keeps happening, go to your dashboard and tell us through Help.",
  },
};

const ICON = { notFound: Compass, updated: Sparkles, broken: RefreshCw };

/** Shown when a page fails. Friendly words only: the technical details go to the console, not the screen. */
export function ErrorPage() {
  const error = useRouteError();
  const kind: Kind = isRouteErrorResponse(error) && error.status === 404 ? "notFound" : isStaleBuildError(error) ? "updated" : "broken";

  useEffect(() => {
    console.error("Page error:", error);
    // a page file from an older build: reload once, quietly, to pick up the new version
    if (kind === "updated") reloadForNewVersion();
  }, [error, kind]);

  const { code, title, body } = COPY[kind];
  const Icon = ICON[kind];
  return (
    <div className="flex min-h-screen flex-col px-4 py-5 sm:px-8" style={{ background: "var(--color-bg)", color: "var(--color-text)" }}>
      <header className="flex items-center justify-between">
        <a href="/" className="text-[var(--color-text)] no-underline hover:no-underline" aria-label="Saralix home">
          <BrandMark size={30} />
        </a>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center py-10">
        <div className="card w-[min(480px,100%)] items-center gap-0 px-6 py-10 text-center sm:px-10">
          <span className="grid h-14 w-14 place-items-center rounded-full" style={{ background: "var(--color-accent-tint)", color: "var(--color-accent)" }} aria-hidden>
            <Icon size={24} strokeWidth={1.8} />
          </span>
          <div className="card-kicker mt-5">{code}</div>
          <h1 className="mt-2 text-[26px] font-medium tracking-[-0.015em]">{title}</h1>
          <p className="text-muted mx-auto mt-1 max-w-[360px] text-[14px] leading-relaxed">{body}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {kind !== "notFound" ? (
              <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
                <RefreshCw size={15} /> Reload page
              </button>
            ) : null}
            <button type="button" className={kind === "notFound" ? "btn btn-primary" : "btn btn-secondary"} onClick={() => window.location.assign("/")}>
              Go to dashboard
            </button>
          </div>
        </div>
      </main>

      <footer className="text-muted text-center text-[12px]">Saralix · Simple HR and payroll</footer>
    </div>
  );
}

export default ErrorPage;
