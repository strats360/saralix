import { useEffect, useRef, useState } from "react";
import { Camera, Check } from "lucide-react";
import { cameraError, loadFace, openCamera, readFace } from "@/lib/face";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field";
import { Notice } from "@/components/ui/page";

const NEEDED = 3;

/**
 * Takes three readings of one face, with a short pause between them, then hands the descriptors
 * on with the person's consent. Nothing is uploaded here; the caller sends the numbers.
 */
export function FaceEnroll({ who, consentText, onDone, busy }: { who: string; consentText: string; onDone: (descriptors: number[][]) => void; busy?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "starting" | "capturing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [samples, setSamples] = useState<number[][]>([]);
  const [consent, setConsent] = useState(false);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  const start = async () => {
    setError(null);
    setSamples([]);
    setState("starting");
    try {
      await loadFace();
      stop.current = await openCamera(video.current!);
      setState("capturing");
      const got: number[][] = [];
      while (got.length < NEEDED && video.current) {
        const r = await readFace(video.current);
        if (!r) setHint("Look at the camera, with your face in the oval");
        else if (r.faces > 1) setHint("Only one face, please");
        else if (r.box.w < 0.22) setHint("Come a little closer");
        else {
          got.push(r.descriptor);
          setSamples([...got]);
          setHint(got.length < NEEDED ? "Good. Turn your head slightly" : "Done");
          await new Promise((res) => setTimeout(res, 700));
          continue;
        }
        await new Promise((res) => setTimeout(res, 250));
      }
      stop.current?.();
      setState("done");
    } catch (e) {
      stop.current?.();
      setError(cameraError(e));
      setState("idle");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-[420px] overflow-hidden rounded-[var(--radius-lg)] bg-black">
        <video ref={video} className="h-full w-full -scale-x-100 object-cover" playsInline muted />
        {state === "capturing" ? <div className="pointer-events-none absolute left-1/2 top-1/2 h-[70%] w-[45%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-white/80" /> : null}
        {state !== "capturing" ? (
          <div className="absolute inset-0 grid place-items-center text-center text-white/90">
            {state === "starting" ? <span className="text-[14px]">Starting the camera…</span> : state === "done" ? <span className="inline-flex items-center gap-2 text-[15px]"><Check size={18} /> Got it</span> : <span className="inline-flex items-center gap-2 text-[14px]"><Camera size={18} /> Camera is off</span>}
          </div>
        ) : null}
        {state === "capturing" ? <div className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-2 text-center text-[13px] text-white">{hint || "Looking for a face…"} · {samples.length} of {NEEDED}</div> : null}
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <div className="text-muted text-[12.5px]">The face is turned into numbers on this device. No photo is stored for enrolment. The kiosk keeps a small photo of each punch for 90 days so HR can check it.</div>
      <Checkbox checked={consent} onChange={setConsent} label={consentText.replace("{who}", who)} />
      <div className="flex flex-wrap gap-2">
        {state === "done" && samples.length === NEEDED ? (
          <>
            <Button variant="primary" disabled={!consent} loading={busy} onClick={() => onDone(samples)}>Save face</Button>
            <Button onClick={start}>Take again</Button>
          </>
        ) : (
          <Button variant="primary" loading={state === "starting" || state === "capturing"} onClick={start}>{state === "idle" ? "Start camera" : "Capturing…"}</Button>
        )}
      </div>
    </div>
  );
}
