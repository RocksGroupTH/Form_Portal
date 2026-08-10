/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Auto-crop an ID-card photo to just the card using OpenCV.js: find the largest 4-point
 * contour (the card outline) then perspective-warp it to a clean, deskewed rectangle.
 * OpenCV.js is loaded lazily. Any failure — no card found, load error, or timeout —
 * returns the ORIGINAL file so the upload flow never breaks.
 */

const OPENCV_CDN = "https://docs.opencv.org/4.x/opencv.js";

let cvReady: Promise<any> | null = null;
/**
 * Load OpenCV.js from a CDN via a <script> tag (NOT a bundler import — its emscripten
 * build references Node's `fs`, which breaks Turbopack when bundled). In the browser the
 * Node branch is dead code, so a plain script tag loads cleanly.
 */
function getCv(): Promise<any> {
  if (cvReady) return cvReady;
  cvReady = new Promise<any>((resolve, reject) => {
    const w = window as any;
    const deadline = Date.now() + 12000;

    // Poll for readiness — robust against the onRuntimeInitialized timing race and the
    // async wasm init that runs after the <script> `load` event.
    const poll = () => {
      const cv = w.cv;
      if (cv && cv.Mat && typeof cv.imread === "function") return resolve(cv);
      if (Date.now() > deadline) {
        cvReady = null; // allow a later retry
        return reject(new Error("opencv init timeout"));
      }
      setTimeout(poll, 120);
    };

    if (w.cv?.Mat) return resolve(w.cv);

    if (!document.getElementById("opencv-js-cdn")) {
      const script = document.createElement("script");
      script.id = "opencv-js-cdn";
      script.src = OPENCV_CDN;
      script.async = true;
      script.onerror = () => {
        cvReady = null;
        reject(new Error("opencv load error"));
      };
      document.body.appendChild(script);
    }
    poll();
  });
  return cvReady;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

interface Pt { x: number; y: number }
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Order 4 points as [top-left, top-right, bottom-right, bottom-left]. */
function orderPoints(pts: Pt[]): [Pt, Pt, Pt, Pt] {
  const bySum = pts.slice().sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = pts.slice().sort((a, b) => a.y - a.x - (b.y - b.x));
  return [bySum[0], byDiff[0], bySum[3], byDiff[3]]; // tl, tr, br, bl
}

async function detectAndWarp(file: File): Promise<File | null> {
  const cv = await getCv();
  const bitmap = await createImageBitmap(file);

  // Detect on a downscaled copy for speed; map points back to full resolution to warp.
  const MAXW = 1400;
  const scale = bitmap.width > MAXW ? MAXW / bitmap.width : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);

  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const edged = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const cleanup: any[] = [src, gray, edged, contours, hierarchy];
  let best: any = null;

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edged, 60, 180);
    const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
    cv.dilate(edged, edged, kernel);
    kernel.delete();
    cv.findContours(edged, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const minArea = 0.15 * w * h;
    let bestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
      const area = Math.abs(cv.contourArea(approx));
      if (approx.rows === 4 && area > bestArea && area > minArea) {
        if (best) best.delete();
        best = approx;
        bestArea = area;
      } else {
        approx.delete();
      }
      cnt.delete();
    }
    if (!best) return null;

    const pts: Pt[] = [];
    for (let i = 0; i < 4; i++) {
      pts.push({ x: best.data32S[i * 2] / scale, y: best.data32S[i * 2 + 1] / scale });
    }
    best.delete();
    best = null;

    const [tl, tr, br, bl] = orderPoints(pts);
    const dstW = Math.round(Math.max(dist(br, bl), dist(tr, tl)));
    const dstH = Math.round(Math.max(dist(tr, br), dist(tl, bl)));
    if (dstW < 120 || dstH < 70) return null; // too small to be a card

    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = bitmap.width;
    fullCanvas.height = bitmap.height;
    const fctx = fullCanvas.getContext("2d");
    if (!fctx) return null;
    fctx.drawImage(bitmap, 0, 0);

    const full = cv.imread(fullCanvas);
    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, dstW, 0, dstW, dstH, 0, dstH]);
    const M = cv.getPerspectiveTransform(srcTri, dstTri);
    const out = new cv.Mat();
    cv.warpPerspective(full, out, M, new cv.Size(dstW, dstH));
    const outCanvas = document.createElement("canvas");
    cv.imshow(outCanvas, out);
    full.delete();
    srcTri.delete();
    dstTri.delete();
    M.delete();
    out.delete();

    const blob: Blob | null = await new Promise((r) => outCanvas.toBlob(r, "image/jpeg", 0.92));
    if (!blob) return null;
    const name = file.name.replace(/\.[^.]+$/, "") + "-card.jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } finally {
    if (best) best.delete();
    for (const m of cleanup) {
      try {
        m.delete();
      } catch {
        /* already freed */
      }
    }
  }
}

export async function autoCropIdCard(file: File): Promise<File> {
  try {
    const cropped = await withTimeout(detectAndWarp(file), 15000);
    return cropped ?? file;
  } catch {
    return file; // no card / load failure / timeout → keep the original
  }
}
