/**
 * Face reading in the browser, for the face kiosk. The models are served from our own site
 * (public/face) and run on the device: a face becomes 128 numbers here, and only those numbers
 * (plus a small photo at the kiosk) are sent.
 */
type FaceApi = typeof import("@vladmandic/face-api");
let ready: Promise<FaceApi> | null = null;

export function loadFace() {
  ready ??= (async () => {
    const faceapi = await import("@vladmandic/face-api");
    await (faceapi.tf as unknown as { ready: () => Promise<void> }).ready();
    await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri("/face"), faceapi.nets.faceLandmark68TinyNet.loadFromUri("/face"), faceapi.nets.faceRecognitionNet.loadFromUri("/face")]);
    return faceapi;
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

export interface FaceRead {
  descriptor: number[];
  /** Where the face is, as a share of the frame (0 to 1). */
  box: { x: number; y: number; w: number; h: number };
  score: number;
  faces: number;
}

/** Reads the most prominent face in the video, or null if there isn't a clear one. */
export async function readFace(video: HTMLVideoElement): Promise<FaceRead | null> {
  const faceapi = await loadFace();
  if (!video.videoWidth) return null;
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const all = await faceapi.detectAllFaces(video, opts).withFaceLandmarks(true).withFaceDescriptors();
  if (!all.length) return null;
  const best = all.sort((a, b) => b.detection.box.area - a.detection.box.area)[0]!;
  const b = best.detection.box;
  return { descriptor: Array.from(best.descriptor), box: { x: b.x / video.videoWidth, y: b.y / video.videoHeight, w: b.width / video.videoWidth, h: b.height / video.videoHeight }, score: best.detection.score, faces: all.length };
}

/** A small JPEG of the current frame, for the punch record. */
export function snapshot(video: HTMLVideoElement, width = 320) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = Math.round((video.videoHeight / video.videoWidth) * width) || width;
  c.getContext("2d")!.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

/** Opens the front camera. */
export async function openCamera(video: HTMLVideoElement) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return () => stream.getTracks().forEach((t) => t.stop());
}

export const cameraError = (e: unknown) =>
  e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")
    ? "The camera is blocked. Allow camera access for this site in the browser settings, then reload."
    : e instanceof DOMException && e.name === "NotFoundError"
      ? "No camera found on this device."
      : "Couldn't start the camera or load the face models. Check the connection and reload.";
