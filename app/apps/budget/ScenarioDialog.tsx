'use client';
// app/apps/budget/ScenarioDialog.tsx : fenêtre « Nouveau scénario » / « Dupliquer le budget » (année cible + titre)
import React, { useEffect, useRef, useState } from 'react';

type Props = {
  mode: 'new' | 'dup';
  years: number[];
  defaultYear: number;
  defaultTitle: string;
  busy: boolean;
  error: string;
  from?: string;   // description du budget copié (mode « dup »)
  onSubmit: (year: number, title: string) => void;
  onClose: () => void;
};
const SUGGESTIONS = ['Atterrissage Réel', 'Budget Prudent', 'Objectif Seuil'];

export default function ScenarioDialog({ mode, years, defaultYear, defaultTitle, busy, error, from, onSubmit, onClose }: Props) {
  const [year, setYear] = useState<number>(defaultYear);
  const [title, setTitle] = useState<string>(defaultTitle);
  const first = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    first.current?.focus(); first.current?.select();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const ok = title.trim().length >= 2 && !busy;
  return (
    <div className="sc-ovl" onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-labelledby="sc-title" className="sc-box" onSubmit={(e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); if (ok) onSubmit(year, title.trim()); }}>
        <h2 id="sc-title">{mode === 'new' ? 'Nouveau scénario' : 'Dupliquer le budget'}</h2>
        <p className="bd-hint" style={{ margin: 0 }}>{mode === 'new' ? 'Crée un budget vide pour l’année et le scénario choisis.' : `Copie toutes les lignes${from ? ' de « ' + from + ' »' : ''} vers un nouveau scénario (brouillon, non verrouillé).`}</p>
        <label className="sc-f">Année cible
          <select value={year} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setYear(+e.target.value)}>{years.map((y: number) => <option key={y} value={y}>{y}</option>)}</select>
        </label>
        <label className="sc-f">Titre du scénario
          <input ref={first} type="text" maxLength={80} required value={title} placeholder="ex. Budget Prudent" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} />
        </label>
        <div className="sc-sug">{SUGGESTIONS.map((s: string) => <button key={s} type="button" className="bd-chip" onClick={() => setTitle(s)}>{s}</button>)}</div>
        {error ? <p role="alert" className="sc-err">{error}</p> : null}
        <div className="sc-act">
          <button type="button" className="bd-btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="bd-btn primary" disabled={!ok}>{busy ? 'Création…' : mode === 'new' ? 'Créer le scénario' : 'Dupliquer'}</button>
        </div>
      </form>
    </div>
  );
}

export const SC_CSS = `
.sc-ovl{position:fixed;inset:0;z-index:80;background:rgba(1,39,53,.6);display:flex;align-items:center;justify-content:center;padding:16px}
.sc-box{background:var(--surface);border-top:4px solid var(--brand-2);border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.3);width:100%;max-width:440px;padding:18px 20px;display:flex;flex-direction:column;gap:10px}
.sc-box h2{margin:0;font-size:18px}
.sc-f{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:var(--muted)}
.sc-f select,.sc-f input{height:36px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);padding:0 10px;font:inherit;font-size:14px}
.sc-f select:focus-visible,.sc-f input:focus-visible{outline:2px solid var(--brand-2);outline-offset:1px}
.sc-sug{display:flex;flex-wrap:wrap;gap:6px}
.sc-err{margin:0;background:var(--bad-soft);color:var(--bad);border-radius:4px;padding:8px 10px;font-size:13px}
.sc-act{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
`;
