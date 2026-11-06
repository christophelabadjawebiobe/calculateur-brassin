'use client';
// app/apps/cooperateurs/CooperateursApp.tsx : coquille du module (en-tête, onglets, chargement, notifications)
// Hydratation : le rendu serveur ne contient que « Chargement… » ; toutes les données (dates, montants) sont chargées et formatées côté client.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppHeader from '@/components/AppHeader';
import { createClient } from '@/lib/supabase/client';
import { chargerTout, type Store } from './data';
import { CO_CSS } from './ui';
import DemandesTab from './DemandesTab';
import RegistreTab from './RegistreTab';
import MouvementsTab from './MouvementsTab';
import StatsTab from './StatsTab';
import DoublonsTab from './DoublonsTab';
import JournalTab from './JournalTab';
import AdminSettingsTab from './AdminSettingsTab';
import { masquerStore } from '@/lib/cooperateurs/demo';

type TabId = 'demandes' | 'registre' | 'mouvements' | 'doublons' | 'stats' | 'journal' | 'parametres';
const TABS: [TabId, string][] = [['demandes', 'Souscriptions & Demandes'], ['registre', 'Registre des Coopérateurs'], ['mouvements', 'Mouvements & Parts'], ['doublons', 'Doublons & Foyers'], ['stats', 'Statistiques, AG & Valorisation'], ['journal', 'Journal / Audit']];
const TAB_PARAM: [TabId, string] = ['parametres', '⚙ Paramètres'];
const TABS_ANONYME: TabId[] = ['demandes', 'registre', 'mouvements', 'stats'];   // profil « vue anonymisée » : ni doublons, ni journal, ni paramètres
export type Notify = (msg: string, kind?: 'ok' | 'bad' | 'info') => void;

export default function CooperateursApp({ canEdit }: { canEdit: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<TabId>('demandes');
  const [brut, setBrut] = useState<Store | null>(null);
  const [demo, setDemoEtat] = useState(false);
  const [erreur, setErreur] = useState('');
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: string } | null>(null);
  const timer = useRef<any>(null);

  const notify: Notify = useCallback((msg: string, kind: 'ok' | 'bad' | 'info' = 'info') => {
    setToast({ msg, kind }); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(null), kind === 'bad' ? 8000 : 4500);
  }, []);
  const reload = useCallback(async () => {
    const r = await chargerTout(supabase, canEdit);
    setBrut(r.store); setErreur(r.erreur); setReady(true);
  }, [supabase, canEdit]);
  useEffect(() => { reload(); }, [reload]);
  // Mode démo : TEMPORAIRE (administrateurs uniquement), jamais mémorisé : un rechargement de la page le désactive.
  // Le profil « vue anonymisée » n'a pas de bascule : ses données sont masquées par la base (sql/16) avant d'arriver dans le navigateur.
  const setDemo = useCallback((v: boolean) => { setDemoEtat(v); }, []);
  const anonyme = Boolean(brut && brut.anonymise);
  const demoActif = demo && !anonyme;
  const store: Store | null = useMemo(() => (brut && demoActif ? masquerStore(brut) : brut), [brut, demoActif]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onglets: [TabId, string][] = anonyme ? TABS.filter((t: [TabId, string]) => TABS_ANONYME.includes(t[0])) : brut && brut.isAdmin ? TABS.concat([TAB_PARAM]) : TABS;
  const tabs = onglets.map((t: [TabId, string]) => (
    <button key={t[0]} type="button" role="tab" id={'tb-' + t[0]} className="site-tab" aria-selected={tab === t[0]} aria-controls="co-panel" onClick={() => setTab(t[0])}>{t[1]}</button>
  ));
  const right = store ? (
    <>
      {store.isAdmin && !anonyme ? <button type="button" className={'co-btn sm' + (demoActif ? ' primary' : '')} aria-pressed={demoActif} onClick={() => setDemo(!demoActif)} title="Mode présentation temporaire : masque les données personnelles à l’écran (aucune modification en base)">🕶 Démo{demoActif ? ' : activée' : ''}</button> : null}
      <span className={'site-role' + (store.canWrite ? '' : ' ro')}>{anonyme ? 'Vue anonymisée' : demoActif ? 'Mode démo (lecture seule)' : store.canWrite ? (store.isAdmin ? 'Administrateur' : 'Écriture') : 'Lecture seule'}</span>
    </>
  ) : null;

  return (
    <div className="co-root">
      <style>{CO_CSS}</style>
      <AppHeader title="Coopérateurs" tabs={tabs} right={right} />
      <main className="co-main" id="co-panel" role="tabpanel" aria-labelledby={'tb-' + tab}>
        {!ready ? <p className="co-hint" role="status">Chargement…</p> : erreur ? <p className="co-msg bad" role="alert">{erreur}</p> : store ? (
          <>
            {anonyme ? <p className="co-msg info" role="status">🔒 Vue anonymisée : les données personnelles (noms, e-mails, téléphones, adresses, numéros) sont masquées par la base. Les montants, parts, mouvements, certificats et statistiques sont visibles ; l’application est en lecture seule.</p> : null}
            {demoActif ? <p className="co-msg info" role="status">🕶 Mode démo (temporaire) : les données personnelles sont masquées à l’écran, rien n’est modifié en base et les actions d’écriture sont désactivées. Rechargez la page ou cliquez sur « Démo » pour revenir à l’affichage normal.</p> : null}
            {tab === 'demandes' ? <DemandesTab store={store} reload={reload} notify={notify} supabase={supabase} /> : null}
            {tab === 'registre' ? <RegistreTab store={store} reload={reload} notify={notify} supabase={supabase} /> : null}
            {tab === 'mouvements' ? <MouvementsTab store={store} reload={reload} notify={notify} supabase={supabase} /> : null}
            {tab === 'doublons' ? <DoublonsTab store={store} reload={reload} notify={notify} supabase={supabase} /> : null}
            {tab === 'journal' ? <JournalTab store={store} reload={reload} notify={notify} supabase={supabase} /> : null}
            {tab === 'parametres' ? <AdminSettingsTab store={store} reload={reload} notify={notify} supabase={supabase} demo={demoActif} setDemo={setDemo} /> : null}
            {tab === 'stats' ? <StatsTab store={store} reload={reload} notify={notify} supabase={supabase} /> : null}
          </>
        ) : null}
      </main>
      {toast ? <div className={'co-toast ' + toast.kind} role="status" aria-live="polite">{toast.msg}</div> : null}
    </div>
  );
}

export type TabProps = { store: Store; reload: () => Promise<void>; notify: Notify; supabase: any };
