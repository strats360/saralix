import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { blinkDetector } from "@hrms/shared";
import { cameraError, openCamera, readEyes } from "@/lib/face";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/page";

const GOAL = 3;

/** Checks that this device's camera can catch a blink: blink three times and watch the count. */
export function BlinkTest() {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ear, setEar] = useState<number | null>(null);
  const [blinks, setBlinks] = useState(0);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    if (!on) return;
    let alive = true;
    let stop: (() => void) | null = null;
    const d = blinkDetector();
    let frames = 0;
    let since = performance.now();
    (async () => {
      try {
        stop = await openCamera(video.current!);
        while (alive) {
          const r = await readEyes(video.current!);
          frames++;
          const now = performance.now();
          if (now - since > 1000) (setFps(Math.round((frames * 1000) / (now - since))), (frames = 0), (since = now));
          if (!r || r.faces > 1) {
            setEar(null);
            d.reset();
          } else {
            setEar(r.ear);
            if (d.push(r.ear, now)) setBlinks((n) => n + 1);
          }
          await new Promise((res) => setTimeout(res, 20));
        }
      } catch (e) {
        setError(cameraError(e));
        setOn(false);
      }
    })();
    return () => {
      alive = false;
      stop?.();
    };
  }, [on]);

  const passed = blinks >= GOAL;
  return (
    <div className="flex flex-col gap-3">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-[360px] overflow-hidden rounded-[var(--radius-lg)] bg-black">
        <video ref={video} className="h-full w-full -scale-x-100 object-cover" playsInline muted />
        {on ? (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-black/60 px-3 py-2 text-[12.5px] text-white">
            <span>Eyes</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${Math.min(100, ((ear ?? 0) / 0.4) * 100)}%` }} /></div>
            <span className="num">{blinks} of {GOAL}</span>
          </div>
        ) : null}
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {passed ? (
        <Notice tone="ok"><span className="inline-flex items-center gap-2"><Check size={16} /> Caught {blinks} blinks. This device can run the blink check.</span></Notice>
      ) : on ? (
        <div className="text-muted text-[13px]">Look at the camera and blink normally, three times.{fps ? ` Checking ${fps} times a second${fps < 6 ? ", which is slow: blinks may be missed on this device" : ""}.` : ""}</div>
      ) : null}
      <div className="flex gap-2">
        {on ? <Button onClick={() => (setOn(false), setBlinks(0))}>Stop</Button> : <Button onClick={() => (setBlinks(0), setError(null), setOn(true))}>Test the blink check</Button>}
      </div>
    </div>
  );
}
