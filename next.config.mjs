/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Ignore les vérifications strictes de type lors du build sur Vercel
    ignoreBuildErrors: true,
  },
  eslint: {
    // Ignore les avertissements linter lors du build
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
