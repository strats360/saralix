import { parseReceipt, todayLocal, type ReceiptGuess } from "@hrms/shared";

/**
 * Reads a receipt photo in the browser with Tesseract, served from /ocr on our own site, so the
 * image never leaves the device. The engine (about 7 MB) loads the first time it's used.
 */
export async function readReceipt(file: File, onProgress?: (p: number) => void): Promise<ReceiptGuess & { text: string }> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr",
    langPath: "/ocr",
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress?.(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(file);
    return { ...parseReceipt(data.text, todayLocal()), text: data.text };
  } finally {
    await worker.terminate();
  }
}
