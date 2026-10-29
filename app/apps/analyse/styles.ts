export const AN_CSS = `
.an-root{background:var(--bg);color:var(--ink);font-family:var(--font-body,'IBM Plex Sans',sans-serif);min-height:calc(100vh - 90px)}
.an-wrap{max-width:1360px;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:14px}
.an-alert{background:var(--accent-soft);border:1px solid var(--accent);border-radius:6px;padding:10px 14px;font-size:14px}
.an-card{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:14px 16px}
.an-card h2{font-size:16px;margin:0 0 2px}
.an-sub{font-size:12.5px;color:var(--muted);margin:0 0 10px}
.an-bar{display:flex;flex-wrap:wrap;gap:8px 10px;align-items:center}
.an-lbl{font-size:12px;color:var(--muted);font-weight:600}
.an-bar select{height:32px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);padding:0 8px;font:inherit;font-size:13px;max-width:100%}
.an-btn{appearance:none;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:4px;height:32px;padding:0 12px;cursor:pointer;font:inherit;font-size:13px;white-space:nowrap}
.an-btn.sm{height:28px;padding:0 10px;font-size:12px}
.an-btn:hover:not(:disabled){border-color:var(--muted)}
.an-btn[aria-pressed=true]{background:var(--accent-soft);border-color:var(--brand-2);font-weight:600}
.an-btn:disabled{opacity:.5;cursor:not-allowed}
.an-btn:focus-visible,.an-seg button:focus-visible{outline:2px solid var(--brand-2);outline-offset:1px}
.an-seg{display:inline-flex;border:1px solid var(--line);border-radius:4px;overflow:hidden}
.an-seg button{appearance:none;border:0;background:var(--surface);height:30px;padding:0 12px;cursor:pointer;font:inherit;font-size:13px;color:var(--ink)}
.an-seg button+button{border-left:1px solid var(--line)}
.an-seg button[aria-pressed=true]{background:var(--brand);color:#fff;font-weight:600}
.an-seg button:disabled{opacity:.45;cursor:not-allowed}
.an-switch{display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;user-select:none}
.an-switch input{appearance:none;width:34px;height:20px;border-radius:999px;background:var(--line);position:relative;cursor:pointer;margin:0;border:1px solid var(--muted)}
.an-switch input::after{content:"";position:absolute;top:1px;left:1px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s;box-shadow:0 1px 2px rgba(0,0,0,.3)}
.an-switch input:checked{background:var(--brand-2);border-color:var(--brand-2)}
.an-switch input:checked::after{transform:translateX(14px)}
.an-chip{display:inline-flex;align-items:center;gap:6px}
.an-chip i{width:10px;height:10px;border-radius:50%;display:inline-block}
.an-badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid var(--line);white-space:nowrap}
.an-badge.ok{background:var(--good-soft);color:var(--good);border-color:var(--good)} .an-badge.warn{background:var(--warn-soft);color:var(--warn);border-color:var(--warn)}
.an-kpis{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr))}
.an-kpi{background:var(--surface);border:1px solid var(--line);border-top:3px solid var(--accent);border-radius:6px;padding:12px 14px;min-width:0}
.an-kpi .l{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600}
.an-kpi .v{font-family:var(--font-mono,monospace);font-size:22px;font-weight:600;margin-top:4px;font-variant-numeric:tabular-nums;white-space:nowrap}
.an-kpi .s{font-family:var(--font-mono,monospace);font-size:12px;color:var(--muted);margin-top:2px}
.good{color:var(--good)!important}.bad{color:var(--bad)!important}
.ch{display:flex;flex-direction:column;gap:6px}
.ch-wrap{position:relative}
.ch-svg{width:100%;height:auto;display:block;touch-action:pan-y;border-radius:4px}
.ch-svg:focus-visible{outline:2px solid var(--brand-2);outline-offset:2px}
.ch-grid{stroke:var(--line);stroke-width:1}.ch-grid.zero{stroke:var(--muted)}
.ch-zero{stroke:var(--muted);stroke-width:1.2}
.ch-ax{font-size:11.5px;fill:var(--muted);font-family:var(--font-mono,monospace)}.ch-ax.on{fill:var(--ink);font-weight:700}
.ch-cross{stroke:var(--brand);stroke-width:1;stroke-dasharray:3 3;opacity:.6}
.ch-tip{position:absolute;top:8px;transform:translateX(-50%);background:var(--brand);color:#fff;border-radius:6px;padding:8px 10px;font-size:12px;min-width:170px;max-width:260px;pointer-events:none;box-shadow:0 4px 14px rgba(1,39,53,.3);z-index:2}
.ch-tip b{font-weight:600}
.ch-tr{display:flex;align-items:center;gap:6px;margin-top:3px;white-space:nowrap}
.ch-tr span{flex:1;overflow:hidden;text-overflow:ellipsis}
.ch-tr i{width:9px;height:9px;border-radius:2px;flex:0 0 auto}
.ch-tr.tot{border-top:1px solid rgba(255,255,255,.3);padding-top:3px;margin-top:5px}
.ch-legend{display:flex;flex-wrap:wrap;gap:6px}
.ch-lg{appearance:none;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--surface);border-radius:999px;height:28px;padding:0 10px;cursor:pointer;font:inherit;font-size:12px;color:var(--ink)}
.ch-lg[aria-pressed=false]{opacity:.45;text-decoration:line-through}
.ch-lg:focus-visible{outline:2px solid var(--brand-2);outline-offset:1px}
.an-scroll{overflow:auto;border:1px solid var(--line);border-radius:6px}
.an-tbl{border-collapse:separate;border-spacing:0;width:100%;font-size:13px}
.an-tbl th,.an-tbl td{padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap;text-align:right}
.an-tbl th:first-child,.an-tbl td:first-child{text-align:left;position:sticky;left:0;background:var(--surface);z-index:1}
.an-tbl thead th{background:var(--brand);color:#fff;font-weight:600;font-size:12px;position:sticky;top:0;z-index:2}
.an-tbl thead th:first-child{z-index:3;background:var(--brand)}
.an-tbl td.n{font-family:var(--font-mono,monospace);font-variant-numeric:tabular-nums}
.an-tbl tr.q td,.an-tbl tr.q th{background:var(--surface-2);font-weight:600}
.an-tbl tr.tot td,.an-tbl tr.tot th{background:var(--accent-soft);font-weight:600}
.an-tbl tr.fut td{color:var(--muted)}
.an-tbl td.sub{color:var(--muted);font-size:12px}
.an-note{font-size:12px;color:var(--muted);margin:6px 0 0}
.an-empty{padding:28px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:6px;background:var(--surface)}
.an-det{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
@media (max-width:640px){.an-wrap{padding:12px}.an-kpi .v{font-size:18px}.an-kpis{grid-template-columns:1fr 1fr}.ch-tip{min-width:140px;font-size:11px}}
`;
