'use client';
// app/apps/cooperateurs/ui.tsx : briques d'interface partagées (fenêtre modale, badge copiable) et styles aux couleurs de La Badjawe
import React, { useEffect, useState } from 'react';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="co-ovl" onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={'co-box' + (wide ? ' wide' : '')}>
        <div className="co-box-h"><h2>{title}</h2><button type="button" className="co-btn sm" onClick={onClose} aria-label="Fermer">✕</button></div>
        <div className="co-box-b">{children}</div>
      </div>
    </div>
  );
}

/** Badge copiable en un clic (référence de virement) */
export function CopyBadge({ text, onCopied }: { text: string; onCopied?: (t: string) => void }) {
  const [ok, setOk] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch { /* ignoré */ } t.remove(); }
    setOk(true); if (onCopied) onCopied(text); setTimeout(() => setOk(false), 1500);
  };
  return <button type="button" className={'co-ref' + (ok ? ' ok' : '')} onClick={copy} title="Copier la référence de virement">{ok ? '✓ Copié' : text}</button>;
}

/** Ouvre un document HTML imprimable (feuille de présence AG) dans un nouvel onglet : « Enregistrer en PDF » depuis la boîte d'impression */
export function ouvrirImpression(titre: string, corps: string): boolean {
  const w = window.open('', '_blank'); if (!w) return false;
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${titre}</title><style>
  @page{size:A4 landscape;margin:12mm}body{font:12px/1.4 system-ui,sans-serif;color:#012735}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 10px}
  table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:5px 8px;text-align:left}th{background:#EDF0E6}td.n{text-align:right}tr{page-break-inside:avoid}td.sig{width:34%}
  </style></head><body>${corps}<script>window.onload=function(){setTimeout(function(){window.print()},200)}<\/script></body></html>`);
  w.document.close(); return true;
}
export const echapper = (s: unknown): string => String(s == null ? '' : s).replace(/[&<>"']/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);

export const CO_CSS = `
.co-root{background:var(--bg);color:var(--ink);font-family:var(--font-body,'IBM Plex Sans',sans-serif);min-height:calc(100vh - 90px)}
.co-main{max-width:1320px;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:12px}
.co-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.co-bar input[type=search],.co-bar input[type=text],.co-bar select,.co-f input,.co-f select,.co-f textarea{height:36px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);padding:0 10px;font:inherit}
.co-f textarea{height:auto;padding:8px 10px}
.co-bar input[type=search]{min-width:240px;flex:1;max-width:380px}
.co-btn{height:34px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);padding:0 12px;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
.co-btn:hover:not(:disabled){background:var(--accent-soft);border-color:var(--brand-2)}
.co-btn:disabled{opacity:.5;cursor:not-allowed}
.co-btn.primary{background:var(--brand);border-color:var(--brand);color:#fff;font-weight:600}
.co-btn.primary:hover:not(:disabled){background:var(--brand);filter:brightness(1.2)}
.co-btn.gold{background:var(--brand-2);border-color:var(--brand-2);color:var(--brand);font-weight:700}
.co-btn.danger{color:var(--bad)}
.co-btn.sm{height:28px;padding:0 9px;font-size:12px}
.co-btn.ghost{border-color:transparent;background:transparent;color:var(--muted)}
.co-btn:focus-visible,.co-ref:focus-visible,.co-tab:focus-visible,.co-bar input:focus-visible,.co-bar select:focus-visible,.co-f input:focus-visible,.co-f select:focus-visible,.co-f textarea:focus-visible{outline:2px solid var(--brand-2);outline-offset:1px}
.co-chip{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;background:var(--surface-2);color:var(--muted);white-space:nowrap}
.co-chip.ok{background:var(--good-soft);color:var(--good)}.co-chip.warn{background:var(--warn-soft);color:var(--warn)}.co-chip.bad{background:var(--bad-soft);color:var(--bad)}.co-chip.gold{background:var(--accent-soft);color:var(--accent-text)}.co-chip.sim{background:#e8e3f7;color:#4b3b8c}
.co-wrap{background:var(--surface);border:1px solid var(--line);border-radius:8px;overflow:auto;max-height:70vh}
.co-tbl{border-collapse:collapse;width:100%;font-size:13px}
.co-tbl th{position:sticky;top:0;z-index:2;background:var(--brand);color:#fff;text-align:left;font-weight:600;font-size:12px;padding:8px 10px;border-bottom:2px solid var(--brand-2);white-space:nowrap}
.co-tbl th.n,.co-tbl td.n{text-align:right;font-variant-numeric:tabular-nums}
.co-tbl td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.co-tbl tr.sel{cursor:pointer}.co-tbl tr.sel:hover td{background:var(--accent-soft)}
.co-tbl tr.locked td{background:#eef0ec;color:#6b7b82}
.co-tbl tr.locked .co-ref{opacity:.7}
.co-ref{border:1px dashed var(--brand-2);background:var(--accent-soft);color:var(--brand);border-radius:4px;padding:2px 8px;font:inherit;font-family:var(--font-mono,monospace);font-size:12px;cursor:copy;text-align:left}
.co-ref.ok{background:var(--good-soft);border-color:var(--good);color:var(--good)}
.co-sub{display:block;color:var(--muted);font-size:12px}
.co-acts{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.co-fs{border:1px solid var(--line);border-radius:6px;margin:0 0 10px;padding:8px 12px;display:flex;flex-direction:column;gap:6px}.co-fs legend{font-weight:600;font-size:13px;padding:0 6px;color:var(--brand)}
.co-chk{display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer}.co-chk input{width:16px;height:16px;accent-color:var(--brand)}
.co-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
.co-kpi{background:var(--surface);border:1px solid var(--line);border-top:4px solid var(--brand-2);border-radius:8px;padding:12px 14px}
.co-kpi b{display:block;font-size:24px;font-variant-numeric:tabular-nums;color:var(--brand)}.co-kpi span{font-size:12px;color:var(--muted)}
.co-card{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:14px 16px}
.co-card h2{margin:0 0 8px;font-size:17px;color:var(--brand)}
.co-hint{color:var(--muted);font-size:12px;margin:0}
.co-msg{border-radius:6px;padding:9px 12px;font-size:13px}.co-msg.ok{background:var(--good-soft);color:var(--good)}.co-msg.bad{background:var(--bad-soft);color:var(--bad)}.co-msg.info{background:var(--accent-soft);color:var(--accent-text)}
.co-ovl{position:fixed;inset:0;z-index:90;background:rgba(1,39,53,.6);display:flex;align-items:center;justify-content:center;padding:16px}
.co-box{background:var(--surface);border-top:4px solid var(--brand-2);border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.3);width:100%;max-width:520px;max-height:92vh;display:flex;flex-direction:column}
.co-box.wide{max-width:900px}
.co-box-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line)}.co-box-h h2{margin:0;font-size:18px}
.co-box-b{padding:14px 16px;overflow:auto;display:flex;flex-direction:column;gap:10px}
.co-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.co-f{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:var(--muted)}
.co-f small{font-weight:400}
.co-f input[readonly]{background:var(--surface-2)}
.co-sum{background:var(--surface-2);border-radius:6px;padding:10px 12px;font-size:13px;display:flex;flex-direction:column;gap:3px}
.co-toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:120;max-width:min(92vw,620px);padding:10px 16px;border-radius:8px;color:#fff;background:var(--brand);box-shadow:0 8px 24px rgba(0,0,0,.3);font-size:13px}
.co-toast.bad{background:var(--bad)}.co-toast.ok{background:var(--good)}
.co-tabs{display:flex;gap:2px;flex-wrap:wrap}
.co-tab{border:0;background:transparent;color:#fff;padding:8px 14px;border-radius:6px 6px 0 0;font:inherit;font-size:13px;cursor:pointer;opacity:.8}
.co-tab[aria-selected=true]{background:var(--brand-2);color:var(--brand);font-weight:700;opacity:1}
.co-tab:hover{opacity:1}
.co-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.co-card.danger{border-color:var(--bad)}
.co-btn.sm{padding:3px 8px;font-size:12px}
@media (max-width:700px){.co-main{padding:10px}.co-bar input[type=search]{min-width:0;max-width:none}}
`;
