/** @type {import('next').NextPolicy} */
const nextConfig = {
  typescript: {
    // Ignore les erreurs TypeScript uniquement pendant le build de production Vercel
    ignoreBuildErrors: true,
  },
  eslint: {
    // Ignore également les avertissements d'analyse de code pendant le build
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
