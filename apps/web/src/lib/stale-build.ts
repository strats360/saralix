/**
 * After a deploy, a tab that was open before it still asks for the old page files, which are gone.
 * When that happens we reload once to pick up the new version. The timestamp stops a reload loop
 * if the file is missing for some other reason.
 */
const KEY = "saralix:stale-reload";
const WINDOW_MS = 30_000;

export function isStaleBuildError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e ?? "");
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk|Unable to preload CSS|is not a valid JavaScript MIME type/i.test(msg);
}

/** Reloads the page unless we already did so in the last 30 seconds. Returns true if it reloaded. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // storage blocked: still reload once; the error page catches a second failure
  }
  window.location.reload();
  return true;
}

/** Vite fires this when a preload for a lazy page fails. */
export function watchStaleBuilds() {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (e) => {
    if (reloadForNewVersion()) e.preventDefault();
  });
}

/** Wraps a lazy import: a missing file from an old build reloads the page instead of erroring. */
export function retryImport<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().catch((e: unknown) => {
      if (isStaleBuildError(e) && reloadForNewVersion()) return new Promise<T>(() => {});
      throw e;
    });
}
