// Copies browser-side models into public/ so they're served from our own site, with no
// third-party CDN: the receipt reader (Tesseract OCR) into public/ocr, and the face models for
// the face kiosk into public/face. Receipts and faces never leave the device to be read.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkg = (name) => dirname(require.resolve(`${name}/package.json`));

const sets = {
  ocr: [
    [join(pkg("tesseract.js"), "dist", "worker.min.js"), "worker.min.js"],
    ...["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"].map((f) => [join(pkg("tesseract.js-core"), f), f]),
    // the integer English model: about 3 MB, good enough for printed receipts
    [join(pkg("@tesseract.js-data/eng"), "4.0.0_best_int", "eng.traineddata.gz"), "eng.traineddata.gz"],
  ],
  // finding a face, its landmarks, and the 128 number descriptor: about 6.7 MB in all
  face: ["tiny_face_detector_model", "face_landmark_68_tiny_model", "face_recognition_model"].flatMap((m) => [`${m}-weights_manifest.json`, `${m}.bin`]).map((f) => [join(pkg("@vladmandic/face-api"), "model", f), f]),
};

let n = 0;
for (const [dir, files] of Object.entries(sets)) {
  const out = join(here, "..", "public", dir);
  mkdirSync(out, { recursive: true });
  for (const [from, to] of files) {
    if (!existsSync(from)) throw new Error(`Missing ${from}`);
    copyFileSync(from, join(out, to));
    n++;
  }
}
console.log(`assets: copied ${n} files to public/ocr and public/face`);
