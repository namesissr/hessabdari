import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
};

export default nextConfig;
