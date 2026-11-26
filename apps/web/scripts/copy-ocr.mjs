// Copies the receipt reader (Tesseract OCR) into public/ocr so it's served from our own site:
// receipts never leave the employee's browser, and no third-party CDN is needed.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "ocr");
mkdirSync(out, { recursive: true });

const pkg = (name) => dirname(require.resolve(`${name}/package.json`));
const files = [
  [join(pkg("tesseract.js"), "dist", "worker.min.js"), "worker.min.js"],
  ...["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"].map((f) => [join(pkg("tesseract.js-core"), f), f]),
  // the integer English model: about 3 MB, good enough for printed receipts
  [join(pkg("@tesseract.js-data/eng"), "4.0.0_best_int", "eng.traineddata.gz"), "eng.traineddata.gz"],
];
for (const [from, to] of files) {
  if (!existsSync(from)) throw new Error(`Missing ${from}`);
  copyFileSync(from, join(out, to));
}
console.log(`ocr: copied ${files.length} files to public/ocr`);
