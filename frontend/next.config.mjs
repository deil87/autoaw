/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export only for production (S3/CloudFront). In dev mode, allow
  // dynamic routes to work normally without pre-generating all param sets.
  ...(process.env.NODE_ENV === 'production' ? { output: 'export' } : {}),
  images: { unoptimized: true },
};

export default nextConfig;
