const PRODUCTION_HOSTS = [
  "fast.rocksgroup.com",
  "test.m-group.com",
  "www.test.m-group.com",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: PRODUCTION_HOSTS,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
      allowedOrigins: PRODUCTION_HOSTS,
    },
  },
};

export default nextConfig;
