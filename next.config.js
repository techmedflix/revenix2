/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: { serverComponentsExternalPackages: ['@prisma/client', 'bcryptjs', 'unpdf'] },
}
module.exports = nextConfig
