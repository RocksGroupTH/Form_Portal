/**
 * Origins allowed to invoke server actions (and permitted as dev origins).
 *
 * A host missing from this list has every server action from it rejected as a
 * cross-origin request — at runtime, not at build time, so the build stays green
 * and the failure only shows up once someone submits something.
 *
 * form.portal.rocksgroup.com is this app's own deployed host, added 2026-08-19
 * when it went live. The rest are inherited from the Rocks Fast sibling and are
 * kept because both apps are built from this config lineage.
 */
const PRODUCTION_HOSTS = [
  "form.portal.rocksgroup.com",
  "fast.rocksgroup.com",
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
