// lib/xlsx-lite.ts : lecture et écriture minimales de fichiers .xlsx, sans dépendance
// (écriture : ZIP non compressé + XML ; lecture : DecompressionStream, disponible dans les navigateurs récents et Node 18+).

export type Cell = string | number | null | undefined | { v: string | number | null; s?: StyleName };
export type StyleName = 'b' | 'n' | 'bn' | 'i' | 'bi' | 'h' | 'w' | 'neg' | 'q' | 'qn';
export type SheetSpec = { name: string; rows: Cell[][]; widths?: number[]; freeze?: { cols?: number; rows?: number } };

/* ---------- ZIP (écriture, méthode « stockée ») ---------- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const enc = new TextEncoder();

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => [v & 255, (v >>> 8) & 255], u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const lh = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0)]);
    parts.push(lh, name, f.data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += lh.length + name.length + size;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0;
  for (const b of all) { out.set(b, p); p += b.length; }
  return out;
}

/* ---------- écriture ---------- */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const STYLE_ID: Record<StyleName, number> = { b: 1, n: 2, bn: 3, i: 4, bi: 5, h: 6, w: 7, neg: 8, q: 9, qn: 10 };
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]\\-#,##0.00"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FF9B2C1F"/><name val="Calibri"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF012735"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDF0E6"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF7ECBD"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="164" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(sh: SheetSpec): string {
  const rows = sh.rows.map((r, ri) => {
    const cells = r.map((c, ci) => {
      if (c == null) return '';
      const o = typeof c === 'object' ? c : { v: c };
      if (o.v == null || o.v === '') return o.s ? `<c r="${colName(ci)}${ri + 1}" s="${STYLE_ID[o.s]}"/>` : '';
      const s = o.s ? ` s="${STYLE_ID[o.s]}"` : '';
      const ref = `${colName(ci)}${ri + 1}`;
      if (typeof o.v === 'number') return isFinite(o.v) ? `<c r="${ref}"${s}><v>${o.v}</v></c>` : '';
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(o.v))}</t></is></c>`;
    }).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  const cols = sh.widths ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const fr = sh.freeze;
  const view = fr && (fr.cols || fr.rows)
    ? `<sheetViews><sheetView workbookViewId="0"><pane ${fr.cols ? `xSplit="${fr.cols}" ` : ''}${fr.rows ? `ySplit="${fr.rows}" ` : ''}topLeftCell="${colName(fr.cols || 0)}${(fr.rows || 0) + 1}" activePane="${fr.cols && fr.rows ? 'bottomRight' : fr.rows ? 'bottomLeft' : 'topRight'}" state="frozen"/></sheetView></sheetViews>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

export function writeXlsx(sheets: SheetSpec[]): Uint8Array {
  const names = sheets.map((s, i) => esc(s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Feuille' + (i + 1)));
  const files = [
    { name: '[Content_Types].xml', x: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', x: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', x: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', x: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', x: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, x: sheetXml(s) })),
  ];
  return zip(files.map((f) => ({ name: f.name, data: enc.encode(f.x) })));
}

/* ---------- lecture ---------- */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new (globalThis as any).DecompressionStream('deflate-raw');
  const stream = new Blob([data as any]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unzip(buf: Uint8Array): Promise<Record<string, Uint8Array>> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Fichier .xlsx illisible (archive ZIP introuvable)');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const out: Record<string, Uint8Array> = {};
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl));
    const lnl = dv.getUint16(lo + 26, true), lel = dv.getUint16(lo + 28, true);
    const data = buf.subarray(lo + 30 + lnl + lel, lo + 30 + lnl + lel + csize);
    out[name] = method === 0 ? data : method === 8 ? await inflateRaw(data) : new Uint8Array(0);
    p += 46 + nl + el + cl;
  }
  return out;
}
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const text = (u?: Uint8Array) => (u ? new TextDecoder().decode(u) : '');
const tText = (x: string) => { let o = ''; const re = /<t[^>]*>([\s\S]*?)<\/t>/g; let m; while ((m = re.exec(x))) o += unesc(m[1]); return o; };
const colIdx = (ref: string) => { const l = /^[A-Z]+/.exec(ref)![0]; let n = 0; for (const ch of l) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** Lit toutes les feuilles : valeurs texte ou numériques (les dates Excel restent des numéros de série) */
export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<{ name: string; rows: (string | number | null)[][] }[]> {
  const files = await unzip(data instanceof Uint8Array ? data : new Uint8Array(data));
  const shared: string[] = [];
  const ss = text(files['xl/sharedStrings.xml']);
  { const re = /<si>([\s\S]*?)<\/si>|<si\/>/g; let m; while ((m = re.exec(ss))) shared.push(m[1] ? tText(m[1]) : ''); }
  const wb = text(files['xl/workbook.xml']), rels = text(files['xl/_rels/workbook.xml.rels']);
  const relMap: Record<string, string> = {};
  { const re = /<Relationship\b[^>]*>/g; let m; while ((m = re.exec(rels))) { const id = /Id="([^"]+)"/.exec(m[0]), tg = /Target="([^"]+)"/.exec(m[0]); if (id && tg) relMap[id[1]] = tg[1]; } }
  const out: { name: string; rows: (string | number | null)[][] }[] = [];
  const re = /<sheet\b[^>]*>/g; let m;
  while ((m = re.exec(wb))) {
    const nm = /name="([^"]*)"/.exec(m[0]), rid = /r:id="([^"]+)"/.exec(m[0]);
    if (!nm || !rid || !relMap[rid[1]]) continue;
    let path = relMap[rid[1]]; path = path.startsWith('/') ? path.slice(1) : 'xl/' + path.replace(/^\.\//, '');
    const xml = text(files[path]);
    const rows: (string | number | null)[][] = [];
    const rr = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g; let r;
    while ((r = rr.exec(xml))) {
      const rn = /\br="(\d+)"/.exec(r[0]); const ri = rn ? +rn[1] - 1 : rows.length;
      const row: (string | number | null)[] = [];
      const cc = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let c;
      while ((c = cc.exec(r[1] || ''))) {
        const attrs = c[1], inner = c[2] || '';
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs); const t = /\bt="([^"]+)"/.exec(attrs);
        const idx = ref ? colIdx(ref[1]) : row.length;
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        let val: string | number | null = null;
        if (t && t[1] === 'inlineStr') val = tText(inner);
        else if (v) { if (t && t[1] === 's') val = shared[+v[1]] ?? ''; else if (t && (t[1] === 'str' || t[1] === 'e')) val = unesc(v[1]); else if (t && t[1] === 'b') val = v[1] === '1' ? 'VRAI' : 'FAUX'; else { const x = parseFloat(v[1]); val = isFinite(x) ? x : unesc(v[1]); } }
        while (row.length < idx) row.push(null);
        row[idx] = val;
      }
      while (rows.length < ri) rows.push([]);
      rows[ri] = row;
    }
    out.push({ name: unesc(nm[1]), rows });
  }
  return out;
}
