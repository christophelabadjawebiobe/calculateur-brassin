// lib/cooperateurs/certificat.ts : certificat nominatif de parts sociales (texte conforme à la maquette de Sam) et rendu PDF (pdf-lib)
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { CERT_BANDEAU_B64, CERT_SIGNATURE_1_B64, CERT_SIGNATURE_2_B64, CERT_SIGNATURE_3_B64 } from './cert-images';
import { fmtDate, fmtDateLong, groupDigits } from './numbers';

export const CERT_ACCOUNT_DEFAUT = 'BE09 0882 7254 7157';
export const SOCIETE = { nom: 'BRASSERIE COOPÉRATIVE LIÉGEOISE SCRL FS', forme: 'Société coopérative à Finalité Sociale', siege: "Siège social : Rue de Liège, 45 à 4450 LANTIN – Numéro d'entreprise : 0.890.325.386" };

export type CertInput = {
  numero: number | string; classe: string | null; nom: string; prenom: string | null; representant: string | null; civilite?: 'M.' | 'Mme' | '';
  adresse?: { rue?: string | null; numero?: string | null; ville?: string | null } | null;
  mouvements: { date: string | null; parts: number }[];
  valeurPart?: number; compte?: string; dateEmission?: string; provisoire?: boolean;
};
export type CertTexts = { numero: string; identite: string; lines: string[]; total: string; intro: string; titre: string; fait: string };

/** Textes du certificat : mêmes formulations que la maquette de Sam */
export function certificatTexts(c: CertInput): CertTexts {
  const vp = c.valeurPart || 250, compte = c.compte || CERT_ACCOUNT_DEFAUT, civ = c.civilite || '';
  const personne = !['C', 'D'].includes(c.classe || '') && !(c.representant && !c.prenom);
  const nom = personne ? [civ, c.prenom, c.nom].filter(Boolean).join(' ') : `${c.nom}${c.representant ? ', représentée par ' + c.representant : ''}`;
  let dom = ''; const a = c.adresse;
  if (a && a.ville) {
    const verbe = personne ? (civ === 'Mme' ? 'domiciliée' : civ === 'M.' ? 'domicilié' : 'domicilié(e)') : 'dont le siège est établi';
    dom = `, ${verbe} à ${a.ville}` + (a.rue ? (a.numero ? `, au numéro ${a.numero} ${a.rue}` : `, ${a.rue}`) : '');
  }
  const mv = [...c.mouvements].sort((x, y) => (x.date || '9999').localeCompare(y.date || '9999'));
  let first = true;
  const lines = mv.map((m, i) => {
    const n = Math.abs(m.parts), p = `${n} part${n > 1 ? 's' : ''}`, cap = `${groupDigits(n * vp)} €`, d = fmtDate(m.date), end = i === mv.length - 1 ? '.' : ';';
    if (m.parts < 0) return `Remboursement ou cession de ${p} pour un total de ${cap}${d ? ' le ' + d : ''}${end}`;
    const t = first ? `${p} pour un total de ${cap} versés sur le compte ${compte}${d ? ' après le ' + d : ''}${end}` : `${p} pour un total de ${cap} versés sur le même compte${d ? ' le ' + d : ''}${end}`;
    first = false; return t;
  });
  const total = mv.reduce((s, m) => s + m.parts, 0);
  return {
    numero: String(c.numero) + (c.provisoire ? ' (à attribuer)' : ''), identite: nom + dom, lines,
    intro: `est inscrit sur les registres de la Société pour les parts sociales de chacune ${vp}€ (${vp === 250 ? 'deux cent cinquante' : String(vp)} euros). Le nombre de parts émises est de :`,
    total: `Soit un total de ${total} part${total > 1 ? 's' : ''} pour une valeur de ${groupDigits(total * vp)} €.`,
    titre: 'CERTIFICAT NOMINATIF DE PARTS SOCIALES', fait: `Fait à Liège le ${fmtDateLong(c.dateEmission) || ''}`,
  };
}

