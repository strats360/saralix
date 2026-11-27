import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize, ScanFace, WifiOff } from "lucide-react";
import { faceDistance } from "@hrms/shared";
import { cameraError, loadFace, openCamera, readFace, snapshot } from "@/lib/face";
import { SaralixTile } from "@/components/brand/Logo";

const KEY = "saralix.kiosk.key";
const getKey = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const setKey = (k: string | null) => {
  try {
    if (k) localStorage.setItem(KEY, k);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: pairing lasts until the tab closes */
  }
};

class KioskError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
async function call<T>(path: string, body?: unknown, key = getKey()): Promise<T> {
  const res = await fetch(`/api/public/kiosk${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), credentials: "omit" });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new KioskError(res.status, json?.error?.message ?? json?.message ?? "Something went wrong");
  return json as T;
}

type Result =
  | { result: "punched"; eventId: string; name: string; first: string; direction: "in" | "out"; at: string; undoSeconds: number; note: string | null }
  | { result: "repeat"; name: string; first: string; at: string }
  | { result: "unknown" | "unsure" };

const time = (d: Date | string) => new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const greet = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

/** The face kiosk: runs in a browser on a tablet or phone at the entrance. */
export default function Kiosk() {
  const [paired, setPaired] = useState<{ name: string; company: string } | null>(null);
  const [state, setState] = useState<"checking" | "pair" | "run" | "blocked">(getKey() ? "checking" : "pair");
  const [blocked, setBlocked] = useState("");

  const check = useCallback(async () => {
    try {
      setPaired(await call<{ name: string; company: string }>("/me"));
      setState("run");
    } catch (e) {
      if (e instanceof KioskError && e.status === 401) {
        setKey(null);
        setState("pair");
      } else {
        setBlocked(e instanceof Error ? e.message : "Couldn't reach Saralix");
        setState("blocked");
      }
    }
  }, []);
  useEffect(() => {
    if (state === "checking") void check();
  }, [state, check]);

  useEffect(() => {
    document.title = "Saralix kiosk";
  }, []);

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0d0f0e] text-white">
      {state === "pair" ? <Pair onPaired={() => setState("checking")} /> : null}
      {state === "checking" ? <Center>Connecting…</Center> : null}
      {state === "blocked" ? (
        <Center>
          <div className="max-w-[420px] text-center">
            <div className="text-[20px] font-medium">The kiosk can't run</div>
            <div className="mt-2 text-white/70">{blocked}</div>
            <button type="button" className="mt-5 rounded-full bg-white px-5 py-2.5 text-[15px] text-black" onClick={() => setState("checking")}>Try again</button>
          </div>
        </Center>
      ) : null}
      {state === "run" && paired ? <Scanner info={paired} onLost={() => setState("checking")} /> : null}
    </div>
  );
}

const Center = ({ children }: { children: React.ReactNode }) => <div className="grid flex-1 place-items-center p-6 text-[16px]">{children}</div>;

function Pair({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await call<{ key: string }>("/pair", { code }, null);
      setKey(r.key);
      onPaired();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't pair");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Center>
      <form onSubmit={submit} className="flex w-full max-w-[380px] flex-col items-center gap-4 text-center">
        <SaralixTile size={48} />
        <div className="text-[22px] font-medium">Set up this kiosk</div>
        <div className="text-[14px] text-white/70">In Saralix, go to Attendance → Face kiosk, add a kiosk, and type the 8 character code here.</div>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} inputMode="text" autoCapitalize="characters" autoComplete="off" aria-label="Pairing code" placeholder="ABCD2345" className="w-full rounded-[14px] border border-white/20 bg-white/5 px-4 py-3 text-center font-mono text-[28px] tracking-[0.25em] text-white outline-none focus:border-white/60" />
        {error ? <div className="text-[14px] text-[#ff9b8f]">{error}</div> : null}
        <button type="submit" disabled={code.length !== 8 || busy} className="w-full rounded-full bg-white py-3 text-[16px] font-medium text-black disabled:opacity-40">{busy ? "Pairing…" : "Pair"}</button>
      </form>
    </Center>
  );
}

function Scanner({ info, onLost }: { info: { name: string; company: string }; onLost: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(new Date());
  const [status, setStatus] = useState<"loading" | "scanning" | "sending" | "result" | "error">("loading");
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [undoLeft, setUndoLeft] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const busy = useRef(false);
  const last = useRef<number[] | null>(null);
  const resultTimer = useRef<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => (clearInterval(t), removeEventListener("online", on), removeEventListener("offline", off));
  }, []);

  // keep the screen on while the kiosk runs
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const ask = () => (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    void ask();
    const vis = () => document.visibilityState === "visible" && void ask();
    document.addEventListener("visibilitychange", vis);
    return () => (document.removeEventListener("visibilitychange", vis), void lock?.release().catch(() => {}));
  }, []);

  useEffect(() => {
    let stop: (() => void) | null = null;
    let alive = true;
    (async () => {
      try {
        await loadFace();
        stop = await openCamera(video.current!);
        if (alive) setStatus("scanning");
      } catch (e) {
        setError(cameraError(e));
        setStatus("error");
      }
    })();
    return () => {
      alive = false;
      stop?.();
    };
  }, []);

  const show = (r: Result) => {
    setResult(r);
    setStatus("result");
    const secs = r.result === "punched" ? Math.min(r.undoSeconds, 8) : 3;
    if (r.result === "punched") setUndoLeft(secs);
    if (resultTimer.current) clearTimeout(resultTimer.current);
    resultTimer.current = window.setTimeout(() => {
      setResult(null);
      setStatus("scanning");
      last.current = null;
    }, secs * 1000);
  };

  useEffect(() => {
    if (!undoLeft) return;
    const t = setTimeout(() => setUndoLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(t);
  }, [undoLeft]);

  // look for a face a few times a second; punch once the same face is seen twice in a row
  useEffect(() => {
    if (status !== "scanning") return;
    let alive = true;
    const tick = async () => {
      if (!alive || busy.current || !video.current) return;
      busy.current = true;
      try {
        const r = await readFace(video.current);
        if (!r) {
          setHint("");
          last.current = null;
        } else if (r.faces > 1) setHint("One person at a time, please");
        else if (r.box.w < 0.18) setHint("Come a little closer");
        else if (last.current && faceDistance(last.current, r.descriptor) < 0.35) {
          setHint("");
          setStatus("sending");
          const photo = snapshot(video.current);
          try {
            show(await call<Result>("/punch", { descriptor: r.descriptor, photo }));
          } catch (e) {
            if (e instanceof KioskError && (e.status === 401 || e.status === 403)) return onLost();
            setHint(e instanceof Error ? e.message : "Couldn't record the punch");
            setStatus("scanning");
          }
          last.current = null;
        } else {
          last.current = r.descriptor;
          setHint("Hold still");
        }
      } finally {
        busy.current = false;
      }
    };
    const t = setInterval(() => void tick(), 350);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [status, onLost]);

  const undo = async () => {
    if (result?.result !== "punched") return;
    try {
      await call("/undo", { eventId: result.eventId });
      show({ result: "unsure" });
      setHint("Punch taken back. Try again");
    } catch (e) {
      setHint(e instanceof Error ? e.message : "Couldn't take it back");
    }
  };

  return (
    <>
      <header className="flex items-center gap-3 px-5 pb-2 pt-[max(12px,env(safe-area-inset-top))]">
        <SaralixTile size={30} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[15px] font-medium">{info.company}</div>
          <div className="truncate text-[12px] text-white/60">{info.name}</div>
        </div>
        {!online ? <span className="inline-flex items-center gap-1 text-[13px] text-[#ffcf7a]"><WifiOff size={15} /> Offline</span> : null}
        {document.fullscreenEnabled ? (
          <button type="button" aria-label="Full screen" className="grid size-9 place-items-center rounded-full bg-white/10" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>
            <Maximize size={17} />
          </button>
        ) : null}
      </header>
      <div className="px-5 text-center">
        <div className="num text-[44px] font-light leading-none tracking-tight sm:text-[64px]">{now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</div>
        <div className="mt-1 text-[14px] text-white/60">{now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</div>
      </div>
      <div className="relative mx-auto my-4 flex w-full max-w-[560px] flex-1 items-center justify-center px-5">
        <div className="relative aspect-[3/4] max-h-full w-full overflow-hidden rounded-[28px] bg-black landscape:aspect-[4/3]">
          <video ref={video} className="h-full w-full -scale-x-100 object-cover" playsInline muted />
          <div className={`pointer-events-none absolute left-1/2 top-1/2 h-[62%] w-[52%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-[3px] transition-colors landscape:w-[40%] ${status === "sending" ? "border-[#7fd7a8]" : "border-white/70"}`} />
          {status === "loading" ? <Overlay><ScanFace size={40} className="opacity-80" /><div>Getting ready…</div></Overlay> : null}
          {status === "error" ? <Overlay><div className="max-w-[320px]">{error}</div></Overlay> : null}
          {result ? (
            <Overlay tone={result.result === "punched" ? "ok" : result.result === "repeat" ? "info" : "warn"}>
              {result.result === "punched" ? (
                <>
                  <div className="text-[26px] font-medium">{result.direction === "in" ? greet() : "Goodbye"}, {result.first}</div>
                  <div className="text-[17px]">{result.direction === "in" ? "Checked in" : "Checked out"} at {time(result.at)}</div>
                  {result.note ? <div className="text-[13px] opacity-80">{result.note}</div> : null}
                  {undoLeft ? <button type="button" onClick={undo} className="mt-3 rounded-full bg-black/30 px-4 py-2 text-[14px]">Not {result.first}? Tap here ({undoLeft})</button> : null}
                </>
              ) : result.result === "repeat" ? (
                <>
                  <div className="text-[22px] font-medium">Already got you, {result.first}</div>
                  <div className="text-[15px]">Punched at {time(result.at)}</div>
                </>
              ) : result.result === "unknown" ? (
                <>
                  <div className="text-[22px] font-medium">We don't know this face yet</div>
                  <div className="text-[15px]">Set up face punch in the Saralix app, or ask HR to enrol you.</div>
                </>
              ) : (
                <>
                  <div className="text-[22px] font-medium">Let's try that again</div>
                  <div className="text-[15px]">Look straight at the camera, in good light.</div>
                </>
              )}
            </Overlay>
          ) : null}
          {status === "scanning" || status === "sending" ? <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-4 pt-10 text-center text-[17px]">{status === "sending" ? "One moment…" : hint || "Look at the camera to punch in or out"}</div> : null}
        </div>
      </div>
      <footer className="px-5 pb-[max(14px,env(safe-area-inset-bottom))] text-center text-[11.5px] text-white/45">Your face is matched by Saralix for attendance only. A photo of each punch is kept for 90 days.</footer>
    </>
  );
}

function Overlay({ children, tone }: { children: React.ReactNode; tone?: "ok" | "info" | "warn" }) {
  const bg = tone === "ok" ? "bg-[#0f7a55]/90" : tone === "info" ? "bg-[#1f4e79]/90" : tone === "warn" ? "bg-[#8a5a00]/90" : "bg-black/60";
  return <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center ${bg}`}>{children}</div>;
}
