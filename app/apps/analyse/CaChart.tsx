'use client';
// app/apps/analyse/CaChart.tsx : graphiques SVG interactifs sans dépendance (courbes multi-séries et barres empilées).
// Survol / toucher : infobulle avec toutes les séries du mois ; clavier : flèches gauche/droite ; légende cliquable.
import React, { useMemo, useRef, useState } from 'react';
import { MONTHS } from '@/lib/pcmn';

export type Series = { id: string; label: string; color: string; values: (number | null)[]; dash?: boolean; width?: number; note?: string };
const nf0 = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 0 });
const compact = (v: number) => (Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString('fr-BE', { maximumFractionDigits: 1 }) + ' M' : Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('fr-BE', { maximumFractionDigits: 1 }) + ' k' : nf0.format(v));
const niceMax = (max: number) => { if (max <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(max))); const n = max / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; };

const W = 920, H = 340, ML = 62, MR = 16, MT = 14, MB = 30;

function Frame({ ymin, ymax, children, active, onMove, onLeave, onKey, label, tip }: {
  ymin: number; ymax: number; children: React.ReactNode; active: number | null; onMove: (i: number) => void; onLeave: () => void; onKey: (k: string) => void; label: string; tip: React.ReactNode;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const x = (i: number) => ML + ((W - ML - MR) / 12) * (i + 0.5);
  const y = (v: number) => MT + (H - MT - MB) * (1 - (v - ymin) / (ymax - ymin || 1));
  const ticks = Array.from({ length: 5 }, (_, i) => ymin + ((ymax - ymin) * i) / 4);
  const idxAt = (cx: number) => { const r = ref.current!.getBoundingClientRect(); const px = ((cx - r.left) / r.width) * W; return Math.max(0, Math.min(11, Math.floor(((px - ML) / (W - ML - MR)) * 12))); };
  return (
    <div className="ch-wrap">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="ch-svg" role="img" aria-label={label} tabIndex={0}
        onPointerMove={(e) => onMove(idxAt(e.clientX))} onPointerDown={(e) => onMove(idxAt(e.clientX))} onPointerLeave={onLeave} onBlur={onLeave}
        onKeyDown={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(e.key)) { e.preventDefault(); onKey(e.key); } }}>
        {ticks.map((t, i) => (
          <g key={i}><line x1={ML} x2={W - MR} y1={y(t)} y2={y(t)} className={'ch-grid' + (Math.abs(t) < 1e-9 ? ' zero' : '')} /><text x={ML - 8} y={y(t) + 4} className="ch-ax" textAnchor="end">{compact(t)}</text></g>
        ))}
        {MONTHS.map((m, i) => <text key={m} x={x(i)} y={H - 9} className={'ch-ax' + (active === i ? ' on' : '')} textAnchor="middle">{m.replace('.', '')}</text>)}
        {ymin < 0 && ymax > 0 ? <line x1={ML} x2={W - MR} y1={y(0)} y2={y(0)} className="ch-zero" /> : null}
        {children}
        {active != null ? <line x1={x(active)} x2={x(active)} y1={MT} y2={H - MB} className="ch-cross" /> : null}
      </svg>
      {active != null ? <div className="ch-tip" style={{ left: `${(x(active) / W) * 100}%` }} aria-hidden="true">{tip}</div> : null}
    </div>
  );
}

function Legend({ items, hidden, toggle }: { items: { id: string; label: string; color: string; dash?: boolean; note?: string }[]; hidden: Set<string>; toggle: (id: string) => void }) {
  return (
    <div className="ch-legend" role="group" aria-label="Séries affichées">
      {items.map((s) => (
        <button key={s.id} type="button" className="ch-lg" aria-pressed={!hidden.has(s.id)} onClick={() => toggle(s.id)} title={s.note || (hidden.has(s.id) ? 'Afficher' : 'Masquer')}>
          <svg width="26" height="10" aria-hidden="true"><line x1="1" x2="25" y1="5" y2="5" stroke={s.color} strokeWidth="3" strokeDasharray={s.dash ? '5 3' : undefined} strokeLinecap="round" /></svg>
          <span>{s.label}</span>
        </button>
      ))}
    </div>
  );
}

const eur = (v: number | null) => (v == null ? '—' : nf0.format(Math.round(v)) + ' €');

