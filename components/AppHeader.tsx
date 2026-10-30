// components/AppHeader.tsx : en-tête collant de la charte « La Badjawe » (utilisable côté serveur et côté client)
import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AppHeader({
  title,
  tabs,
  right,
  home = true,
}: {
  title: string;
  /** onglets propres à l'application (boutons ou liens avec la classe « site-tab ») */
  tabs?: ReactNode;
  /** éléments à droite (état de synchronisation, compte, déconnexion…) */
  right?: ReactNode;
  /** affiche le lien « Tableau de bord » */
  home?: boolean;
}) {
  return (
    <header className="site-header" id="site-header">
      <div className="site-header-in">
        <Link href="/dashboard" className="site-brand" aria-label="La Badjawe, retour au tableau de bord">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="site-logo" src="/badjawe-logo.png" alt="La Badjawe : brasserie coopérative, éleveurs de bières bio" />
          <span className="site-brand-txt">
            <span className="site-kicker">BADJAWE - BRASSERIE COOPÉRATIVE</span>
            <span className="site-title">{title}</span>
            <span className="site-sub">Éleveurs de bières bio</span>
          </span>
        </Link>
        {tabs ? <nav className="site-tabs" role="tablist" aria-label="Sections">{tabs}</nav> : <span className="site-spacer" />}
        {(right || home) && (
          <div className="site-right">
            {right}
            {home && <Link href="/dashboard" className="site-btn">Tableau de bord</Link>}
          </div>
        )}
      </div>
    </header>
  );
}
