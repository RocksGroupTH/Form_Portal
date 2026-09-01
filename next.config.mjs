/**
 * Origins allowed to invoke server actions (and permitted as dev origins).
 *
 * A host missing from this list has every server action from it rejected as a
 * cross-origin request — at runtime, not at build time, so the build stays green
 * and the failure only shows up once someone submits something.
 *
 * form.portal.rocksgroup.com is this app's own deployed host, added 2026-08-19
 * when it went live.
 *
 * `fast.rocksgroup.com` was removed on 2026-09-01: it is the Rocks Fast
 * sibling's host, inherited when this app was cloned from it, and this app has
 * never been served there. It only ever widened the set of origins a server
 * action would accept. The two m-group hosts stay — they are shared staging
 * addresses this app is reachable on, not the sibling's.
 */
const PRODUCTION_HOSTS = [
  "form.portal.rocksgroup.com",
  "test.m-group.com",
  "www.test.m-group.com",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: PRODUCTION_HOSTS,
  // tesseract.js loads its worker/wasm at runtime from node_modules — keep it out
  // of the server bundle so those paths resolve (free OCR for AP-3 slip verify).
  // pdf-to-img (pdfjs-dist + @napi-rs/canvas native) rasterises PDFs for OCR —
  // must stay external so the wasm/native binaries resolve at runtime.
  serverExternalPackages: ["tesseract.js", "pdf-to-img", "pdfjs-dist", "@napi-rs/canvas", "@anthropic-ai/sdk"],
  experimental: {
    // Build and static generation run on a single worker instead of one per
    // core. Slower builds, but the app never takes more than one CPU.
    cpus: 1,
    serverActions: {
      bodySizeLimit: "10mb",
      allowedOrigins: PRODUCTION_HOSTS,
    },
  },
};

export default nextConfig;