/** Courbes mensuelles superposées (réalisé, budget, N-1, autres années) */
export function LineChart({ series, label }: { series: Series[]; label: string }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<number | null>(null);
  const vis = series.filter((s) => !hidden.has(s.id));
  const { ymin, ymax } = useMemo(() => {
    let lo = 0, hi = 0;
    vis.forEach((s) => s.values.forEach((v) => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
    const m = niceMax(Math.max(hi, -lo)); return { ymin: lo < 0 ? -niceMax(-lo) : 0, ymax: hi > 0 ? m : lo < 0 ? 0 : 1 };
  }, [vis]);
  const x = (i: number) => ML + ((W - ML - MR) / 12) * (i + 0.5);
  const y = (v: number) => MT + (H - MT - MB) * (1 - (v - ymin) / (ymax - ymin || 1));
  const path = (s: Series) => { let d = '', pen = false; s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; }); return d; };
  const key = (k: string) => setActive((a) => (k === 'ArrowRight' ? Math.min(11, (a ?? -1) + 1) : k === 'ArrowLeft' ? Math.max(0, (a ?? 12) - 1) : k === 'Home' ? 0 : k === 'End' ? 11 : null));
  return (
    <div className="ch">
      <Legend items={series} hidden={hidden} toggle={(id) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n; })} />
      <Frame ymin={ymin} ymax={ymax} active={active} onMove={setActive} onLeave={() => setActive(null)} onKey={key} label={label}
        tip={active == null ? null : (<><b>{MONTHS[active]}</b>{vis.map((s) => <div key={s.id} className="ch-tr"><i style={{ background: s.color }} /><span>{s.label}</span><b>{eur(s.values[active])}</b></div>)}</>)}>
        {vis.map((s) => <path key={s.id} d={path(s)} fill="none" stroke={s.color} strokeWidth={s.width || 2.5} strokeDasharray={s.dash ? '6 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />)}
        {vis.map((s) => s.values.map((v, i) => (v == null ? null : <circle key={s.id + i} cx={x(i)} cy={y(v)} r={active === i ? 4.5 : 2.6} fill={s.color} stroke="#fff" strokeWidth="1" />)))}
      </Frame>
    </div>
  );
}

/** Barres empilées par mois (détail par sous-catégorie / canal de vente) */
export function StackedChart({ series, label }: { series: Series[]; label: string }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<number | null>(null);
  const vis = series.filter((s) => !hidden.has(s.id));
  const { ymin, ymax, tot } = useMemo(() => {
    const pos = Array(12).fill(0), neg = Array(12).fill(0);
    vis.forEach((s) => s.values.forEach((v, i) => { if (v != null) { if (v >= 0) pos[i] += v; else neg[i] += v; } }));
    return { ymax: niceMax(Math.max(...pos, 0)), ymin: Math.min(...neg) < 0 ? -niceMax(-Math.min(...neg)) : 0, tot: pos.map((p, i) => p + neg[i]) };
  }, [vis]);
  const slot = (W - ML - MR) / 12, bw = slot * 0.62;
  const x = (i: number) => ML + slot * (i + 0.5);
  const y = (v: number) => MT + (H - MT - MB) * (1 - (v - ymin) / (ymax - ymin || 1));
  const key = (k: string) => setActive((a) => (k === 'ArrowRight' ? Math.min(11, (a ?? -1) + 1) : k === 'ArrowLeft' ? Math.max(0, (a ?? 12) - 1) : k === 'Home' ? 0 : k === 'End' ? 11 : null));
  return (
    <div className="ch">
      <Legend items={series} hidden={hidden} toggle={(id) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n; })} />
      <Frame ymin={ymin} ymax={ymax} active={active} onMove={setActive} onLeave={() => setActive(null)} onKey={key} label={label}
        tip={active == null ? null : (<><b>{MONTHS[active]}</b>{vis.filter((s) => s.values[active]).map((s) => <div key={s.id} className="ch-tr"><i style={{ background: s.color }} /><span>{s.label}</span><b>{eur(s.values[active])}</b></div>)}<div className="ch-tr tot"><span>Total</span><b>{eur(tot[active])}</b></div></>)}>
        {Array.from({ length: 12 }, (_, i) => {
          let up = 0, dn = 0;
          return vis.map((s) => {
            const v = s.values[i]; if (!v) return null;
            const y0 = v >= 0 ? up : dn, y1 = y0 + v; if (v >= 0) up = y1; else dn = y1;
            return <rect key={s.id + i} x={x(i) - bw / 2} width={bw} y={Math.min(y(y0), y(y1))} height={Math.max(0.5, Math.abs(y(y0) - y(y1)))} fill={s.color} opacity={active == null || active === i ? 1 : 0.55} stroke="#fff" strokeWidth="0.6" />;
          });
        })}
      </Frame>
    </div>
  );
}
