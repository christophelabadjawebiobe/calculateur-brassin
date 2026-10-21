// app/layout.tsx : RootLayout (obligatoire en App Router : contient <html> et <body>)
import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'La Badjawe · Gestion', template: '%s · La Badjawe' },
  description: 'Applications de gestion de la Brasserie Coopérative La Badjawe',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
