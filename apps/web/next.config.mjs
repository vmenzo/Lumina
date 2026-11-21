/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  compress: true,
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
  async rewrites() {
    const apiBase = process.env.INTERNAL_API_URL || 'http://api:8080';
    return [
      { source: '/api/:path*', destination: `${apiBase}/api/:path*` },
      { source: '/raw/:path*', destination: `${apiBase}/raw/:path*` },
      { source: '/webdav/:path*', destination: `${apiBase}/webdav/:path*` },
    ];
  },
};

export default nextConfig;