const b64 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'base64'));
/** Le jeu de caractères WinAnsi des polices standard n'accepte pas tout : on remplace ce qui ne passe pas */
const win = (s: string): string => s.replace(/[  ]/g, ' ').replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—‘’“”•€…]/g, '?');

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = []; let line = '';
  for (const w of win(text).split(' ')) {
    const t = line ? line + ' ' + w : w;
    if (line && font.widthOfTextAtSize(t, size) > maxW) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

/** Dessine un certificat (A4 paysage, 842 × 595 pt) */
async function dessine(doc: PDFDocument, c: CertInput, imgs: { b: any; s1: any; s2: any; s3: any }): Promise<void> {
  const page: PDFPage = doc.addPage([842, 595]);
  const reg = await doc.embedFont(StandardFonts.TimesRoman), ital = await doc.embedFont(StandardFonts.TimesRomanItalic), bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const t = certificatTexts(c); const W = 842, M = 36; const ink = rgb(0, 0, 0.04);
  let y = 595 - 38;
  const centre = (s: string, size: number, f: PDFFont) => { const w = f.widthOfTextAtSize(win(s), size); page.drawText(win(s), { x: (W - w) / 2, y, size, font: f, color: ink }); y -= size * 1.25; };
  centre(SOCIETE.nom, 28, reg); centre(SOCIETE.forme, 18, reg); centre('*************************************', 18, reg); centre(SOCIETE.siege, 10, reg);
  y -= 2; const bh = 42, bw = bh * (1005 / 240); page.drawImage(imgs.b, { x: (W - bw) / 2, y: y - bh, width: bw, height: bh }); y -= bh + 16;
  page.drawText(win('N° du certificat : ' + t.numero), { x: M + 14, y, size: 12, font: reg, color: ink }); y -= 22;
  centre(t.titre, 20, reg); y -= 18;
  for (const l of wrap(t.identite, reg, 12, W - 2 * M)) { const w = reg.widthOfTextAtSize(l, 12); page.drawText(l, { x: (W - w) / 2, y, size: 12, font: reg, color: ink }); y -= 15; }
  y -= 10;
  for (const l of wrap(t.intro, reg, 12, W - 2 * M - 14)) { page.drawText(l, { x: M + 14, y, size: 12, font: reg, color: ink }); y -= 15; }
  y -= 4;
  const maxLines = 6; const lignes = t.lines.length > maxLines ? [...t.lines.slice(0, maxLines - 1), `(… ${t.lines.length - maxLines + 1} autres mouvements : voir le registre)`] : t.lines;
  for (const li of lignes) {
    const parts = wrap(li, reg, 12, W - 2 * M - 36);
    parts.forEach((p: string, i: number) => { if (i === 0) page.drawText('-', { x: M + 14, y, size: 12, font: reg, color: ink }); page.drawText(p, { x: M + 32, y, size: 12, font: reg, color: ink }); y -= 15; });
  }
  y -= 8; page.drawText(win(t.total), { x: M + 14, y, size: 12, font: bold, color: ink }); y -= 28;
  page.drawText('Le président', { x: M + 57, y, size: 12, font: reg, color: ink });
  page.drawText('Un administrateur', { x: M + 57 + 142, y, size: 12, font: reg, color: ink });
  page.drawText(win(t.fait), { x: M + 57 + 142 + 142, y, size: 12, font: reg, color: ink });
  const sy = 62; let x = M + 28;
  for (const [im, h] of [[imgs.s1, 57], [imgs.s2, 57], [imgs.s3, 81]] as [any, number][]) { const w = h * (im.width / im.height); page.drawImage(im, { x, y: sy, width: w, height: h }); x += w + 8; }
  const foot = "L'adhésion à la Société comporte l'engagement de se conformer aux statuts et à tous les règlements qui pourraient être établis.";
  const fw = ital.widthOfTextAtSize(foot, 8); page.drawText(foot, { x: (W - fw) / 2, y: 30, size: 8, font: ital, color: ink });
  if (c.provisoire) page.drawText('PROVISOIRE', { x: 560, y: 520, size: 18, font: bold, color: rgb(0.64, 0.18, 0.13) });
}

/** PDF d'un ou plusieurs certificats (une page A4 paysage chacun) */
export async function buildCertificatPdf(list: CertInput[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Certificat nominatif de parts sociales'); doc.setAuthor('Brasserie coopérative liégeoise SCRL FS'); doc.setCreator('La Badjawe');
  const imgs = { b: await doc.embedPng(b64(CERT_BANDEAU_B64)), s1: await doc.embedPng(b64(CERT_SIGNATURE_1_B64)), s2: await doc.embedPng(b64(CERT_SIGNATURE_2_B64)), s3: await doc.embedPng(b64(CERT_SIGNATURE_3_B64)) };
  for (const c of list) await dessine(doc, c, imgs);
  return doc.save();
}
