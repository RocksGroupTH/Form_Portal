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
