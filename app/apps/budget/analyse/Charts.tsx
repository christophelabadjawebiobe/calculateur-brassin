'use client';
// app/apps/budget/analyse/Charts.tsx : graphiques SVG (barres groupées, anneau, courbes) aux couleurs de La Badjawe.
// Aucune dépendance externe ; les valeurs sont formatées par la fonction `fmt` reçue (appelée seulement après le chargement des données côté client).
import React from 'react';

export const C = { night: '#012735', gold: '#D6AD00', slate: '#4A626C', green: '#2F6B3C', red: '#A22E22', grid: 'rgba(1,39,53,0.12)' };

/** graduations « rondes » entre min et max */
export function niceTicks(min: number, max: number, n = 5): number[] {
  if (!(max > min)) { max = min + 1; }
  const span = max - min, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m: number) => m * mag).find((s: number) => s >= raw) || raw;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
const short = (n: number): string => { const a = Math.abs(n); const s = n < 0 ? '−' : ''; return a >= 1e6 ? s + (a / 1e6).toFixed(1).replace('.', ',') + ' M' : a >= 1e3 ? s + Math.round(a / 1e3) + ' k' : s + Math.round(a); };

export type Serie = { name: string; color: string; values: number[]; dash?: string };

export function GroupedBars({ labels, series, fmt, title }: { labels: string[]; series: Serie[]; fmt: (n: number) => string; title: string }) {
  const W = 640, H = 300, L = 54, R = 12, T = 18, B = 34;
  const all = series.flatMap((s: Serie) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const gw = (W - L - R) / labels.length, bw = Math.min(40, (gw * 0.8) / series.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="pj-svg">
      <title>{title}</title>
      {ticks.map((t: number) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.night : C.grid} strokeWidth={t === 0 ? 1.2 : 1} /><text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={C.slate}>{short(t)}</text></g>)}
      {labels.map((lb: string, i: number) => (
        <g key={lb}>
          {series.map((s: Serie, j: number) => {
            const v = s.values[i], x = L + gw * i + (gw - bw * series.length) / 2 + bw * j, y0 = y(0), y1 = y(v);
            return (
              <g key={s.name}>
                <rect x={x + 1} y={Math.min(y0, y1)} width={bw - 2} height={Math.max(1, Math.abs(y1 - y0))} fill={s.color} rx={2}><title>{`${lb} · ${s.name} : ${fmt(v)}`}</title></rect>
                <text x={x + bw / 2} y={v >= 0 ? y1 - 4 : y1 + 12} textAnchor="middle" fontSize="10" fill={C.night}>{short(v)}</text>
              </g>
            );
          })}
          <text x={L + gw * i + gw / 2} y={H - 12} textAnchor="middle" fontSize="12" fontWeight="600" fill={C.night}>{lb}</text>
        </g>
      ))}
    </svg>
  );
}

export function LineChart({ labels, series, fmt, title }: { labels: string[]; series: Serie[]; fmt: (n: number) => string; title: string }) {
  const W = 640, H = 300, L = 54, R = 24, T = 18, B = 34;
  const all = series.flatMap((s: Serie) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(...all, 1));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const x = (i: number) => (labels.length === 1 ? (L + W - R) / 2 : L + 30 + ((W - L - R - 60) * i) / (labels.length - 1));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="pj-svg">
      <title>{title}</title>
      {ticks.map((t: number) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.night : C.grid} /><text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={C.slate}>{short(t)}</text></g>)}
      {series.map((s: Serie, si: number) => (
        <g key={s.name}>
          <polyline fill="none" stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dash} points={s.values.map((v: number, i: number) => `${x(i)},${y(v)}`).join(' ')} />
          {s.values.map((v: number, i: number) => (
            <g key={i}><circle cx={x(i)} cy={y(v)} r={4.5} fill={s.color} stroke="#fff" strokeWidth={1.5}><title>{`${labels[i]} · ${s.name} : ${fmt(v)}`}</title></circle>
              <text x={x(i)} y={y(v) + (si === 0 ? -9 : 16)} textAnchor="middle" fontSize="10.5" fill={s.color === C.gold ? '#7A6100' : s.color} fontWeight="600">{short(v)}</text></g>
          ))}
        </g>
      ))}
      {labels.map((lb: string, i: number) => <text key={lb} x={x(i)} y={H - 12} textAnchor="middle" fontSize="12" fontWeight="600" fill={C.night}>{lb}</text>)}
    </svg>
  );
}

export type Part = { label: string; value: number; color: string };
export function Doughnut({ parts, big, small, title }: { parts: Part[]; big: string; small: string; title: string }) {
  const S = 220, c = S / 2, ro = 92, ri = 58;
  const pos = parts.map((p: Part) => ({ ...p, value: Math.max(0, p.value) })); const tot = pos.reduce((a: number, p: Part) => a + p.value, 0);
  let a0 = -Math.PI / 2;
  const arcs = tot > 0 ? pos.filter((p: Part) => p.value > 0).map((p: Part) => {
    const frac = p.value / tot, a1 = a0 + Math.min(frac, 0.99999) * 2 * Math.PI;
    const pt = (r: number, a: number) => `${c + r * Math.cos(a)} ${c + r * Math.sin(a)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d = `M ${pt(ro, a0)} A ${ro} ${ro} 0 ${large} 1 ${pt(ro, a1)} L ${pt(ri, a1)} A ${ri} ${ri} 0 ${large} 0 ${pt(ri, a0)} Z`;
    a0 = a1; return { p, d, frac };
  }) : [];
  return (
    <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={title} className="pj-donut">
      <title>{title}</title>
      {tot <= 0 ? <circle cx={c} cy={c} r={(ro + ri) / 2} fill="none" stroke={C.grid} strokeWidth={ro - ri} /> : null}
      {arcs.map((a) => <path key={a.p.label} d={a.d} fill={a.p.color} stroke="#fff" strokeWidth={1.5}><title>{`${a.p.label} : ${Math.round(a.frac * 100)} %`}</title></path>)}
      <text x={c} y={c - 2} textAnchor="middle" fontSize="22" fontWeight="700" fill={C.night}>{big}</text>
      <text x={c} y={c + 16} textAnchor="middle" fontSize="11" fill={C.slate}>{small}</text>
    </svg>
  );
}

export const CH_CSS = `
.pj-svg{width:100%;height:auto;display:block}
.pj-donut{width:100%;max-width:230px;height:auto;display:block;margin:0 auto}
.pj-lg{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--muted);margin-top:6px}
.pj-lg i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-2px}
`;
