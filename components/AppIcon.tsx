// components/AppIcon.tsx : icônes épurées (trait 1.75, 24×24) des tuiles du tableau de bord. Sans dépendance.
import React from 'react';

export type IconName = 'chart-bar' | 'wallet' | 'calculator' | 'users' | 'grid';

const PATHS: Record<IconName, React.ReactNode> = {
  // Reporting : histogramme
  'chart-bar': (<><path d="M3 3v16a2 2 0 0 0 2 2h16" /><rect x="7" y="12" width="3" height="5" rx=".6" /><rect x="12" y="8" width="3" height="9" rx=".6" /><rect x="17" y="5" width="3" height="12" rx=".6" /></>),
  // Budget : portefeuille
  wallet: (<><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5" /><path d="M16.5 14h2.5" /></>),
  // Recette : calculatrice
  calculator: (<><rect x="4" y="2.5" width="16" height="19" rx="2.5" /><rect x="7.5" y="5.5" width="9" height="3.5" rx=".8" /><path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01" /></>),
  // Admin : utilisateurs
  users: (<><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" /><circle cx="10" cy="8" r="3.5" /><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35" /><path d="M15.5 4.65a3.5 3.5 0 0 1 0 6.7" /></>),
  grid: (<><rect x="4" y="4" width="6.5" height="6.5" rx="1.2" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" /></>),
};

export default function AppIcon({ name, size = 28 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
