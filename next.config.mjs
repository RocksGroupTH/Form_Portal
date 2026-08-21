/**
 * Origins allowed to invoke server actions (and permitted as dev origins).
 *
 * ⚠️ These are inherited from the Rocks Fast sibling — Form Portal has no host of
 * its own yet. Deployment is out of scope for this branch, so nothing has been
 * invented here: whoever deploys Form Portal MUST add its hostname to this list
 * first, or every server action from that host is rejected as a cross-origin
 * request. See CLAUDE.md → Deployment.
 */
const PRODUCTION_HOSTS = [
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
    serverActions: {
      bodySizeLimit: "10mb",
      allowedOrigins: PRODUCTION_HOSTS,
    },
  },
};

export default nextConfig;
