// @ts-nocheck
/* eslint-disable */
'use client';
/* =====================================================================
   app/apps/calculateur/page.tsx : Calculateur de brassin (Brasserie coopérative La Badjawe)
   Composant client Next.js. Les formules de calcul (bloc CALCUL) sont reprises à l'identique
   de la version HTML ; l'interface est entièrement en React (états, pas de manipulation du DOM).
   ===================================================================== */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { createClient } from '@/lib/supabase/client';

/* ===== NOYAU DE CALCUL : repris tel quel de la version HTML (formules inchangées) ===== */
//#CORE-START
const nOrNull = v => (v!=null && v!=='' && isFinite(parseFloat(v))) ? parseFloat(v) : null;
const num = v => { v = parseFloat(v); return isFinite(v) ? v : 0; };
const FORMATS = [
  {key:'j33', label:'33 cl jetable',   long:'Bouteille 33 cl Long Neck (jetable)', size:0.33, unit:'bouteille', caseable:true},
  {key:'c33', label:'33 cl consignée', long:'Bouteille 33 cl APO (consignée)',    size:0.33, unit:'bouteille', caseable:true},
  {key:'b75', label:'75 cl',           long:'Bouteille 75 cl',                    size:0.75, unit:'bouteille', caseable:true},
  {key:'can', label:'Canette 33 cl',   long:'Canette 33 cl',                      size:0.33, unit:'canette',   caseable:true},
  {key:'keg', label:'Fût 20 L',        long:'Fût 20 L',                           size:20,   unit:'fût',       caseable:false}
];
const TABLE_OF = {j33:'b33n', c33:'b33c', b75:'b75', can:'b33n', keg:'keg20'};

function exciseAt(table, p){
  const t = (table||[]).map(r=>[num(r[0]), num(r[1])]).sort((a,b)=>a[0]-b[0]);
  if(!t.length) return 0;
  if(t.length===1) return t[0][1];
  let i = 0;
  while(i < t.length-2 && p > t[i+1][0]) i++;
  const [x0,y0] = t[i], [x1,y1] = t[i+1];
  if(x1===x0) return y0;
  return Math.max(0, y0 + (y1-y0)*(p-x0)/(x1-x0));
}
function volOf(r, s){ return (s.volumes||[]).find(v=>v.id===r.volumeId) || null; }
function netHlOf(r, s){ const v = volOf(r,s); return v ? num(v.net) : 0; }

function compute(r, s){
  const netHl = netHlOf(r,s), netL = netHl*100;
  const T = r.tech || {}, X = r.acct || {};
  const loss = Math.min(Math.max(num(T.loss),0),99.9999)/100;
  const sellHl = netHl*(1-loss), sellL = sellHl*100;
  const royaltyTotal = Math.max(0,num(X.royaltyHl))*sellHl;
  const fuelK = 1+Math.max(0,num(X.fuelPct))/100;
  const hd = num(r.hd)===1;
  const ingr = (r.ingredients||[]).map(row=>{
    const ing = s.ingredients.find(i=>i.id===row.ingId);
    const qty = num(row.qty), price = ing ? num(ing.price) : 0;
    return {ing, qty, price, cost: price*qty};
  });
  const ingrCost = ingr.reduce((a,x)=>a+x.cost,0);

  const rate = id => { const p = s.rates.find(x=>x.id===id); return p ? num(p.rate) : 0; };
  const lab = l => ({hours:num(l.hours), rate:rate(l.profile), cost:num(l.hours)*rate(l.profile)});
  const L = {brew:lab(r.labor.brew), bot1:lab(r.labor.bot1), bot2:lab(r.labor.bot2), keg:lab(r.labor.keg)};
  const extras = (r.extras||[]).map(l=>Object.assign({label:l.label}, lab(l)));
  const extraMO = extras.reduce((a,x)=>a+x.cost,0);

  const e = (s.energyHl||{})[hd?'hd':'noHd'] || {};
  const enQ = {eau:netHl*num(e.eau), elec:netHl*num(e.elec), gaz:netHl*num(e.gaz)};
  const en = {eau:enQ.eau*num(s.energy.eau), elec:enQ.elec*num(s.energy.elec), gaz:enQ.gaz*num(s.energy.gaz)};
  const energyCost = en.eau+en.elec+en.gaz;

  const forfaits = (r.forfaits||[]).map(f=>({label:f.label, amount:num(f.amount), disc:num(f.disc), net:num(f.amount)*(1-num(f.disc)/100)}));
  const forfaitTotal = forfaits.reduce((a,x)=>a+x.net,0);
  const MOI = moiCalc(s), MA = r.moiAdj || {}, moiOv = MA.perHl!=null && MA.perHl!=='' && isFinite(parseFloat(MA.perHl));
  const moiHl = moiOv ? Math.max(0,num(MA.perHl)) : Math.max(0, MOI.adj*(1+num(MA.pct)/100));   // surcharge propre à la recette
  const moiCost = netHl*moiHl;

  const mixRaw = {}; FORMATS.forEach(f=>{ mixRaw[f.key] = Math.max(0,num(r.mix[f.key])); });
  const mixTotal = FORMATS.reduce((a,f)=>a+mixRaw[f.key],0);
  const share = k => mixTotal>0 ? mixRaw[k]/mixTotal : 0;
  const botShare = share('j33')+share('c33')+share('b75');
  const kegShare = share('keg');
  const G = r.laborMode==='grid' ? laborGridCalc(r, s, share) : null;
  const botMO = G ? G.botCost+G.canCost : (botShare>0 ? L.bot1.cost+L.bot2.cost : 0);
  const kegMO = G ? G.kegCost : (kegShare>0 ? L.keg.cost : 0);
  const LF = r.laborFlat || {}, flatMode = (LF.mode==='add' || LF.mode==='replace') ? LF.mode : 'off';
  const flatMO = flatMode==='off' ? 0 : Math.max(0,num(LF.amount)), lfScale = flatMode==='replace' ? 0 : 1;   // « replace » : le forfait remplace heures x taux
  const hourlyMO = G ? G.total : L.brew.cost+botMO+kegMO;
  const moSub1 = hourlyMO*lfScale + flatMO;
  const moCost = moSub1+extraMO;

  const kOf = mm => r.marginMode==='margin' ? (mm<100 ? 1/(1-mm/100) : NaN) : 1+mm/100;
  const mgOfK = kk => r.marginMode==='margin' ? (1-1/kk)*100 : (kk-1)*100;
  const PT = r.priceTarget || {}, ptMode = (PT.mode==='batch' || PT.mode==='piece') ? PT.mode : 'off';
  const ptBatch = nOrNull(PT.batch), batchOn = ptMode==='batch' && ptBatch!=null && ptBatch>0;
  const perFmt = r.marginScheme==='perFormat';
  const k = kOf(num(r.margin));
  const vat = 1+num(s.vat)/100;
  const lg = s.logistics || {};
  const pType = (r.pallet==='euro' || r.pallet==='us') ? r.pallet : (lg.defaultPallet==='us' ? 'us' : 'euro');
  const cpp = (lg.casesPerPallet||{})[pType] || {};
  const kegCap = num((lg.kegsPerPallet||{})[pType]);
  const palletPrice = num((lg.perPallet||{})[pType]);
  const mode = r.delivery || 'case';
  const off = r.consOff || {};
  const fm = {}; let consTotal=0, taxTotal=0, delivTotal=0, casesTotal=0, palletsTotal=0, allocCost=0, priceAlloc=0, delivBaseTotal=0;

  /* consommables : montant de base (Paramètres) puis ajustement propre à la recette (coefficient ou montant imposé) */
  const consRawF = {}; let consRawTotal = 0;
  FORMATS.forEach(f=>{
    const sh0 = share(f.key), units0 = sellL*sh0/f.size, items0 = (s.consumables[f.key]||[]).filter(i=>!off[i.id]);
    const piece0 = items0.filter(i=>i.mode!=='forfait').reduce((a,i)=>a+num(i.price),0), forf0 = items0.filter(i=>i.mode==='forfait').reduce((a,i)=>a+num(i.price),0);
    consRawF[f.key] = piece0*units0 + (sh0>0 ? forf0 : 0); consRawTotal += consRawF[f.key];
  });
  const CA = r.consAdj || {}, ovOn = CA.override!=null && CA.override!=='' && isFinite(parseFloat(CA.override));
  const consTarget = ovOn ? Math.max(0,num(CA.override)) : consRawTotal*Math.max(0, CA.coef==null ? 100 : num(CA.coef))/100;
  const consK = consRawTotal>0 ? consTarget/consRawTotal : 0;
  FORMATS.forEach(f=>{
    const sh = share(f.key), liters = sellL*sh, units = liters/f.size;
    const consumables = consRawF[f.key]*consK + (consRawTotal<=0 && ovOn ? consTarget*sh : 0);
    const taxUnit = exciseAt(s.excise[TABLE_OF[f.key]], num(r.plato)) + num((s.ecotax||{})[f.key]);
    const taxes = taxUnit*units;
    const isBot = f.key==='j33'||f.key==='c33'||f.key==='b75';
    const mo = G ? ((G.brewCost+G.otherCost)*lfScale + extraMO + flatMO)*sh + G.perShare[f.key]*sh*lfScale : (L.brew.cost*lfScale + extraMO + flatMO)*sh + lfScale*((isBot && botShare>0 ? botMO*sh/botShare : 0) + (f.key==='keg' ? kegMO : 0));
    const ingrF = ingrCost*sh, energyF = energyCost*sh, forfaitF = forfaitTotal*sh, moiF = moiCost*sh;
    const perCase = f.caseable ? (num(s.perCase[f.key])||24) : 0;
    const cap = palletCap(s, pType, f);
    const blocked = units>0 && cap<=0;   // palette incompatible : aucun calcul logistique pour ce format
    const cases = (f.caseable && units>0) ? Math.ceil(units/perCase-1e-9) : 0;
    const pallets = (units>0 && !blocked) ? Math.ceil((f.caseable ? cases : units)/cap-1e-9) : 0;
    let delivB = 0;
    if(blocked) delivB = 0;
    else if(mode==='case') delivB = f.caseable ? cases*num(lg.perCase) : pallets*palletPrice;
    else if(mode==='pallet') delivB = pallets*palletPrice;
    const deliv = delivB*fuelK;
    const royaltyF = royaltyTotal*sh;
    const mg0 = perFmt ? num((r.marginFmt||{})[f.key]) : num(r.margin);
    const kf0 = kOf(mg0);
    const cost = ingrF+mo+moiF+energyF+consumables+taxes+forfaitF+deliv+royaltyF;
    const unitCost = units>0 ? cost/units : 0;
    const pp = ptMode==='piece' ? nOrNull((PT.piece||{})[f.key]) : null;
    const pieceOn = pp!=null && pp>0 && units>0;      // prix de vente imposé pour ce format (marge inverse)
    const kf = (pieceOn && unitCost>0) ? pp/unitCost : kf0;
    const mg = (pieceOn && unitCost>0) ? mgOfK(kf) : mg0;
    const unitHT = pieceOn ? pp : (units>0 ? unitCost*kf : 0);
    fm[f.key] = {share:sh, liters, units, ingr:ingrF, mo, moi:moiF, energy:energyF, consumables, taxes, forfait:forfaitF, deliv, delivBase:delivB, royalty:royaltyF, cost, pieceOn,
      taxUnit, unitCost, unitHT, unitTTC:unitHT*vat, perCase, cases, pallets, cap, blocked, k:kf, margin:mg,
      caseCost:unitCost*perCase, caseHT:unitHT*perCase, caseTTC:unitHT*perCase*vat};
    consTotal += consumables; taxTotal += taxes; delivTotal += deliv; casesTotal += cases; palletsTotal += pallets;
    allocCost += cost; delivBaseTotal += delivB; if(sh>0) priceAlloc += pieceOn ? units*pp : cost*kf;
  });
  const total = ingrCost+moCost+moiCost+energyCost+consTotal+taxTotal+forfaitTotal+delivTotal+royaltyTotal;
  const unalloc = total-allocCost;
  let priceHT = priceAlloc + (Math.abs(unalloc)>1e-9 ? unalloc*k : 0);
  if(batchOn && total>0){      // marge inverse : le prix du brassin est imposé, la marge en découle
    const kT = ptBatch/total; priceHT = ptBatch;
    FORMATS.forEach(f=>{ const x = fm[f.key]; if(x.share>0){ x.k = kT; x.unitHT = x.unitCost*kT; x.unitTTC = x.unitHT*vat; x.caseHT = x.unitHT*x.perCase; x.caseTTC = x.caseHT*vat; x.margin = mgOfK(kT); } });
  }
  const kBad = batchOn ? false : (perFmt ? FORMATS.some(f=>fm[f.key].share>0 && !isFinite(fm[f.key].k)) : !isFinite(k));
  const targetMode = batchOn ? 'batch' : (FORMATS.some(f=>fm[f.key].pieceOn) ? 'piece' : 'off');
  const og = num(T.og), fg = num(T.fg), okDens = og>1 && fg>0 && og>fg;
  const r8 = v => Math.round(v*1e8)/1e8;
  const abv = okDens ? r8((og-fg)*131.25) : null;
  const att = okDens ? r8((og-fg)/(og-1)*100) : null;
  const ogPlato = og>1 ? -616.868+1111.14*og-630.272*og*og+135.997*og*og*og : null;
  const tankDays = Math.max(0,num(T.tankDays)), referDays = Math.max(0,num(T.referDays)), days = tankDays+referDays;   // occupation globale = cuverie + chambre de refermentation
  const gross = priceHT-total;
  const depCases = fm.c33.share>0 ? fm.c33.cases : 0;
  const depKegs = fm.keg.units>0 ? Math.ceil(fm.keg.units-1e-9) : 0;
  const deposits = {caseCount:depCases, caseUnit:num(X.depositCase), caseAmt:depCases*num(X.depositCase),
    kegCount:depKegs, kegUnit:num(X.depositKeg), kegAmt:depKegs*num(X.depositKeg)};
  deposits.total = deposits.caseAmt+deposits.kegAmt;
  return {netHl, netL, sellHl, lossPct:loss*100, hd, ingr, ingrCost, L, grid:G, extras, extraMO, moSub1, flatMO, flatMode, hourlyMO, consRaw:consRawTotal, consTarget, consOv:ovOn, botMO, kegMO, moCost, en, enQ, energyCost,
    moiCost, moiHl, moiRefHl:MOI.ref, moiAdjHl:MOI.adj, moiOv, forfaits, forfaitTotal, consTotal, taxTotal, delivTotal, delivBase:delivBaseTotal, fuelTotal:delivTotal-delivBaseTotal, fuelPct:Math.max(0,num(X.fuelPct)),
    royaltyTotal, casesTotal, palletsTotal, total,
    perHl: sellHl>0 ? total/sellHl : 0, k, kBad, kEff: total>0 ? priceHT/total : k, perFmt,
    palletType:pType, palletPrice, palletBlocked:FORMATS.some(f=>fm[f.key].blocked), palletBad:FORMATS.filter(f=>fm[f.key].blocked), vat, fm, mixTotal, botShare, kegShare,
    abv, att, ogPlato, days, tankDays, referDays, gross, grossPerDay: days>0 ? gross/days : null, deposits, targetMode,
    realMarkup: total>0 ? priceHT/total-1 : null, realMarginPrice: priceHT>0 ? gross/priceHT : null,
    priceHT, priceTTC: priceHT*vat,
    priceHlHT: sellHl>0 ? priceHT/sellHl : 0, priceHlTTC: sellHl>0 ? priceHT*vat/sellHl : 0};
}
function chFactor(ch, s, d){
  d = d||0;
  if(!ch || d>8) return 1;
  const f = 1-num(ch.pct)/100;
  if(!ch.base) return f;
  return f*chFactor(s.channels.find(c=>c.id===ch.base), s, d+1);
}
function promoFactor(p){
  if(p.scheme==='5+1') return 5/6;
  if(p.scheme==='10+1') return 10/11;
  if(p.scheme==='xy'){ const x=num(p.x), y=num(p.y); return x+y>0 ? x/(x+y) : 1; }
  if(p.scheme==='pct') return 1-num(p.pct)/100;
  return 1;
}
/* énergie : historique annuel, année de référence et hausses simulées */
const FLUIDS = [['eau','Eau','m³'],['elec','Électricité','kWh'],['gaz','Gaz','m³']];
const e8 = v => Math.round(v*1e8)/1e8;
const nz = (a,b)=> b>0 ? a/b : 0;
function energyYearCalc(y, varPct){ // toutes les factures et tous les prix sont saisis et calculés en € HTVA
  const vol = Math.max(0,num(y.vol)), k = 1;
  const out = {vol, f:{}, total:0, totalAdj:0, totalBill:0, totalBillAdj:0};
  FLUIDS.forEach(([id])=>{
    const bill = num((y.bill||{})[id])/k, cons = Math.max(0,num((y.cons||{})[id])), v = num((varPct||{})[id]);
    const perHl = nz(cons,vol), price = nz(bill,cons), costHl = nz(bill,vol);
    const f = out.f[id] = {bill, cons, perHl, price, costHl, v, adjPrice:price*(1+v/100), adjCostHl:costHl*(1+v/100)};
    out.total += costHl; out.totalAdj += f.adjCostHl; out.totalBill += bill; out.totalBillAdj += bill*(1+v/100);
  });
  return out;
}
// Reporte l'année de référence (+ hausses) dans les tarifs et consommations utilisés par compute()
function energyApply(s){
  if(!s.energyUseRef) return false;
  const y = (s.energyYears||[]).find(x=>x.id===s.energyRef); if(!y) return false;
  const c = energyYearCalc(y, s.energyVar);
  FLUIDS.forEach(([id])=>{
    const f = c.f[id];
    if(f.cons>0 && f.bill>0) s.energy[id] = e8(f.adjPrice);
    if(c.vol>0){ s.energyHl.noHd[id] = e8(f.perHl); s.energyHl.hd[id] = e8(f.perHl*num((s.energyHdCoef||{})[id]||1)); }
  });
  return true;
}
// capacité d'une palette pour un format (0 = palette strictement incompatible)
function palletCap(s, type, f){ const lg = s.logistics||{}; return f.caseable ? num(((lg.casesPerPallet||{})[type]||{})[f.key]) : num((lg.kegsPerPallet||{})[type]); }
// formats utilisés par la recette pour lesquels la palette est incompatible
function palletBad(s, type, r){ return FORMATS.filter(f=>Math.max(0,num((r.mix||{})[f.key]))>0 && palletCap(s,type,f)<=0); }
/* analyse annuelle : bières permanentes + bières à façon (regroupées), marges, charges fixes, résultat */
function annualCalc(recipes, s, A){
  A = A || {}; const g = num(A.global), vols = A.vol||{}, vars = A.var||{};
  const rows = [];
  (recipes||[]).forEach(r=>{
    if(r.status!=='permanente' && r.status!=='facon') return;
    const c = compute(r,s), base = Math.max(0,num(vols[r.id])), v = num(vars[r.id]);
    const sim = Math.max(0, base*(1+g/100)*(1+v/100));
    const priceHl = c.priceHlHT, costHl = c.perHl, mHl = c.sellHl>0 ? priceHl-costHl : 0;
    rows.push({r, c, group:r.status, base, sim, v, priceHl, costHl, mHl, mPct: priceHl>0 ? mHl/priceHl : 0,
      revBase:priceHl*base, revSim:priceHl*sim, contribBase:mHl*base, contribSim:mHl*sim});
  });
  const sum = (arr,k)=>arr.reduce((a,x)=>a+x[k],0);
  const mk = arr=>{ const t = {n:arr.length, base:sum(arr,'base'), sim:sum(arr,'sim'), revBase:sum(arr,'revBase'), revSim:sum(arr,'revSim'), contribBase:sum(arr,'contribBase'), contribSim:sum(arr,'contribSim')};
    t.mHlBase = t.base>0 ? t.contribBase/t.base : 0; t.mHlSim = t.sim>0 ? t.contribSim/t.sim : 0;
    t.mPctBase = t.revBase>0 ? t.contribBase/t.revBase : 0; t.mPctSim = t.revSim>0 ? t.contribSim/t.revSim : 0; return t; };
  const perm = rows.filter(x=>x.group==='permanente'), facon = rows.filter(x=>x.group==='facon');
  const tot = mk(rows), tPerm = mk(perm), tFacon = mk(facon);
  rows.forEach(x=>{ x.shareSim = tot.sim>0 ? x.sim/tot.sim : 0; x.shareBase = tot.base>0 ? x.base/tot.base : 0;
    x.contribShareSim = tot.contribSim!==0 ? x.contribSim/tot.contribSim : 0; });
  const fixedTotal = ((A.fixed)||[]).reduce((a,f)=>a+num(f.amount),0);
  const resBase = tot.contribBase-fixedTotal, resSim = tot.contribSim-fixedTotal;
  return {rows, perm, facon, tot, tPerm, tFacon, fixedTotal, resBase, resSim,
    breakEvenBase: tot.mHlBase>0 ? fixedTotal/tot.mHlBase : null, breakEvenSim: tot.mHlSim>0 ? fixedTotal/tot.mHlSim : null};
}
/* grille des temps de main-d'œuvre : postes -> sous-tâches (temps par personne x personnes) x profil, selon Standard / HD */
const LG_ALLOC = {pack33:['j33','c33'], pack75:['b75'], packmix:['j33','c33','b75'], packcan:['can'], keg:['keg']};
function laborGridCalc(r, s, share){
  const cfg = num(r.hd)===1 ? 'hd' : 'std', ov = r.laborOv||{};
  const rate = id=>{ const p=(s.rates||[]).find(x=>x.id===id); return p ? num(p.rate) : 0; };
  const out = {cfg, sections:[], brewCost:0, botCost:0, kegCost:0, canCost:0, total:0, hours:0, perShare:{}};
  FORMATS.forEach(f=>{ out.perShare[f.key] = 0; });
  ((s.laborGrid||{}).sections||[]).forEach(sec=>{
    const alloc = LG_ALLOC[sec.use] || [];
    let active = false;
    switch(sec.use){
      case 'brew-beer': active = r.brewKind!=='soft'; break;
      case 'brew-soft': active = r.brewKind==='soft'; break;
      case 'pack33': active = share('j33')+share('c33')>0; break;
      case 'pack75': active = share('b75')>0; break;
      case 'packmix': active = !!r.mixPack && share('j33')+share('c33')+share('b75')>0; break;
      case 'packcan': active = share('can')>0; break;
      case 'keg': active = share('keg')>0; break;
    }
    const rows = (sec.tasks||[]).map(t=>{
      const c = t[cfg]||{}, o = ov[t.id]||{};
      if(t.mode==='flat'){   // forfait : montant fixe, additionné aux prestations horaires des autres sous-tâches
        const defF = Math.max(0,num(c.flat)), hasF = o.flat!=null && o.flat!=='' && isFinite(parseFloat(o.flat));
        return {t, isFlat:true, tps:0, pers:0, defH:0, hrs:0, hasOv:hasF, hasRate:false, profile:'', defProfile:'', profRate:0, rate:0, defFlat:defF, cost:hasF ? Math.max(0,num(o.flat)) : defF};
      }
      const tps = num(c.tps), pers = num(c.pers), defH = tps*pers;
      const hasH = o.hours!=null && o.hours!=='' && isFinite(parseFloat(o.hours));
      const hrs = hasH ? Math.max(0,num(o.hours)) : defH, profile = o.profile || c.profile;
      const hasR = o.rate!=null && o.rate!=='' && isFinite(parseFloat(o.rate)), profRate = rate(profile), rt = hasR ? Math.max(0,num(o.rate)) : profRate;
      return {t, tps, pers, defH, hrs, hasOv:hasH, hasRate:hasR, profile, defProfile:c.profile, profRate, rate:rt, cost:hrs*rt};
    });
    const hours = rows.reduce((a,x)=>a+x.hrs,0), cost = rows.reduce((a,x)=>a+x.cost,0);
    const res = {sec, active, rows, hours, cost};
    out.sections.push(res);
    if(!active) return;
    out.total += cost; out.hours += hours;
    if(sec.use.indexOf('brew')===0) out.brewCost += cost;
    else if(sec.use==='packcan') out.canCost += cost;
    else if(sec.use==='keg') out.kegCost += cost;
    else out.botCost += cost;
    if(alloc.length){ const tot = alloc.reduce((a,k)=>a+share(k),0); if(tot>0) alloc.forEach(k=>{ out.perShare[k] += cost/tot; }); }
  });
  { /* autre soutirage / tâche générale : propre à la recette, répartie sur tous les formats */
    const so = r.soutOther || {}, oh = Math.max(0,num(so.hours)), orate = rate(so.profile), ocost = oh*orate;
    out.other = {hours:oh, profile:so.profile, rate:orate, cost:ocost}; out.otherCost = ocost; out.total += ocost; out.hours += oh;
  }
  return out;
}
/* main-d'œuvre indirecte : masse salariale indirecte / volume annuel, puis variation (inflation) */
function moiCalc(s){
  const m = s.moi || {}, vol = num(m.volume), ref = vol>0 ? Math.max(0,num(m.payroll))/vol : 0;
  return {ref, adj:Math.max(0, ref*(1+num(m.varPct)/100))};
}
//#CORE-END

/* ---------- utilitaires ---------- */
const uid = ()=>Math.random().toString(36).slice(2,9);
const clone = o=>JSON.parse(JSON.stringify(o));
const slug = s=>String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const nfCache = {};
const nf = d=>nfCache[d]||(nfCache[d]=new Intl.NumberFormat('fr-BE',{minimumFractionDigits:d,maximumFractionDigits:d}));
const eur = (v,d=4)=> (v==null||!isFinite(v)) ? '—' : nf(d).format(v)+' €';
const fx = new Intl.NumberFormat('fr-BE',{minimumFractionDigits:2,maximumFractionDigits:4});
const fnum = (v,d)=> (v==null||!isFinite(v)) ? '—' : (d==null ? fx : nf(d)).format(v);
const pct = v => (v==null||!isFinite(v)) ? '' : nf(2).format(v*100)+' %';
const plural = (n,w)=> w+(n>=2?'s':'');
const pad2 = n=>String(n).padStart(2,'0');
const todayIso = ()=>{ const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth()+1)}-${pad2(t.getDate())}`; };
const fmtDate = iso=>{ const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso||'—'); };

const CATS = [
  {id:'malts', label:'Céréales & malts'},
  {id:'houblons', label:'Houblons & épices'},
  {id:'divers', label:'Levures, sucres & ingrédients divers'}
];
const BASE_RATES = ['brasseur','etudiant','coop'];
const STATUSES = [['permanente','Bière permanente'],['facon','Bière à façon'],['simulation','Simulation / Devis'],['experimentale','Expérimentale']];
const statusLabel = r => (STATUSES.find(([k])=>k===r.status)||STATUSES[2])[1];
function defaultAnnual(){ return {vol:{}, var:{}, global:0, fixed:[{id:'f1',name:'Personnel',amount:0},{id:'f2',name:'Frais généraux',amount:0},{id:'f3',name:'Amortissements',amount:0},{id:'f4',name:'Marketing',amount:0}]}; }
function mergeAnnual(a){
  const d = defaultAnnual(); if(!a || typeof a!=='object') return d;
  return {vol:Object.assign({}, a.vol||{}), var:Object.assign({}, a.var||{}), global:num(a.global),
    fixed: Array.isArray(a.fixed) ? a.fixed.map(f=>({id:f.id||uid(), name:String(f.name||''), amount:num(f.amount)})) : d.fixed};
}
const PALLETS = {euro:{label:'Palette Euro 80×120', short:'Euro'}, us:{label:'Palette Américaine 100×120', short:'Américaine'}};
const PALLET_OPTS = [['euro',PALLETS.euro.label],['us',PALLETS.us.label]];
const PRESET_FORFAITS = [['Création recette',400],['Visuel étiquette',450],['Frais administratifs',100]];


/* ---------- données par défaut ---------- */
/* matrice des tâches standard : temps de référence + profil par défaut ; « role » relie la tâche à une ligne de la recette */
const TASK_ROLES = [['','Prestation à ajouter à la demande'],['brew','Ligne « Brassage / Emballage »'],['bot1','Ligne « Soutirage bouteilles · aidant 1 »'],['bot2','Ligne « Soutirage bouteilles · aidant 2 »'],['keg','Ligne « Soutirage fûts »']];
function defaultTasks(){ return [
  {id:'t-brew', name:'Brassage / Emballage', hours:8, profile:'brasseur', role:'brew'},
  {id:'t-bot1', name:'Soutirage bouteilles (aidant 1)', hours:6, profile:'brasseur', role:'bot1'},
  {id:'t-bot2', name:'Soutirage bouteilles (aidant 2)', hours:6, profile:'etudiant', role:'bot2'},
  {id:'t-keg', name:'Soutirage fûts', hours:2, profile:'brasseur', role:'keg'},
  {id:'t-cip', name:'Nettoyage / CIP', hours:2, profile:'etudiant', role:''},
  {id:'t-adm', name:'Administratif / Logistique', hours:2, profile:'brasseur', role:''}]; }
const taskByRole = (s,role)=> (s.tasks||[]).find(t=>t.role===role) || null;
function applyTaskDefaults(r,s){ ['brew','bot1','bot2','keg'].forEach(k=>{ const t = taskByRole(s,k); if(t){ r.labor[k].hours = num(t.hours); r.labor[k].profile = t.profile; } }); const lf = s.laborFlat || {}; r.laborFlat = {mode:['add','replace'].includes(lf.mode)?lf.mode:'off', amount:Math.max(0,num(lf.amount))}; return r; }
function defaultLaborGrid(){
  const T = (id,name,tps,pers,profile,tpsHd,persHd,profileHd)=>({id, name, mode:'hourly', std:{tps,pers,profile,flat:0}, hd:{tps:tpsHd==null?tps:tpsHd, pers:persHd==null?pers:persHd, profile:profileHd||profile, flat:0}});
  const pack = (use,id,label,fmt)=>({id, use, name:label, tasks:[
    T(id+'-1','Confection carton',use==='packmix'||use==='packcan'?0:6,1,'etudiant'), T(id+'-2','Préparation soutirage',use==='packmix'||use==='packcan'?0:1,1,'brasseur'),
    T(id+'-3',fmt,use==='packmix'||use==='packcan'?0:4,1,'brasseur'), T(id+'-4','Nettoyage soutireuse',use==='packmix'||use==='packcan'?0:0.5,1,'brasseur'), T(id+'-5','Suivi administratif',use==='packmix'||use==='packcan'?0:0.5,1,'brasseur')]});
  return {sections:[
    {id:'s-brew', use:'brew-beer', name:'Brassage bière classique', tasks:[T('b-1','Lancement chaudière / concassage',0.5,1,'brasseur'),T('b-2','Temps de brassage (palier, filtration, ébullition…)',7.3,1,'brasseur'),T('b-3','Post-brassage',0.5,1,'brasseur'),T('b-4','Nettoyage salle de brassage',4.4,1,'brasseur'),T('b-5','Suivi administratif du brassin',0.5,1,'brasseur')]},
    {id:'s-soft', use:'brew-soft', name:'Brassage Soft', tasks:[T('f-1','Lancement',1,1,'brasseur'),T('f-2','Chauffe / macération',4.5,1,'brasseur'),T('f-3','Post-brassage',1,1,'brasseur'),T('f-4','Nettoyage',1,1,'brasseur'),T('f-5','Suivi administratif',0.5,1,'brasseur')]},
    pack('pack33','s-33','Cartons de 33 cl','Soutirage 33 cl'), pack('pack75','s-75','Cartons de 75 cl','Soutirage 75 cl'),
    pack('packmix','s-mix','Cartons Mix 33 cl et 75 cl','Soutirage Mix'), pack('packcan','s-can','Cartons Canettes 33 cl','Soutirage canettes'),
    {id:'s-keg', use:'keg', name:'Préparation et soutirage fûts 20 L', tasks:[T('k-1','Préparation',0.5,1,'brasseur'),T('k-2','Soutirage fûts',1,1,'brasseur'),T('k-3','Nettoyage mise en fût',0.25,1,'brasseur'),T('k-4','Suivi administratif',0.25,1,'brasseur'),T('k-5','Divers (déplacement)',0,1,'brasseur')]}
  ]};
}
function mergeLaborGrid(g){
  const d = defaultLaborGrid();
  if(!g || !Array.isArray(g.sections)) return d;
  const cfg = c=>({tps:num((c||{}).tps), pers:num((c||{}).pers), profile:String((c||{}).profile||''), flat:Math.max(0,num((c||{}).flat))});
  const secs = g.sections.filter(x=>x && LG_ALLOC_USES.includes(x.use)).map(sec=>({id:sec.id||uid(), use:sec.use, name:String(sec.name||''), tasks:(Array.isArray(sec.tasks)?sec.tasks:[]).map(t=>({id:t.id||uid(), name:String(t.name||''), mode:t.mode==='flat'?'flat':'hourly', std:cfg(t.std), hd:cfg(t.hd)}))}));
  { /* anciennes valeurs de départ du brassage bière (1 / 4,5 / 1 / 1 / 0,5 h) jamais modifiées : on applique les nouvelles références */
    const sb = secs.find(x=>x.use==='brew-beer'), OLD = [1,4.5,1,1,0.5];
    if(sb && sb.tasks.length===5 && sb.tasks.every((t,i)=>t.id==='b-'+(i+1) && t.std.tps===OLD[i] && t.hd.tps===OLD[i] && t.std.pers===1 && t.hd.pers===1)){
      const nd = d.sections.find(x=>x.use==='brew-beer'); sb.tasks.forEach((t,i)=>{ t.name = nd.tasks[i].name; t.std.tps = nd.tasks[i].std.tps; t.hd.tps = nd.tasks[i].hd.tps; });
    }
  }
  d.sections.forEach(ds=>{ if(!secs.some(x=>x.use===ds.use)) secs.push(ds); });
  secs.sort((a,b)=>LG_ALLOC_USES.indexOf(a.use)-LG_ALLOC_USES.indexOf(b.use));
  return {sections:secs};
}
const LG_ALLOC_USES = ['brew-beer','brew-soft','pack33','pack75','packmix','packcan','keg'];
function defaultSettings(){
  const ing = (cat,name,price)=>({id:slug(name),cat,name,price});
  return {
    vat:21,
    rates:[
      {id:'brasseur', name:'Brasseur / Ouvrier', rate:35},
      {id:'etudiant', name:'Étudiant', rate:20},
      {id:'coop', name:'Coopérateur (bénévolat)', rate:0}
    ],
    tasks:defaultTasks(),
    laborGrid:defaultLaborGrid(),
    laborFlat:{mode:'off', amount:0},
    moi:{year:2025, payroll:0, volume:0, varPct:0},
    energy:{elec:0.4319, gaz:2.7505, eau:5.5},
    energyHl:{noHd:{eau:0.6, elec:2.244, gaz:0.107}, hd:{eau:0.7, elec:2.244, gaz:0.107}},
    // historique annuel : l'année 2025 d'exemple reproduit les tarifs et consommations d'origine (à remplacer par vos factures)
    energyYears:[{id:'y2025', year:2025, example:true, vol:1000, bill:{eau:3300, elec:969.1836, gaz:294.3035}, cons:{eau:600, elec:2244, gaz:107}}],
    energyRef:'y2025', energyUseRef:true, energyHtva:true,
    energyVar:{eau:0, elec:0, gaz:0}, energyHdCoef:{eau:7/6, elec:1, gaz:1},
    volumes:[{id:'v10',label:'10 hl',net:9.8,hd:0},{id:'v20',label:'20 hl standard',net:19.6,hd:0},{id:'v20hd',label:'20 hl HD',net:17.0,hd:1}],
    logistics:{defaultPallet:'euro', perCase:0, perPallet:{euro:0, us:0}, kegsPerPallet:{euro:20, us:25},
      casesPerPallet:{euro:{j33:60, c33:50, b75:50, can:80}, us:{j33:75, c33:62, b75:62, can:100}}},
    ingredients:[
      ing('malts','Pilsen',1.22), ing('malts','Pale',1.07), ing('malts','Biscuit',1.23), ing('malts','Cara',1.21),
      ing('malts','Munich',1.08), ing('malts','Ruby',1.82), ing('malts','MRoost',1.31), ing('malts','Froment',0.65),
      ing('malts','Avoine',3.68), ing('malts','Seigle',0.79), ing('malts','Épeautre',1.30),
      ing('houblons','Centenial',27), ing('houblons','Challenger',28), ing('houblons','Pilgrim',26),
      ing('houblons','Goldings',28), ing('houblons','Cascade',25), ing('houblons','Piment',7.5), ing('houblons','Rhubarbe',3),
      ing('divers','Levure US05',104), ing('divers','Kveik',176), ing('divers','Verdant',176),
      ing('divers','Novalager',210), ing('divers','F02',128), ing('divers','Sucre inverti',2.36), ing('divers','Prod. Entretien',0.02)
    ],
    excise:{
      b75:[[6,0.1508],[8,0.1770],[10,0.2047],[12,0.2295],[14,0.2558],[18,0.3075]],
      b33n:[[10,0.0894],[14,0.1125],[18,0.1353]],
      b33c:[[10,0.0627],[14,0.0860],[18,0.1082]],
      keg20:[[6,2.37],[8,3.08],[10,3.76],[12,4.46],[14,5.16],[18,6.56]]
    },
    ecotax:{b75:0.0695, j33:0.0243, c33:0, can:0.0037, keg:0},
    perCase:{j33:24, c33:24, b75:24, can:24},
    consumables:{
      j33:[{id:'j1',name:'Bouteille',price:0.13,mode:'piece'},{id:'j2',name:'Étiquette',price:0.04,mode:'piece'},{id:'j3',name:'Capsule',price:0.01,mode:'piece'},{id:'j4',name:'Carton',price:0.02,mode:'piece'}],
      c33:[{id:'c1',name:'Bouteille',price:0.14,mode:'piece'},{id:'c2',name:'Étiquette lavable',price:0.09,mode:'piece'},{id:'c3',name:'Capsule',price:0.01,mode:'piece'},{id:'c4',name:'Casier',price:0.03,mode:'piece'},{id:'c5',name:'Frais de transport',price:70,mode:'forfait'}],
      b75:[{id:'b1',name:'Bouteille',price:0.33,mode:'piece'},{id:'b2',name:'Étiquette',price:0.04,mode:'piece'},{id:'b3',name:'Capsule',price:0.01,mode:'piece'},{id:'b4',name:'Carton',price:0.06,mode:'piece'}],
      can:[{id:'n1',name:'Canette',price:0.15,mode:'piece'},{id:'n2',name:'Prestation Cahute',price:0.14,mode:'piece'},{id:'n3',name:'Étiquette',price:0.07,mode:'piece'},{id:'n4',name:'Carton',price:0.03,mode:'piece'},{id:'n5',name:'Forfait livraison Cahute (à renseigner)',price:0,mode:'forfait'}],
      keg:[{id:'k1',name:'Étiquette',price:0.01,mode:'piece'},{id:'k2',name:'Capsule',price:0.07,mode:'piece'},{id:'k3',name:'Lavage du fût',price:3,mode:'piece'},{id:'k4',name:'Location du fût',price:2,mode:'piece'},{id:'k5',name:'Autres coûts fûts',price:0,mode:'piece'}]
    },
    channels:[
      {id:'part', name:'Particulier', base:'', pct:0},
      {id:'coop', name:'Coopérateur', base:'part', pct:10},
      {id:'pev', name:'Petit événement', base:'part', pct:15},
      {id:'gev', name:'Gros événement', base:'part', pct:20},
      {id:'horeca', name:'Horeca', base:'part', pct:22},
      {id:'pers', name:'Personnel', base:'horeca', pct:18},
      {id:'distri', name:'Distributeur', base:'horeca', pct:15}
    ]
  };
}
function blankRecipe(o){
  return Object.assign({
    id:null, name:'', example:false, status:'simulation', moiAdj:{pct:0, perHl:null}, consAdj:{coef:100, override:null}, laborFlat:{mode:'off', amount:0}, soutOther:{profile:'brasseur', hours:0}, laborMode:'grid', brewKind:'beer', mixPack:false, laborOv:{}, volumeId:'v10', hd:0, plato:12, ingredients:[], consOff:{},
    labor:{brew:{profile:'brasseur',hours:8}, bot1:{profile:'brasseur',hours:6}, bot2:{profile:'etudiant',hours:6}, keg:{profile:'brasseur',hours:2}},
    extras:[], forfaits:[], delivery:'case', pallet:'default',
    mix:{j33:100,c33:0,b75:0,can:0,keg:0}, margin:30, marginMode:'markup',
    marginScheme:'single', marginFmt:{j33:30,c33:30,b75:30,can:30,keg:30}, marginFmtSet:false,
    tech:{og:0, fg:0, efficiency:75, loss:0, tankDays:0, referDays:0},
    priceTarget:{mode:'off', batch:null, piece:{j33:null,c33:null,b75:null,can:null,keg:null}},
    trace:{client:'', code:'', version:'v1.0', revised:''},
    acct:{depositCase:0, depositKeg:0, royaltyHl:0, fuelPct:0}
  }, o||{});
}
function seedRecipes(){
  const rows = a=>a.map(([ingId,qty])=>({ingId,qty}));
  return [
    blankRecipe({id:uid(), example:true, status:'permanente', name:'Blonde 12°P', plato:12,
      ingredients:rows([['pilsen',180],['cara',10],['froment',10],['cascade',2],['challenger',1.5],['levure-us05',0.5]]),
      mix:{j33:40,c33:0,b75:30,can:0,keg:30}, margin:35,
      extras:[{label:'Nettoyage cuverie',profile:'etudiant',hours:2}],
      marginScheme:'perFormat', marginFmtSet:true, marginFmt:{j33:40,c33:35,b75:35,can:35,keg:25},
      tech:{og:1.048, fg:1.010, efficiency:75, loss:5, tankDays:21},
      trace:{client:'Taverne Tchantchès', code:'BAD-2026-001', version:'v1.0', revised:''},
      acct:{depositCase:5, depositKeg:30, royaltyHl:0, fuelPct:0}}),
    blankRecipe({id:uid(), example:true, status:'facon', name:'Triple 16°P', plato:16,
      ingredients:rows([['pilsen',250],['munich',20],['sucre-inverti',25],['pilgrim',2],['goldings',2],['f02',0.5]]),
      mix:{j33:30,c33:20,b75:50,can:0,keg:0}, margin:40,
      forfaits:[{label:'Création recette',amount:400,disc:0},{label:'Visuel étiquette',amount:450,disc:0},{label:'Frais administratifs',amount:100,disc:0}],
      tech:{og:1.065, fg:1.012, efficiency:72, loss:5, tankDays:28},
      trace:{client:'Marque partenaire', code:'BAD-2026-002', version:'v1.0', revised:''},
      acct:{depositCase:5, depositKeg:0, royaltyHl:10, fuelPct:0}}),
    blankRecipe({id:uid(), example:true, status:'facon', name:'IPA 14°P en canettes', volumeId:'v20', plato:14,
      ingredients:rows([['pale',360],['froment',30],['avoine',20],['cascade',8],['centenial',8],['verdant',1]]),
      mix:{j33:0,c33:0,b75:0,can:70,keg:30}, margin:35, pallet:'us',
      tech:{og:1.057, fg:1.011, efficiency:75, loss:4, tankDays:18},
      trace:{client:'Univers\'ale', code:'BAD-2026-003', version:'v1.1', revised:''},
      acct:{depositCase:0, depositKeg:30, royaltyHl:0, fuelPct:6}})
  ];
}
const defaultPromo = ()=>({scheme:'5+1', x:5, y:1, pct:10, channel:'part'});
function freshState(){
  const recipes = seedRecipes();
  return {v:2, settings:defaultSettings(), recipes, draft:clone(recipes[0]), selected:recipes[0].id, cmpB:recipes[1].id, cmpC:recipes[2].id, promo:defaultPromo(), annual:defaultAnnual()};
}


const KEY = 'calculateur-brassin-v1';
const ROLES = {admin:['Administration','Administration & Direction'], brasseur:['Production','Équipe de production'], user:['Lecture seule','Consultation seule']};

function deepMerge(a,b){
  const out = clone(a);
  Object.keys(b||{}).forEach(k=>{
    if(out[k] && typeof out[k]==='object' && !Array.isArray(out[k]) && b[k] && typeof b[k]==='object' && !Array.isArray(b[k])) out[k] = deepMerge(out[k],b[k]);
    else out[k] = b[k];
  });
  return out;
}
function migrateRecipe(r){
  r = clone(r);
  if(r.brewSize && r.volume==null){ r.volume = r.brewSize==='h10' ? 10 : 20; r.hd = r.brewSize==='h20hd' ? 1 : 0; }
  if(!r.volumeId && r.volume!=null){ r.volumeId = num(r.volume)===20 ? (num(r.hd)===1 ? 'v20hd' : 'v20') : 'v10'; }
  delete r.brewSize; delete r.volume; delete r.energy; delete r.energyTouched;
  if(typeof r.hd==='boolean') r.hd = r.hd ? 1 : 0;
  r.marginFmt = Object.assign({j33:30,c33:30,b75:30,can:30,keg:30}, r.marginFmt||{});
  if(r.marginScheme!=='perFormat') r.marginScheme = 'single';
  if(!['default','euro','us'].includes(r.pallet)) r.pallet = 'default';
  if(r.laborMode!=='grid' && r.laborMode!=='legacy') r.laborMode = 'legacy';
  if(r.example && r.laborMode==='legacy') r.laborMode = 'grid';   // les recettes d'exemple adoptent la structure détaillée
  r.moiAdj = Object.assign({pct:0, perHl:null}, r.moiAdj||{}); r.moiAdj.pct = num(r.moiAdj.pct); if(!(r.moiAdj.perHl!=null && r.moiAdj.perHl!=='' && isFinite(parseFloat(r.moiAdj.perHl)))) r.moiAdj.perHl = null;
  r.consAdj = Object.assign({coef:100, override:null}, r.consAdj||{}); r.consAdj.coef = isFinite(parseFloat(r.consAdj.coef)) ? parseFloat(r.consAdj.coef) : 100;
  if(!(r.consAdj.override!=null && r.consAdj.override!=='' && isFinite(parseFloat(r.consAdj.override)))) r.consAdj.override = null;
  r.laborFlat = Object.assign({mode:'off', amount:0}, r.laborFlat||{}); if(!['off','add','replace'].includes(r.laborFlat.mode)) r.laborFlat.mode = 'off'; r.laborFlat.amount = Math.max(0,num(r.laborFlat.amount));
  r.soutOther = Object.assign({profile:'brasseur', hours:0}, r.soutOther||{}); r.soutOther.hours = Math.max(0,num(r.soutOther.hours));
  if(r.brewKind!=='soft') r.brewKind = 'beer';
  r.mixPack = !!r.mixPack; if(!r.laborOv || typeof r.laborOv!=='object') r.laborOv = {};
  if(!STATUSES.some(([k])=>k===r.status)) r.status = (r.trace && r.trace.client) ? 'facon' : 'permanente';
  r.tech = Object.assign({og:0,fg:0,efficiency:75,loss:0,tankDays:0,referDays:0}, r.tech||{}); r.tech.referDays = Math.max(0,num(r.tech.referDays));
  { const pt = r.priceTarget && typeof r.priceTarget==='object' ? r.priceTarget : {}, pc = pt.piece && typeof pt.piece==='object' ? pt.piece : {};
    r.priceTarget = {mode:(pt.mode==='batch'||pt.mode==='piece')?pt.mode:'off', batch:nOrNull(pt.batch), piece:{}};
    FORMATS.forEach(f=>{ r.priceTarget.piece[f.key] = nOrNull(pc[f.key]); }); }
  r.trace = Object.assign({client:'',code:'',version:'v1.0',revised:''}, r.trace||{});
  r.acct = Object.assign({depositCase:0,depositKeg:0,royaltyHl:0,fuelPct:0}, r.acct||{});
  return blankRecipe(r);
}
function migrateLogistics(old, d){
  const out = clone(d); if(!old) return out;
  if(old.defaultPallet==='euro' || old.defaultPallet==='us') out.defaultPallet = old.defaultPallet;
  if(old.perCase!=null) out.perCase = num(old.perCase);
  const pp = old.perPallet;
  if(pp && typeof pp==='object'){ ['euro','us'].forEach(t=>{ if(pp[t]!=null) out.perPallet[t] = num(pp[t]); }); }
  else if(pp!=null){ out.perPallet.euro = out.perPallet.us = num(pp); }
  const kp = old.kegsPerPallet;
  if(kp && typeof kp==='object'){ ['euro','us'].forEach(t=>{ if(kp[t]!=null) out.kegsPerPallet[t] = num(kp[t]); }); }
  else if(kp!=null){ out.kegsPerPallet.euro = num(kp); }
  const cp = old.casesPerPallet;
  if(cp && typeof cp==='object'){
    if(cp.euro || cp.us){ ['euro','us'].forEach(t=>{ if(cp[t]) Object.keys(out.casesPerPallet[t]).forEach(k=>{ if(cp[t][k]!=null) out.casesPerPallet[t][k] = num(cp[t][k]); }); }); }
    else Object.keys(out.casesPerPallet.euro).forEach(k=>{ if(cp[k]!=null) out.casesPerPallet.euro[k] = num(cp[k]); });
  }
  return out;
}
function mergeState(p){
  if(!p || !p.settings || !Array.isArray(p.recipes)) return null;
  const d = defaultSettings(), ps = p.settings;
  const settings = Object.assign({}, d, ps);
  settings.energyHl = deepMerge(d.energyHl, ps.energyHl||{});
  // migration : anciennes valeurs par défaut exprimées pour 10 hL (6 / 22,44 / 1,07 ; HD 7) -> ratios par hL
  [['noHd',{eau:6,elec:22.44,gaz:1.07}],['hd',{eau:7,elec:22.44,gaz:1.07}]].forEach(([k,old])=>{ const e=settings.energyHl[k]; if(e && ['eau','elec','gaz'].every(x=>Math.abs(num(e[x])-old[x])<1e-9)) ['eau','elec','gaz'].forEach(x=>{ e[x] = Math.round(old[x]*1e5)/1e6; }); });
  settings.logistics = migrateLogistics(ps.logistics, d.logistics);
  settings.laborGrid = mergeLaborGrid(ps.laborGrid);
  settings.moi = Object.assign({}, d.moi, ps.moi||{}); settings.moi.year = Math.round(num(settings.moi.year))||d.moi.year; ['payroll','volume'].forEach(k=>{ settings.moi[k] = Math.max(0,num(settings.moi[k])); }); settings.moi.varPct = num(settings.moi.varPct);
  settings.laborFlat = Object.assign({}, d.laborFlat, ps.laborFlat||{}); if(!['off','add','replace'].includes(settings.laborFlat.mode)) settings.laborFlat.mode = 'off'; settings.laborFlat.amount = Math.max(0,num(settings.laborFlat.amount));
  settings.tasks = Array.isArray(ps.tasks) ? ps.tasks.map(t=>({id:t.id||uid(), name:String(t.name||''), hours:num(t.hours), profile:t.profile||'', role:['brew','bot1','bot2','keg'].includes(t.role)?t.role:''})) : d.tasks;
  { const seen = {}; settings.tasks.forEach(t=>{ if(t.role){ if(seen[t.role]) t.role = ''; else seen[t.role] = 1; } }); }
  settings.energyVar = Object.assign({}, d.energyVar, ps.energyVar||{});
  settings.energyHdCoef = Object.assign({}, d.energyHdCoef, ps.energyHdCoef||{});
  // anciennes versions : factures saisies TTC avec une TVA à déduire -> converties une fois en HTVA
  const legacyVat = ps.energyHtva ? 0 : Math.max(0,num(ps.energyVat));
  delete settings.energyVat; settings.energyHtva = true;
  settings.energyUseRef = ps.energyUseRef!==false;
  if(!Array.isArray(ps.energyYears) || !ps.energyYears.length){
    // ancienne sauvegarde : l'année 2025 est reconstruite à partir des tarifs et consommations déjà saisis
    const en = settings.energy, nh = settings.energyHl.noHd, hd = settings.energyHl.hd, y = clone(d.energyYears[0]);
    FLUIDS.forEach(([id])=>{ const cons = num(nh[id])*y.vol; y.cons[id] = e8(cons); y.bill[id] = e8(cons*num(en[id])); settings.energyHdCoef[id] = num(nh[id])>0 ? num(hd[id])/num(nh[id]) : 1; });
    settings.energyYears = [y]; settings.energyRef = y.id;
  } else {
    settings.energyYears = ps.energyYears.map(y=>({id:y.id||('y'+uid()), year:Math.round(num(y.year))||new Date().getFullYear(), example:!!y.example, vol:num(y.vol),
      bill:Object.assign({eau:0,elec:0,gaz:0}, y.bill||{}), cons:Object.assign({eau:0,elec:0,gaz:0}, y.cons||{})}));
    if(legacyVat>0) settings.energyYears.forEach(y=>FLUIDS.forEach(([id])=>{ y.bill[id] = e8(num(y.bill[id])/(1+legacyVat/100)); }));
    if(!settings.energyYears.some(y=>y.id===ps.energyRef)) settings.energyRef = settings.energyYears[0].id; else settings.energyRef = ps.energyRef;
  }
  energyApply(settings);
  if(!Array.isArray(ps.volumes) || !ps.volumes.length){
    settings.volumes = clone(d.volumes);
    const nv = ps.netVolumes;
    if(nv) settings.volumes.forEach(v=>{ if(isFinite(parseFloat(nv[v.id]))) v.net = parseFloat(nv[v.id]); });
  }
  delete settings.netVolumes;
  const keg = settings.consumables.keg = settings.consumables.keg || [];
  keg.forEach(i=>{ if(i.name==='Nettoyage') i.name = 'Lavage du fût'; });
  keg.forEach(i=>{ if(/location/i.test(i.name) && /à renseigner/i.test(i.name) && num(i.price)===0){ i.name = 'Location du fût'; i.price = 2; } });
  if(!keg.some(i=>/location/i.test(i.name))) keg.push({id:'k4',name:'Location du fût',price:2,mode:'piece'});
  if(!keg.some(i=>/autres/i.test(i.name))) keg.push({id:'k5',name:'Autres coûts fûts',price:0,mode:'piece'});
  settings.channels.forEach(c=>{ if(c.base==null) c.base=''; });
  const st = {v:2, settings, recipes:p.recipes.map(migrateRecipe), draft:migrateRecipe(p.draft||seedRecipes()[0]),
    selected:p.selected, cmpB:p.cmpB, cmpC:p.cmpC, priceSnap:p.priceSnap||null, annual:mergeAnnual(p.annual), promo:Object.assign(defaultPromo(), p.promo||{})};
  if(!st.recipes.some(r=>r.id===st.selected)) st.selected = st.recipes[0] ? st.recipes[0].id : null;
  const ids = st.recipes.map(r=>r.id);
  if(st.cmpB===undefined) st.cmpB = ids[1]||'';
  if(st.cmpC===undefined) st.cmpC = ids[2]||'';
  return st;
}
function loadState(){
  try{ const raw = localStorage.getItem(KEY); if(raw) return mergeState(JSON.parse(raw)); }catch(e){}
  return null;
}

/* ====================================================================
   Aides React : accès aux chemins de l'état, contexte, champs de saisie
   (remplacent I(), S(), syncInputs() et les écouteurs d'événements de la version HTML)
   ==================================================================== */
const getPath = (o: any, p: string) => p.split('.').reduce((x: any, k: string) => (x == null ? x : x[k]), o);
function setPath(o: any, p: string, v: any) {
  const ks = p.split('.'), last = ks.pop() as string;
  ks.reduce((x: any, k: string) => { if (x[k] == null) x[k] = {}; return x[k]; }, o)[last] = v;
}
const fid = (p: string) => 'f-' + p.replace(/\./g, '-');
const CbCtx = createContext<any>(null);
const useCb = () => useContext(CbCtx);

/* rôles : admin = tout ; brasseur = lecture + écriture ; user = lecture seule */
const ADMIN_ACTS = new Set(['del-recipe', 'reset-settings', 'backup-import']);
const VIEW_ACTS = new Set(['load-recipe', 'export-draft', 'export-recipe-json', 'export-compare', 'export-annual', 'backup-export', 'grid-unit', 'sheet-copy', 'sheet-close']);
const actAllowed = (role: string, a: string) => (ADMIN_ACTS.has(a) ? role === 'admin' : role === 'user' ? VIEW_ACTS.has(a) : true);
const canDo = (role: string, a: string) => (a === 'write' ? role !== 'user' : (a === 'annual' || a === 'delete' || a === 'reset' || a === 'restore') ? role === 'admin' : false);
const RO_TITLE = 'Lecture seule : action non disponible pour votre rôle';

/** Champ numérique : affiche la valeur de l'état, mais garde le texte tapé tant que le champ a le focus. */
function Num({ path, label, min, dec, blank, nullable, ph, disabled, cls, title }: any) {
  const { state, setAt, ro } = useCb();
  const value = getPath(state, path);
  const [text, setText] = useState<string | null>(null);
  const base = value == null || (blank && !num(value)) ? '' : dec ? Number(value).toFixed(4) : String(value);
  const shown = text != null ? text : base;
  return (
    <input id={fid(path)} className={'num' + (cls ? ' ' + cls : '')} type="number" inputMode="decimal" step="0.0001" aria-label={label} min={min}
      placeholder={ph} disabled={ro || disabled} title={title} value={shown}
      onFocus={() => setText(base)} onBlur={() => setText(null)}
      onChange={(e: any) => {
        const raw = e.target.value; setText(raw);
        let v: any = raw === '' ? 0 : parseFloat(raw); if (isNaN(v)) v = 0;
        if (nullable && raw === '') v = null;
        setAt(path, v);
      }} />
  );
}
function Txt({ path, label, ph, disabled }: any) {
  const { state, setAt, ro } = useCb();
  const value = getPath(state, path);
  return <input id={fid(path)} type="text" aria-label={label} placeholder={ph} disabled={ro || disabled} value={value == null ? '' : String(value)} onChange={(e: any) => setAt(path, e.target.value)} />;
}
function Sel({ path, opts, label, num: isNum, disabled }: any) {
  const { state, setAt, ro } = useCb();
  const value = getPath(state, path);
  return (
    <select id={fid(path)} aria-label={label} disabled={ro || disabled} value={value == null ? '' : String(value)}
      onChange={(e: any) => { if (isNum) { const v = parseFloat(e.target.value); setAt(path, isNaN(v) ? 0 : v); } else setAt(path, e.target.value); }}>
      {opts.map(([v, l, dis]: any) => <option key={v} value={v} disabled={dis}>{l}</option>)}
    </select>
  );
}
function Chk({ path, label, invert, id }: any) {
  const { state, setAt, ro } = useCb();
  const v = getPath(state, path);
  return <input type="checkbox" id={id || fid(path)} aria-label={label} disabled={ro} checked={invert ? !v : !!v}
    onChange={(e: any) => setAt(path, invert ? !e.target.checked : e.target.checked)} />;
}
/** Bouton d'action : désactivé quand le rôle ne le permet pas. */
function Btn({ act, className = 'btn', onClick, children, title, disabled }: any) {
  const { role } = useCb();
  const ok = actAllowed(role, act);
  return <button type="button" className={className} disabled={!ok || disabled} title={!ok && role === 'user' ? RO_TITLE : title} onClick={onClick}>{children}</button>;
}
/** Bouton à double clic (remplace data-confirm) */
function ConfirmButton({ act, className, confirmText, onConfirm, children, disabled }: any) {
  const { role } = useCb();
  const ok = actAllowed(role, act);
  const [armed, setArmed] = useState(false);
  const timer = useRef<any>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button type="button" className={className + (armed ? ' armed' : '')} disabled={!ok || disabled} title={!ok && role === 'user' ? RO_TITLE : undefined} onClick={() => {
      if (!armed) { setArmed(true); clearTimeout(timer.current); timer.current = setTimeout(() => setArmed(false), 3500); return; }
      clearTimeout(timer.current); setArmed(false); onConfirm();
    }}>{armed ? confirmText : children}</button>
  );
}
const noMin = { minWidth: 0 };
const U = ({ children }: any) => <span style={noMin}>{children}</span>;

const rateOpts = (s: any) => s.rates.map((r: any) => [r.id, r.name]);
function profOpts(s: any, sel?: string) {
  const o = s.rates.map((r: any) => [r.id, `${r.name} · ${fnum(num(r.rate), 4)} €/h`]);
  if (sel && !s.rates.some((r: any) => r.id === sel)) o.unshift([sel, '(profil supprimé)']);
  return o;
}
function volOpts(s: any, sel?: string) {
  const o = s.volumes.map((v: any) => [v.id, `${v.label} · ${fnum(num(v.net))} hl nets`]);
  if (sel && !s.volumes.some((v: any) => v.id === sel)) o.unshift([sel, '(volume supprimé)']);
  return o;
}
const hv = (v: any, d = 4) => (v == null || !isFinite(v) ? '—' : eur(v, d) + ' HTVA');
const eurH = (v: any, d = 2) => (v == null || !isFinite(v) ? '—' : eur(v, d) + ' HTVA');

/* ---------- formulaires « Ajouter » (états locaux : plus de lecture du DOM) ---------- */
function useField(init = '') { const [v, set] = useState(init); return [v, set, () => set(init)] as const; }
function AddRate() {
  const { mutate, toast, ro } = useCb();
  const [name, setName] = useState(''), [rate, setRate] = useState('');
  const add = () => {
    const n = name.trim(); if (!n) { toast('Indiquez le nom du profil'); return; }
    mutate((st: any) => { const s = st.settings; let id = slug(n) || uid(); if (s.rates.some((r: any) => r.id === id)) id += '-' + uid().slice(0, 3); s.rates.push({ id, name: n, rate: num(rate) }); });
    setName(''); setRate('');
  };
  return (
    <div className="addrow">
      <input type="text" disabled={ro} placeholder="Nom du profil" aria-label="Nom du nouveau profil" value={name} onChange={(e: any) => setName(e.target.value)} />
      <input type="number" disabled={ro} className="num" inputMode="decimal" step="0.0001" placeholder="€ / h" aria-label="Taux horaire du nouveau profil" value={rate} onChange={(e: any) => setRate(e.target.value)} />
      <Btn act="add-profile" className="btn sm" onClick={add}>Ajouter un profil de personnel</Btn>
    </div>
  );
}
function AddVolume() {
  const { mutate, toast, ro } = useCb();
  const [name, setName] = useState(''), [net, setNet] = useState(''), [hd, setHd] = useState('0');
  const add = () => {
    const label = name.trim(), n = num(net);
    if (!label || n <= 0) { toast('Indiquez un nom et un volume net supérieur à 0'); return; }
    mutate((st: any) => { const s = st.settings; let id = slug(label) || uid(); if (s.volumes.some((v: any) => v.id === id)) id += '-' + uid().slice(0, 3); s.volumes.push({ id, label, net: n, hd: num(hd) }); });
    setName(''); setNet(''); setHd('0');
  };
  return (
    <div className="addrow">
      <input type="text" disabled={ro} placeholder="Nom du volume" aria-label="Nom du nouveau volume" value={name} onChange={(e: any) => setName(e.target.value)} />
      <input type="number" disabled={ro} className="num" inputMode="decimal" step="0.0001" placeholder="hl nets" aria-label="Volume net en hl" value={net} onChange={(e: any) => setNet(e.target.value)} />
      <select disabled={ro} aria-label="Type du volume" value={hd} onChange={(e: any) => setHd(e.target.value)}><option value="0">Non-HD</option><option value="1">HD</option></select>
      <Btn act="add-volume" className="btn sm" onClick={add}>Ajouter un volume net</Btn>
    </div>
  );
}
function AddIngredient({ cat }: any) {
  const { mutate, toast, ro } = useCb();
  const [name, setName] = useState(''), [price, setPrice] = useState('');
  const add = () => {
    const n = name.trim(); if (!n) { toast('Indiquez le nom de l\'ingrédient'); return; }
    mutate((st: any) => { const s = st.settings; let id = slug(n) || uid(); if (s.ingredients.some((i: any) => i.id === id)) id += '-' + uid().slice(0, 3); s.ingredients.push({ id, cat, name: n, price: num(price) }); });
    setName(''); setPrice('');
  };
  return (
    <div className="addrow">
      <input type="text" disabled={ro} placeholder="Nouvel ingrédient" aria-label="Nom du nouvel ingrédient" value={name} onChange={(e: any) => setName(e.target.value)} />
      <input type="number" disabled={ro} className="num" inputMode="decimal" step="0.0001" placeholder="€ / kg" aria-label="Prix au kg" value={price} onChange={(e: any) => setPrice(e.target.value)} />
      <Btn act="add-base-ing" className="btn sm" onClick={add}>Ajouter</Btn>
    </div>
  );
}
function AddExcise({ k }: any) {
  const { mutate, toast, ro } = useCb();
  const [p, setP] = useState(''), [v, setV] = useState('');
  const add = () => {
    if (p === '' || v === '') { toast('Renseignez le °P et le montant'); return; }
    mutate((st: any) => { const t = st.settings.excise[k]; t.push([num(p), num(v)]); t.sort((x: any, y: any) => x[0] - y[0]); });
    setP(''); setV('');
  };
  return (
    <div className="addrow">
      <input type="number" disabled={ro} className="num" inputMode="decimal" step="0.0001" placeholder="°P" aria-label="Degré Plato du palier" value={p} onChange={(e: any) => setP(e.target.value)} />
      <input type="number" disabled={ro} className="num" inputMode="decimal" step="0.0001" placeholder="€" aria-label="Accises du palier" value={v} onChange={(e: any) => setV(e.target.value)} />
      <Btn act="add-excise" className="btn sm" onClick={add}>Ajouter un palier</Btn>
    </div>
  );
}
function AddConsumable({ f }: any) {
  const { mutate, toast, ro } = useCb();
  const [name, setName] = useState(''), [price, setPrice] = useState(''), [mode, setMode] = useState('piece');
  const add = () => {
    const n = name.trim(); if (!n) { toast('Indiquez le nom du consommable'); return; }
    mutate((st: any) => { st.settings.consumables[f].push({ id: uid(), name: n, price: num(price), mode }); });
    setName(''); setPrice(''); setMode('piece');
  };
  return (
    <div className="addrow">
      <input type="text" disabled={ro} placeholder="Consommable sur mesure" aria-label="Nom du consommable" value={name} onChange={(e: any) => setName(e.target.value)} />
      <input type="number" disabled={ro} className="num" inputMode="decimal" step="0.0001" placeholder="€" aria-label="Prix du consommable" value={price} onChange={(e: any) => setPrice(e.target.value)} />
      <select disabled={ro} aria-label="Mode de facturation" value={mode} onChange={(e: any) => setMode(e.target.value)}><option value="piece">€ / pièce</option><option value="forfait">Forfait brassin</option></select>
      <Btn act="add-cons" className="btn sm" onClick={add}>Ajouter</Btn>
    </div>
  );
}
function AddChannel({ channels }: any) {
  const { mutate, toast, ro } = useCb();
  const [name, setName] = useState(''), [pctV, setPctV] = useState(''), [base, setBase] = useState('part');
  const add = () => {
    const n = name.trim(); if (!n) { toast('Indiquez le nom du canal'); return; }
    mutate((st: any) => { st.settings.channels.push({ id: uid(), name: n, base, pct: num(pctV) }); });
    setName(''); setPctV(''); setBase('part');
  };
  return (
    <div className="addrow">
      <input type="text" disabled={ro} placeholder="Nom du canal" aria-label="Nom du nouveau canal" value={name} onChange={(e: any) => setName(e.target.value)} />
      <input type="number" disabled={ro} className="num" inputMode="decimal" step="0.0001" placeholder="Remise %" aria-label="Remise du nouveau canal" value={pctV} onChange={(e: any) => setPctV(e.target.value)} />
      <select disabled={ro} aria-label="Base de la remise" value={base} onChange={(e: any) => setBase(e.target.value)}>
        {[['', 'Prix calculé (sans base)'], ...channels.map((c: any) => [c.id, 'Remise sur ' + c.name])].map(([v, l]: any) => <option key={v} value={v}>{l}</option>)}
      </select>
      <Btn act="add-chan" className="btn sm" onClick={add}>Ajouter un canal</Btn>
    </div>
  );
}
function AddTask({ s }: any) {
  const { mutate, toast, ro } = useCb();
  const [name, setName] = useState(''), [hours, setHours] = useState(''), [prof, setProf] = useState('');
  const add = () => {
    const n = name.trim(); if (!n) { toast('Indiquez le nom de la tâche'); return; }
    mutate((st: any) => { const ss = st.settings; ss.tasks.push({ id: uid(), name: n, hours: num(hours), profile: prof || ((ss.rates[0] || {}).id || ''), role: '' }); });
    setName(''); setHours('');
  };
  return (
    <div className="addrow">
      <input type="text" disabled={ro} placeholder="Nouvelle tâche (ex. Embouteillage spécial)" aria-label="Nom de la nouvelle tâche" value={name} onChange={(e: any) => setName(e.target.value)} />
      <input type="number" disabled={ro} className="num" inputMode="decimal" step="0.0001" placeholder="heures" aria-label="Durée de base en heures" value={hours} onChange={(e: any) => setHours(e.target.value)} />
      <select disabled={ro} aria-label="Profil par défaut" value={prof} onChange={(e: any) => setProf(e.target.value)}>
        {profOpts(s, '').map(([v, l]: any) => <option key={v} value={v}>{l}</option>)}
      </select>
      <Btn act="add-task" className="btn sm" onClick={add}>Ajouter une tâche</Btn>
    </div>
  );
}
function AddSubtask({ si }: any) {
  const { mutate, toast, ro } = useCb();
  const [name, setName] = useState(''), [mode, setMode] = useState('hourly');
  const add = () => {
    const n = name.trim(); if (!n) { toast('Indiquez le nom de la sous-tâche'); return; }
    mutate((st: any) => {
      const s = st.settings, sec = s.laborGrid.sections[si];
      const prof = ((sec.tasks[0] || {}).std || {}).profile || (s.rates[0] || {}).id || '';
      sec.tasks.push({ id: uid(), name: n, mode: mode === 'flat' ? 'flat' : 'hourly', std: { tps: 0, pers: 1, profile: prof, flat: 0 }, hd: { tps: 0, pers: 1, profile: prof, flat: 0 } });
    });
    setName(''); setMode('hourly');
  };
  return (
    <div className="addrow">
      <input type="text" disabled={ro} className="a-name" placeholder="Nouvelle sous-tâche" aria-label="Nom de la nouvelle sous-tâche" value={name} onChange={(e: any) => setName(e.target.value)} />
      <select disabled={ro} aria-label="Mode de tarification de la nouvelle sous-tâche" value={mode} onChange={(e: any) => setMode(e.target.value)}><option value="hourly">Horaire</option><option value="flat">Forfait</option></select>
      <Btn act="lg-add" className="btn sm" onClick={add}>Ajouter une sous-tâche</Btn>
    </div>
  );
}
function AddFixedCharge() {
  const { mutate, toast, ro } = useCb();
  const [name, setName] = useState(''), [amt, setAmt] = useState('');
  const add = () => {
    const n = name.trim(); if (!n) { toast('Indiquez la nature de la charge'); return; }
    mutate((st: any) => { st.annual.fixed.push({ id: uid(), name: n, amount: num(amt) }); });
    setName(''); setAmt('');
  };
  return (
    <div className="addrow">
      <input type="text" disabled={ro} placeholder="Nouvelle charge (ex. Assurances)" aria-label="Nom de la nouvelle charge fixe" value={name} onChange={(e: any) => setName(e.target.value)} />
      <input type="number" disabled={ro} className="num" inputMode="decimal" step="0.0001" placeholder="€ HTVA/an" aria-label="Montant annuel de la nouvelle charge" value={amt} onChange={(e: any) => setAmt(e.target.value)} />
      <Btn act="an-add-fixed" className="btn sm" onClick={add}>Ajouter une charge</Btn>
    </div>
  );
}


/* ====================================================================
   ONGLET 1 : PARAMÈTRES & BASE DE DONNÉES
   ==================================================================== */
function SettingsTab() {
  const { state, mutate, toast, role, replaceState } = useCb();
  const s = state.settings;
  const [eyEdit, setEyEdit] = useState<string | null>(null);
  const [eyNew, setEyNew] = useState('');
  const ys = s.energyYears as any[];
  let ei = ys.findIndex((y) => y.id === eyEdit);
  if (ei < 0) { ei = ys.findIndex((y) => y.id === s.energyRef); if (ei < 0) ei = 0; }
  const ey = ys[ei];
  const pre = `settings.energyYears.${ei}`;
  const lockEn = !!s.energyUseRef;
  const lockTitle = lockEn ? 'Calculé à partir de l\'année de référence (décochez « Utiliser l\'année de référence » pour saisir à la main)' : undefined;

  /* sorties de l'historique énergie */
  const ref = ys.find((x) => x.id === s.energyRef) || ey;
  const cy = ey ? energyYearCalc(ey, null) : null;
  const cr = ref ? energyYearCalc(ref, s.energyVar) : null;
  const yearsSorted = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y.year - b.y.year);

  const delYear = () => {
    if (ys.length <= 1) { toast('Au moins une année doit rester enregistrée'); return; }
    const y = ys[ei];
    if (y.id === s.energyRef) { toast("Cette année est l'année de référence : choisissez d'abord une autre année de référence"); return; }
    mutate((st: any) => { st.settings.energyYears.splice(ei, 1); });
    setEyEdit(null); toast(`Année ${y.year} supprimée`);
  };
  const addYear = () => {
    const yr = Math.round(num(eyNew)) || ((Math.max(0, ...ys.map((y) => y.year))) + 1);
    if (yr < 1990 || yr > 2200) { toast('Année invalide'); return; }
    if (ys.some((y) => y.year === yr)) { toast(`L'année ${yr} existe déjà : sélectionnez-la dans « Année affichée »`); return; }
    const y = { id: 'y' + uid(), year: yr, example: false, vol: 0, bill: { eau: 0, elec: 0, gaz: 0 }, cons: { eau: 0, elec: 0, gaz: 0 } };
    mutate((st: any) => { st.settings.energyYears.push(y); });
    setEyEdit(y.id); setEyNew(''); toast(`Année ${yr} ajoutée : saisissez le volume, les factures et les consommations`);
  };

  const baseOpts = (selfId: string) => [['', 'Prix calculé (sans base)'], ...s.channels.filter((c: any) => c.id !== selfId).map((c: any) => [c.id, 'Remise sur ' + c.name])];
  const palOpts = PALLET_OPTS.map(([v, l]: any) => {
    const bad = FORMATS.filter((f) => palletCap(s, v, f) <= 0);
    return [v, bad.length ? `${l} · incompatible : ${bad.map((f) => f.label).join(', ')}` : l, bad.length === FORMATS.length && v !== s.logistics.defaultPallet];
  });
  const exTables = [
    { k: 'b75', t: 'Bouteilles 75 cl', sub: '', eco: [['b75', 'Écotaxe Fost Plus', '€ / bouteille']] },
    { k: 'b33n', t: 'Bouteilles 33 cl non consignées', sub: 'Ces accises servent aussi aux canettes 33 cl.', eco: [['j33', 'Écotaxe One way (bouteille jetable)', '€ / bouteille'], ['can', 'Écotaxe Can (canette)', '€ / canette']] },
    { k: 'b33c', t: 'Bouteilles 33 cl consignées', sub: 'Pas d\'écotaxe pour la bouteille consignée.', eco: [] },
    { k: 'keg20', t: 'Fûts 20 L', sub: 'Accises par fût, selon le degré Plato.', eco: [] },
  ];

  /* matrice des temps : totaux par poste */
  const rateOf = (id: string) => { const p = s.rates.find((x: any) => x.id === id); return p ? num(p.rate) : 0; };
  const lgTot = (sec: any) => {
    const tot: any = { std: { h: 0, c: 0 }, hd: { h: 0, c: 0 } };
    sec.tasks.forEach((t: any) => ['std', 'hd'].forEach((cfg) => {
      if (t.mode === 'flat') { tot[cfg].c += Math.max(0, num(t[cfg].flat)); return; }
      const hh = num(t[cfg].tps) * num(t[cfg].pers); tot[cfg].h += hh; tot[cfg].c += hh * rateOf(t[cfg].profile);
    }));
    return tot;
  };
  const moi = s.moi, mc = moiCalc(s);

  return (
    <>
      <div className="sec-title"><h2>Personnel, énergie et volumes</h2><p>Tout est modifiable ; les calculs suivent aussitôt.</p></div>
      <div className="grid">
        <div className="card"><h3>Profils de personnel</h3>
          <div className="rows">
            {s.rates.map((r: any, i: number) => (
              <div className="row r-rate" key={r.id}>
                <Txt path={`settings.rates.${i}.name`} label="Profil" />
                <div className="with-unit"><Num path={`settings.rates.${i}.rate`} label={'Taux horaire ' + r.name} dec /><span>€ / h</span></div>
                {BASE_RATES.includes(r.id) ? <span></span>
                  : <button type="button" className="icon-btn" disabled={role === 'user'} aria-label={'Supprimer ' + r.name} title="Supprimer" onClick={() => mutate((st: any) => { st.settings.rates.splice(i, 1); })}>×</button>}
              </div>
            ))}
          </div>
          <AddRate />
        </div>

        <div className="card"><h3>Tarifs énergie (€ HTVA)</h3>
          <div className="rows">
            {[['eau', 'Eau', '€ HTVA / m³'], ['gaz', 'Gaz', '€ HTVA / m³'], ['elec', 'Électricité', '€ HTVA / kWh']].map(([k, l, u]) => (
              <div className="row r-energy" key={k}><span className="lbl">{l}</span>
                <div className="with-unit"><Num path={`settings.energy.${k}`} label={'Prix ' + l + ' en € HTVA'} dec disabled={lockEn} title={lockTitle} /><span>{u}</span></div></div>
            ))}
          </div>
          <h3 style={{ marginTop: 14 }}>Consommation par HL produit</h3>
          <div className="rows">
            <div className="row r-hd head"><span></span><span className="lbl-s" style={{ textAlign: 'right' }}>Non-HD</span><span className="lbl-s" style={{ textAlign: 'right' }}>HD</span></div>
            {[['eau', 'Eau (m³ / hL)'], ['elec', 'Électricité (kWh / hL)'], ['gaz', 'Gaz (m³ / hL)']].map(([k, l]) => (
              <div className="row r-hd" key={k}><span className="lbl">{l}</span>
                <Num path={`settings.energyHl.noHd.${k}`} label={l + ' non-HD, par hL'} dec disabled={lockEn} title={lockTitle} />
                <Num path={`settings.energyHl.hd.${k}`} label={l + ' HD, par hL'} dec disabled={lockEn} title={lockTitle} /></div>
            ))}
          </div>
          <p className="note">Coût d'énergie d'un brassin = HL nets × consommation par HL × prix unitaires. La recette choisit la colonne HD ou non-HD.</p>
        </div>

        <div className="card"><h3>Volumes nets des brassins</h3>
          <div className="rows">
            {s.volumes.map((v: any, i: number) => (
              <div className="row r-vol" key={v.id}>
                <span className="n"><Txt path={`settings.volumes.${i}.label`} label="Nom du volume" /></span>
                <span className="p with-unit"><Num path={`settings.volumes.${i}.net`} label={'Volume net de ' + v.label} /><U>hl</U></span>
                <span className="h"><Sel path={`settings.volumes.${i}.hd`} opts={[['0', 'Non-HD'], ['1', 'HD']]} label={'Type du volume ' + v.label} num /></span>
                <button type="button" className="icon-btn d" disabled={role === 'user'} aria-label={'Supprimer ' + v.label} title="Supprimer" onClick={() => {
                  if (s.volumes.length <= 1) { toast('Gardez au moins un volume net'); return; }
                  mutate((st: any) => { st.settings.volumes.splice(i, 1); });
                }}>×</button>
              </div>
            ))}
          </div>
          <AddVolume />
          <p className="note">La recette choisit un volume dans cette liste. Un volume HD active la formule d'énergie HD.</p>
          <div className="rows" style={{ marginTop: 10 }}>
            <div className="row r-energy"><span className="lbl">TVA sur les ventes</span><div className="with-unit"><Num path="settings.vat" label="TVA" /><span>%</span></div></div>
          </div>
        </div>
      </div>

      {/* ---------- Main-d'œuvre indirecte ---------- */}
      <div className="sec-title"><h2>Main-d'œuvre indirecte (MOI)</h2><p>Direction, commercial, logistique, administratif… ramenée à l'hectolitre produit</p></div>
      <div className="card" id="moi-card">
        <div className="fields">
          <div className="field"><label className="lbl-s" htmlFor="f-settings-moi-year">Année de référence</label><Num path="settings.moi.year" label="Année de référence de la main-d'œuvre indirecte" /></div>
          <div className="field"><label className="lbl-s" htmlFor="f-settings-moi-payroll">Masse salariale indirecte totale (€ HTVA / an)</label><div className="with-unit"><Num path="settings.moi.payroll" label="Masse salariale indirecte totale en euros HTVA par an" min={0} /><U>€ HTVA/an</U></div></div>
          <div className="field"><label className="lbl-s" htmlFor="f-settings-moi-volume">Volume total produit dans l'année</label><div className="with-unit"><Num path="settings.moi.volume" label="Volume total produit dans l'année en hectolitres" min={0} /><U>hL/an</U></div></div>
        </div>
        <div className="sub-line"><span>Coût MOI de référence <span className="hint">{moi.year ? '(' + moi.year + ')' : ''}</span></span><span className="mono">{eur(mc.ref) + ' / hL'}</span></div>
        <p className="hint" style={{ margin: '2px 0 10px' }}>Coût MOI (€/hL) = masse salariale indirecte (€) ÷ volume annuel (hL). Cumul Direction + Commercial + Logistique + Administratif.</p>
        <div className="fields">
          <div className="field"><label className="lbl-s" htmlFor="f-settings-moi-varPct">Variation / inflation (%)</label><div className="with-unit"><Num path="settings.moi.varPct" label="Variation ou inflation du coût de la main-d'œuvre indirecte en pourcentage" /><U>%</U></div></div>
        </div>
        <div className="total-line"><span>Coût MOI ajusté</span><span className="mono">{eur(mc.adj) + ' / hL'}</span></div>
        <p className="hint" style={{ margin: '6px 0 0' }}>Coût MOI ajusté (€/hL) = coût de référence × (1 + variation % ÷ 100). Ce montant s'ajoute au coût de revient de chaque brassin, au volume net du brassin.</p>
      </div>

      {/* ---------- Grille des temps de main-d'œuvre ---------- */}
      <div className="sec-title"><h2>Temps de main-d'œuvre par poste</h2><p>Temps par personne × nombre de personnes, pour un brassin standard (10 hL) et un brassin HD</p></div>
      <div id="lg-settings">
        {s.laborGrid.sections.map((sec: any, si: number) => {
          const tot = lgTot(sec);
          return (
            <details className="card" key={sec.id}>
              <summary><h2>{sec.name}</h2><span className="sum">{`Standard : ${fnum(tot.std.h, 2)} h-h · ${eur(tot.std.c, 2)}   |   HD : ${fnum(tot.hd.h, 2)} h-h · ${eur(tot.hd.c, 2)}`}</span></summary>
              <div className="scroll"><table className="fmt-tbl ey-tbl lg-tbl"><thead>
                <tr><th rowSpan={2}>Sous-tâche</th><th colSpan={4} className="sep" style={{ textAlign: 'center' }}>Brassin standard (10 hL)</th><th colSpan={4} className="sep" style={{ textAlign: 'center' }}>Brassin HD</th><th rowSpan={2}></th></tr>
                <tr><th className="sep">Tps (h)</th><th>Pers.</th><th>Total (h-h)</th><th style={{ textAlign: 'left' }}>Profil</th><th className="sep">Tps (h)</th><th>Pers.</th><th>Total (h-h)</th><th style={{ textAlign: 'left' }}>Profil</th></tr></thead>
                <tbody>
                  {sec.tasks.map((t: any, ti: number) => {
                    const cell = (cfg: string) => {
                      const nm = (t.name || 'sous-tâche') + ', ' + (cfg === 'std' ? 'standard' : 'HD');
                      const p = `settings.laborGrid.sections.${si}.tasks.${ti}.${cfg}`;
                      if (t.mode === 'flat') return (
                        <td className="sep" colSpan={4}><div className="flat-cell"><span className="hint">Montant du forfait</span><Num path={p + '.flat'} label={'Montant du forfait en euros, ' + nm} min={0} /><span>€</span></div></td>);
                      return (<>
                        <td className="n sep"><Num path={p + '.tps'} label={'Temps par personne en heures, ' + nm} /></td>
                        <td className="n"><Num path={p + '.pers'} label={'Nombre de personnes, ' + nm} /></td>
                        <td className="n">{fnum(num(t[cfg].tps) * num(t[cfg].pers), 4)}</td>
                        <td><Sel path={p + '.profile'} opts={profOpts(s, t[cfg].profile)} label={'Profil, ' + nm} /></td>
                      </>);
                    };
                    return (
                      <tr key={t.id}>
                        <td className="lg-name"><Txt path={`settings.laborGrid.sections.${si}.tasks.${ti}.name`} label="Nom de la sous-tâche" />
                          <Sel path={`settings.laborGrid.sections.${si}.tasks.${ti}.mode`} opts={[['hourly', 'Horaire'], ['flat', 'Forfait']]} label={'Mode de tarification : ' + (t.name || 'sous-tâche')} /></td>
                        {cell('std')}{cell('hd')}
                        <td><button type="button" className="icon-btn" disabled={role === 'user'} aria-label={'Supprimer ' + (t.name || 'la sous-tâche')} title="Supprimer" onClick={() => mutate((st: any) => { st.settings.laborGrid.sections[si].tasks.splice(ti, 1); })}>✕</button></td>
                      </tr>
                    );
                  })}
                  <tr className="tot"><td>Total du poste</td><td className="sep"></td><td></td><td className="n">{fnum(tot.std.h, 4)}</td><td className="n">{eur(tot.std.c)}</td><td className="sep"></td><td></td><td className="n">{fnum(tot.hd.h, 4)}</td><td className="n">{eur(tot.hd.c)}</td><td></td></tr>
                </tbody></table></div>
              <AddSubtask si={si} />
            </details>
          );
        })}
        <p className="note">Mode Horaire : Temps × Personnes × Profil = Total (h-h), coût = heures-homme × tarif du profil. Mode Forfait : seul le montant (€) est demandé ; il s'additionne aux prestations horaires des autres sous-tâches du poste (heures × tarif + forfait). La colonne HD s'applique aux recettes en haute densité. Le brassage bière reprend votre tableau (13,2 h-h) ; les autres postes sont des valeurs de départ : remplacez-les par vos temps réels.</p>
      </div>
      <div className="card" id="lf-card"><h2>Main-d'œuvre : forfait fixe</h2>
        <p className="hint" style={{ margin: '2px 0 10px' }}>Montant fixe repris dans chaque nouvelle recette : en plus du calcul au taux horaire, ou à sa place. Chaque recette peut ensuite l'ajuster sans toucher à cette valeur.</p>
        <div className="fields">
          <div className="field"><label className="lbl-s" htmlFor="f-settings-laborFlat-mode">Application du forfait</label><Sel path="settings.laborFlat.mode" opts={[['off', 'Pas de forfait'], ['add', 'En plus du calcul au taux horaire'], ['replace', 'À la place du calcul au taux horaire']]} label="Application du forfait de main-d'œuvre" /></div>
          <div className="field"><label className="lbl-s" htmlFor="f-settings-laborFlat-amount">Forfait main-d'œuvre (€ HTVA)</label><div className="with-unit"><Num path="settings.laborFlat.amount" label="Forfait de main-d'œuvre en euros" min={0} /><U>€</U></div></div>
        </div>
      </div>

      {/* ---------- Tâches standard ---------- */}
      <div className="sec-title"><h2>Tâches standard à la demande</h2><p>Prestations réutilisables (et lignes des anciennes recettes) ; les temps par poste se règlent plus haut</p></div>
      <div className="card" id="tasks-card">
        <div className="rows"><div className="row r-task head"><span className="lbl-s">Tâche</span><span className="lbl-s">Durée de base</span><span className="lbl-s t-prof">Profil par défaut</span><span className="lbl-s t-role">Utilisation dans la recette</span><span></span></div>
          {s.tasks.map((t: any, i: number) => (
            <div className="row r-task" key={t.id}><span className="t-name"><Txt path={`settings.tasks.${i}.name`} label="Nom de la tâche" /></span>
              <div className="with-unit"><Num path={`settings.tasks.${i}.hours`} label={'Durée de référence de ' + (t.name || 'la tâche') + ' en heures'} dec /><U>h</U></div>
              <span className="t-prof"><Sel path={`settings.tasks.${i}.profile`} opts={profOpts(s, t.profile)} label={'Profil par défaut de ' + (t.name || 'la tâche')} /></span>
              <span className="t-role"><Sel path={`settings.tasks.${i}.role`} opts={TASK_ROLES} label={'Utilisation de ' + (t.name || 'la tâche') + ' dans la recette'} /></span>
              <button type="button" className="icon-btn" disabled={role === 'user'} aria-label={'Supprimer ' + (t.name || 'la tâche')} title="Supprimer" onClick={() => mutate((st: any) => { st.settings.tasks.splice(i, 1); })}>✕</button></div>
          ))}
        </div>
        {s.tasks.length ? null : <p className="empty">Aucune tâche standard.</p>}
        <AddTask s={s} />
        <p className="note">Le coût d'une tâche = heures × taux horaire du profil (voir « Profils de personnel »). Les tâches reliées à une ligne de la recette (brassage, soutirage) fournissent ses heures et son profil de départ ; les autres se rajoutent à la demande dans « Prestations supplémentaires ». Chaque recette peut ensuite modifier heures et profil.</p>
      </div>

      {/* ---------- Énergie : historique annuel ---------- */}
      <div className="sec-title"><h2>Énergie et fluides : historique annuel</h2><p>Une année de référence alimente les calculs de production ; les hausses de tarif se simulent dessus</p></div>
      {ey && cy && cr ? (
        <div className="card" id="energy-years">
          <div className="ey-bar">
            <div className="field"><label className="lbl-s" htmlFor="ey-edit">Année affichée</label>
              <select id="ey-edit" aria-label="Année affichée" value={ey.id} onChange={(e: any) => setEyEdit(e.target.value)}>{yearsSorted.map(({ y }) => <option key={y.id} value={y.id}>{y.year}</option>)}</select></div>
            <div className="field"><label className="lbl-s" htmlFor="f-settings-energyRef">Année de référence active</label>
              <Sel path="settings.energyRef" opts={yearsSorted.map(({ y }) => [y.id, String(y.year)])} label="Année de référence active" /></div>
            <div className="field"><label className="lbl-s" htmlFor="ey-new">Nouvelle année</label>
              <input id="ey-new" className="num" type="number" step="1" inputMode="numeric" aria-label="Nouvelle année" disabled={role === 'user'} value={eyNew} onChange={(e: any) => setEyNew(e.target.value)} /></div>
            <Btn act="ey-add" onClick={addYear}>Ajouter l'année</Btn>
            <ConfirmButton act="ey-del" className="btn danger" confirmText="Confirmer la suppression" onConfirm={delYear}>Supprimer l'année affichée</ConfirmButton>
          </div>
          <label className="ey-chk"><Chk path="settings.energyUseRef" label="Utiliser l'année de référence pour les calculs de production" /> Utiliser l'année de référence (avec les hausses simulées) pour les calculs de production</label>
          <div className="ey-bar">
            <div className="field"><label className="lbl-s" htmlFor={fid(pre + '.vol')}>{`Volume total produit en ${ey.year || ''} (hL)`}</label><Num path={pre + '.vol'} label="Volume annuel produit en hL" dec /></div>
            {(ey.id === s.energyRef || ey.example) ? <span className="badge">{[ey.id === s.energyRef ? 'Année de référence' : '', ey.example ? 'Exemple : à remplacer par vos factures' : ''].filter(Boolean).join(' · ')}</span> : null}
          </div>
          <div className="scroll"><table className="fmt-tbl ey-tbl"><thead><tr><th>Fluide</th><th className="n">Facture annuelle (€ HTVA)</th><th className="n">Consommation annuelle</th><th className="n">Consommation par hL</th><th className="n">Prix moyen unitaire (€ HTVA)</th><th className="n">Coût par hL (€ HTVA)</th></tr></thead>
            <tbody>
              {FLUIDS.map(([id, l, u]: any) => { const f = cy.f[id]; return (
                <tr key={id}><td>{l}</td>
                  <td><Num path={`${pre}.bill.${id}`} label={'Facture annuelle ' + l + ' en € HTVA'} dec /></td>
                  <td><Num path={`${pre}.cons.${id}`} label={'Consommation annuelle ' + l + ' en ' + u} dec /></td>
                  <td className="n">{`${fnum(f.perHl, 4)} ${u}`}</td><td className="n">{f.cons > 0 ? `${fnum(f.price, 4)} € HTVA/${u}` : '—'}</td><td className="n">{hv(f.costHl)}</td></tr>); })}
              <tr className="tot"><td>Total</td><td className="n">{hv(cy.totalBill, 2)}</td><td></td><td></td><td></td><td className="n">{hv(cy.total)}</td></tr>
            </tbody></table></div>
          <p className="note">Toutes les factures et tous les prix de cette section sont en <b>€ HTVA</b> (hors TVA). Consommations : eau en m³, électricité en kWh, gaz en m³. Prix moyen = facture HTVA ÷ consommation (€ HTVA/m³ ou € HTVA/kWh) ; coût par hL = facture HTVA ÷ volume produit.</p>
          <div className="ey-grid">
            <div><h3>Simulation de hausse sur l'année de référence <span>{'· ' + ref.year}</span> <span className="hint">(montants en € HTVA)</span></h3>
              <div className="scroll"><table className="fmt-tbl ey-tbl"><thead><tr><th>Fluide</th><th className="n">Coût par hL (€ HTVA)</th><th className="n">Variation (%)</th><th className="n">Prix unitaire ajusté (€ HTVA)</th><th className="n">Coût ajusté par hL (€ HTVA)</th></tr></thead>
                <tbody>
                  {FLUIDS.map(([id, l, u]: any) => { const f = cr.f[id]; return (
                    <tr key={id}><td>{l}</td><td className="n">{hv(f.costHl)}</td>
                      <td><Num path={`settings.energyVar.${id}`} label={'Variation de tarif ' + l + ' en %'} dec disabled={!lockEn} /> <span className="hint">%</span></td>
                      <td className="n">{f.cons > 0 ? `${fnum(f.adjPrice, 4)} € HTVA/${u}` : '—'}</td><td className="n">{hv(f.adjCostHl)}</td></tr>); })}
                  <tr className="tot"><td>Total</td><td className="n">{hv(cr.total)}</td><td className="n">{cr.total > 0 ? (cr.totalAdj >= cr.total ? '+' : '−') + fnum(Math.abs(cr.totalAdj / cr.total - 1) * 100, 2) + ' %' : '—'}</td><td></td><td className="n">{hv(cr.totalAdj)}</td></tr>
                </tbody></table></div>
              <p className="note">Ex. +5 % sur l'électricité, +10 % sur le gaz, 0 % sur l'eau. Le coût d'énergie des recettes est recalculé aussitôt.</p></div>
            <div><h3>Coefficient HD ÷ Non-HD</h3>
              <div className="scroll"><table className="fmt-tbl ey-tbl"><thead><tr><th>Fluide</th><th className="n">Consommation HD = Non-HD ×</th></tr></thead>
                <tbody>{FLUIDS.map(([id, l]: any) => <tr key={id}><td>{l}</td><td><Num path={`settings.energyHdCoef.${id}`} label={'Coefficient HD pour ' + l} dec disabled={!lockEn} /></td></tr>)}</tbody></table></div>
              <p className="note">La consommation par hL de l'année de référence est la base Non-HD ; les bières HD consomment ce coefficient en plus.</p></div>
          </div>
          <EnergyHd s={s} ref_={ref} />
          <EnergyHistory s={s} ref_={ref} cr={cr} />
        </div>
      ) : null}

      {/* ---------- Logistique ---------- */}
      <div className="sec-title"><h2>Logistique, colisage et livraison</h2><p>La livraison suit le nombre de caisses et de palettes générées, selon le type de palette</p></div>
      <div className="grid">
        <div className="card"><h3>Type de palette par défaut</h3>
          <div className="rows"><div className="row r-sel"><span className="lbl">Palette utilisée</span><Sel path="settings.logistics.defaultPallet" opts={palOpts} label="Type de palette par défaut" /></div></div>
          <p className="note">Chaque recette peut choisir l'un ou l'autre type, ou suivre cette valeur par défaut.</p></div>
        <div className="card"><h3>Tarifs de livraison</h3><div className="rows">
          <div className="row r-energy"><span className="lbl">Prix par caisse</span><div className="with-unit"><Num path="settings.logistics.perCase" label="Prix de livraison par caisse" dec /><span>€ / caisse</span></div></div>
          <div className="row r-energy"><span className="lbl">{'Prix par ' + PALLETS.euro.label}</span><div className="with-unit"><Num path="settings.logistics.perPallet.euro" label="Prix de livraison par palette Euro" dec /><span>€ / palette</span></div></div>
          <div className="row r-energy"><span className="lbl">{'Prix par ' + PALLETS.us.label}</span><div className="with-unit"><Num path="settings.logistics.perPallet.us" label="Prix de livraison par palette Américaine" dec /><span>€ / palette</span></div></div></div>
          <p className="note">Montants à renseigner : ils sont à 0 € tant que vous ne les saisissez pas.</p></div>
        <div className="card"><h3>Colisage par palette</h3>
          <div className="rows"><div className="row r-colis3 head"><span className="lbl lbl-s">Format</span><span className="lbl-s" style={{ textAlign: 'right' }}>Pièces / caisse</span><span className="lbl-s" style={{ textAlign: 'right' }}>Palette Euro</span><span className="lbl-s" style={{ textAlign: 'right' }}>Palette Amér.</span></div>
            {FORMATS.map((f) => {
              const off = (p: string) => !(num(getPath(state, p)) > 0);
              const pc = (t: string) => { const p = f.caseable ? `settings.logistics.casesPerPallet.${t}.${f.key}` : `settings.logistics.kegsPerPallet.${t}`; return off(p) ? { cls: 'pal-off', title: 'Palette incompatible avec ce format (0 caisse)' } : {}; };
              return f.caseable ? (
                <div className="row r-colis3" key={f.key}><span className="lbl">{f.long}</span>
                  <Num path={`settings.perCase.${f.key}`} label={'Pièces par caisse ' + f.label} />
                  <Num path={`settings.logistics.casesPerPallet.euro.${f.key}`} label={'Caisses par palette Euro, ' + f.label} {...pc('euro')} />
                  <Num path={`settings.logistics.casesPerPallet.us.${f.key}`} label={'Caisses par palette Américaine, ' + f.label} {...pc('us')} /></div>
              ) : (
                <div className="row r-colis3" key={f.key}><span className="lbl">{f.long + ' · fûts par palette'}</span><span></span>
                  <Num path="settings.logistics.kegsPerPallet.euro" label="Fûts par palette Euro" {...pc('euro')} />
                  <Num path="settings.logistics.kegsPerPallet.us" label="Fûts par palette Américaine" {...pc('us')} /></div>
              );
            })}
          </div>
          <p className="note"><b>0 = palette incompatible avec ce format</b> (elle est alors grisée dans les recettes et le calcul logistique est suspendu). Nombre de caisses par palette, et de fûts pour la dernière ligne. Ce sont des valeurs de départ à vérifier avec votre transporteur.</p></div>
      </div>

      {/* ---------- Matières premières ---------- */}
      <div className="sec-title"><h2>Matières premières</h2><p>Prix au kilo</p></div>
      <div className="grid">
        {CATS.map((cat) => (
          <div className="card" key={cat.id}><h3>{cat.label} <span className="hint">· € / kg</span></h3>
            <div className="rows">
              {s.ingredients.map((x: any, i: number) => ({ x, i })).filter((o: any) => o.x.cat === cat.id).map(({ x, i }: any) => (
                <div className="row r-base" key={x.id + i}>
                  <Txt path={`settings.ingredients.${i}.name`} label="Ingrédient" />
                  <div className="with-unit"><Num path={`settings.ingredients.${i}.price`} label={'Prix au kg ' + x.name} dec /><U>{''}</U></div>
                  <button type="button" className="icon-btn" disabled={role === 'user'} aria-label={'Supprimer ' + x.name} title="Supprimer" onClick={() => mutate((st: any) => { st.settings.ingredients.splice(i, 1); })}>×</button>
                </div>
              ))}
            </div>
            <AddIngredient cat={cat.id} />
          </div>
        ))}
      </div>

      {/* ---------- Taxes ---------- */}
      <div className="sec-title"><h2>Taxes et accises</h2><p>Selon le degré Plato. Entre deux paliers, la valeur est interpolée.</p></div>
      <div className="grid">
        {exTables.map((tb) => (
          <div className="card" key={tb.k}><h3>{tb.t}</h3>
            {tb.sub ? <p className="hint" style={{ margin: '-4px 0 8px' }}>{tb.sub}</p> : null}
            <div className="rows">
              {s.excise[tb.k].map((r: any, i: number) => (
                <div className="row r-excise" key={i}>
                  <div className="with-unit"><Num path={`settings.excise.${tb.k}.${i}.0`} label="Degré Plato" /><U>°P</U></div>
                  <div className="with-unit"><Num path={`settings.excise.${tb.k}.${i}.1`} label={'Accises à ' + r[0] + ' °P'} dec /><span>€</span></div>
                  <button type="button" className="icon-btn" disabled={role === 'user'} aria-label={`Supprimer le palier ${r[0]} °P`} title="Supprimer" onClick={() => {
                    if (s.excise[tb.k].length <= 2) { toast('Gardez au moins deux paliers pour l\'interpolation'); return; }
                    mutate((st: any) => { st.settings.excise[tb.k].splice(i, 1); });
                  }}>×</button>
                </div>
              ))}
            </div>
            <AddExcise k={tb.k} />
            {tb.eco.length ? <div className="rows" style={{ marginTop: 10 }}>
              {tb.eco.map(([k, l, u]: any) => <div className="row r-energy" key={k}><span className="lbl">{l}</span><div className="with-unit"><Num path={`settings.ecotax.${k}`} label={l} dec /><span>{u}</span></div></div>)}
            </div> : null}
          </div>
        ))}
      </div>

      {/* ---------- Consommables ---------- */}
      <div className="sec-title"><h2>Consommables et spécificités des fûts</h2><p>À la pièce, ou en forfait par brassin (appliqué si le format est utilisé)</p></div>
      <div className="grid">
        {FORMATS.map((f) => (
          <div className="card" key={f.key}><h3>{f.key === 'keg' ? 'Fûts 20 L · étiquette, capsule, lavage, location, autres coûts' : f.long}</h3>
            <div className="rows">
              {s.consumables[f.key].map((c: any, i: number) => (
                <div className="row r-cons" key={c.id}>
                  <span className="n"><Txt path={`settings.consumables.${f.key}.${i}.name`} label="Consommable" /></span>
                  <span className="p"><Num path={`settings.consumables.${f.key}.${i}.price`} label={'Prix ' + c.name} dec /></span>
                  <span className="m"><Sel path={`settings.consumables.${f.key}.${i}.mode`} opts={[['piece', '€ / pièce'], ['forfait', 'Forfait brassin']]} label="Mode de facturation" /></span>
                  <button type="button" className="icon-btn d" disabled={role === 'user'} aria-label={'Supprimer ' + c.name} title="Supprimer" onClick={() => mutate((st: any) => { st.settings.consumables[f.key].splice(i, 1); })}>×</button>
                </div>
              ))}
            </div>
            <AddConsumable f={f.key} />
          </div>
        ))}
      </div>

      {/* ---------- Canaux ---------- */}
      <div className="sec-title"><h2>Canaux de vente</h2><p>Chaque remise s'applique sur le canal de base choisi</p></div>
      <div className="card"><div className="rows">
        {s.channels.map((c: any, i: number) => (
          <div className="row r-chan" key={c.id}>
            <span className="n"><Txt path={`settings.channels.${i}.name`} label="Nom du canal" /></span>
            <span className="b"><Sel path={`settings.channels.${i}.base`} opts={baseOpts(c.id)} label={'Base de la remise pour ' + c.name} /></span>
            <span className="p with-unit"><Num path={`settings.channels.${i}.pct`} label={'Remise ' + c.name} /><U>%</U></span>
            {c.id === 'part' ? <span className="d"></span>
              : <button type="button" className="icon-btn d" disabled={role === 'user'} aria-label={'Supprimer ' + c.name} title="Supprimer" onClick={() => mutate((st: any) => {
                const ch = st.settings.channels[i]; if (!ch) return;
                st.settings.channels.splice(i, 1); st.settings.channels.forEach((x: any) => { if (x.base === ch.id) x.base = ch.base || ''; });
              })}>×</button>}
          </div>
        ))}
      </div>
        <AddChannel channels={s.channels} />
      </div>

      <div className="sec-title"><h2>Réinitialisation</h2><p>La sauvegarde et la restauration de toute la base se trouvent dans l'onglet Recette.</p></div>
      <div className="card">
        <div className="btn-row">
          {role === 'admin' ? (
            <ConfirmButton act="reset-settings" className="btn danger" confirmText="Confirmer : tout remettre aux valeurs d'origine" onConfirm={() => { replaceState(freshState()); toast('Paramètres remis aux valeurs d\'origine'); }}>Réinitialiser tous les paramètres</ConfirmButton>
          ) : <span className="hint">Réservé aux administrateurs.</span>}
        </div>
        <p className="note">La réinitialisation remet aussi les trois recettes d'exemple ; vos recettes enregistrées sont remplacées.</p>
      </div>
    </>
  );
}

function EnergyHd({ s, ref_ }: any) {
  let t0 = 0, t1 = 0;
  const rows = FLUIDS.map(([id, l, u]: any) => {
    const c0 = num(s.energyHl.noHd[id]), c1 = num(s.energyHl.hd[id]), p = num(s.energy[id]), k0 = c0 * p, k1 = c1 * p; t0 += k0; t1 += k1;
    return <tr key={id}><td>{l}</td><td className="n">{fnum(c0, 4)} {u}</td><td className="n">{fnum(c1, 4)} {u}</td><td className="n">{hv(k0)}</td><td className="n">{hv(k1)}</td><td className="n">{k0 > 0 ? (k1 >= k0 ? '+' : '−') + fnum(Math.abs(k1 / k0 - 1) * 100, 2) + ' %' : '—'}</td></tr>;
  });
  const src = s.energyUseRef ? `· base : année de référence ${ref_.year}${FLUIDS.some(([id]: any) => num(s.energyVar[id]) !== 0) ? ' avec hausses simulées' : ''}` : '· base : saisie manuelle (année de référence désactivée)';
  return (
    <>
      <h3 style={{ marginTop: 18 }}>Comparatif par hL : Non-HD et HD <span className="hint">{src}</span></h3>
      <div className="scroll"><table className="fmt-tbl ey-tbl"><thead><tr><th>Fluide</th><th className="n">Conso. Non-HD</th><th className="n">Conso. HD</th><th className="n">Coût Non-HD (€ HTVA/hL)</th><th className="n">Coût HD (€ HTVA/hL)</th><th className="n">Écart HD</th></tr></thead>
        <tbody>{rows}<tr className="tot"><td>Total énergie</td><td></td><td></td><td className="n">{hv(t0)}</td><td className="n">{hv(t1)}</td><td className="n">{t0 > 0 ? (t1 >= t0 ? '+' : '−') + fnum(Math.abs(t1 / t0 - 1) * 100, 2) + ' %' : '—'}</td></tr></tbody></table></div>
    </>
  );
}
function EnergyHistory({ s, ref_, cr }: any) {
  const ys = s.energyYears.slice().sort((a: any, b: any) => a.year - b.year).map((x: any) => ({ x, c: energyYearCalc(x, null) }));
  const dl = (a: number, b: number) => (b > 0 ? <span className={a >= b ? 'ey-up' : 'ey-down'}>{a >= b ? '+' : '−'}{fnum(Math.abs(a / b - 1) * 100, 2)} %</span> : '—');
  const sim = FLUIDS.some(([id]: any) => num(s.energyVar[id]) !== 0);
  return (
    <>
      <h3 style={{ marginTop: 18 }}>Historique pluriannuel du coût d'énergie par hL</h3>
      <div className="scroll">
        <table className="fmt-tbl ey-tbl">
          <thead><tr><th>Année</th><th className="n">Volume produit</th>{FLUIDS.map(([id, l]: any) => <th className="n" key={id}>{l} (€ HTVA/hL)</th>)}<th className="n">Total énergie (€ HTVA/hL)</th><th className="n">Évolution</th></tr></thead>
          <tbody>
            {ys.map(({ x, c }: any, k: number) => {
              const p = k > 0 ? ys[k - 1].c : null;
              return <tr key={x.id} className={x.id === s.energyRef ? 'refrow' : ''}><td>{x.year}{x.id === s.energyRef ? <> <span className="badge">réf.</span></> : null}</td><td className="n">{fnum(c.vol, 2)} hL</td>
                {FLUIDS.map(([id]: any) => <td className="n" key={id}>{hv(c.f[id].costHl)}</td>)}<td className="n"><b>{hv(c.total)}</b></td><td className="n">{p ? dl(c.total, p.total) : '—'}</td></tr>;
            })}
            {sim ? <tr className="sim"><td>{ref_.year} + hausses</td><td className="n">{fnum(cr.vol, 2)} hL</td>{FLUIDS.map(([id]: any) => <td className="n" key={id}>{hv(cr.f[id].adjCostHl)}</td>)}<td className="n"><b>{hv(cr.totalAdj)}</b></td><td className="n">{dl(cr.totalAdj, cr.total)} <span className="hint">vs {ref_.year}</span></td></tr> : null}
          </tbody>
        </table>
        <p className="note">Tous les montants sont en € HTVA. Coût par hL = facture annuelle HTVA ÷ volume produit. Évolution : variation du total par rapport à l'année précédente enregistrée.</p>
        <table className="fmt-tbl ey-tbl" style={{ marginTop: 10 }}>
          <thead><tr><th>Année</th>{FLUIDS.map(([id, l, u]: any) => <React.Fragment key={id}><th className="n">{l} par hL</th><th className="n">{l} (€ HTVA/{u})</th></React.Fragment>)}</tr></thead>
          <tbody>{ys.map(({ x, c }: any) => <tr key={x.id} className={x.id === s.energyRef ? 'refrow' : ''}><td>{x.year}</td>{FLUIDS.map(([id, l, u]: any) => <React.Fragment key={id}><td className="n">{fnum(c.f[id].perHl, 4)} {u}</td><td className="n">{c.f[id].cons > 0 ? fnum(c.f[id].price, 4) + ' € HTVA' : '—'}</td></React.Fragment>)}</tr>)}</tbody>
        </table>
      </div>
    </>
  );
}


/* ====================================================================
   ONGLET 2 : RECETTE & SIMULATEUR
   ==================================================================== */
const LG_ACC = [
  { key: 'brew', uses: ['brew-beer', 'brew-soft'] },
  { key: 'sout', uses: ['pack33', 'pack75', 'packmix', 'packcan', 'keg'] }];
const LG_TYPE: any = { pack33: '33 cl', pack75: '75 cl', packmix: 'mix', packcan: 'canette', keg: 'fûts 20 L' };

function marginDesc(c: any, r: any) {
  if (c.targetMode === 'batch') return `Prix imposé pour le brassin : marge réelle ${fnum(c.realMarkup * 100)} % sur coût`;
  if (c.targetMode === 'piece') return `Prix imposé par format (marge réelle moy. ${fnum(c.realMarkup * 100)} % sur coût)`;
  return c.perFmt ? `Différenciée (moy. ${fnum((c.kEff - 1) * 100)} % sur coût)` : `${fnum(num(r.margin))} % ${r.marginMode === 'margin' ? 'sur prix' : 'sur coût'}`;
}
const PalletAlert = ({ c }: any) => !c.palletBlocked ? null : (
  <div className="alert bad"><b>Palette incompatible.</b> {(PALLETS[c.palletType] || PALLETS.euro).label} : 0 caisse par palette pour {c.palletBad.map((f: any) => f.label).join(', ')}. Le calcul logistique (palettes et livraison) est suspendu pour ce{c.palletBad.length > 1 ? 's formats' : ' format'} : choisissez une autre palette, ou renseignez une capacité supérieure à 0 dans Paramètres.</div>
);

/* ---------- grille détaillée des temps (dans la recette) ---------- */
function LaborGridDraft({ d, s, c }: any) {
  const { mutate, toast, adv } = useCb();
  const G = c.grid;
  const prof = (id: string) => { const p = s.rates.find((x: any) => x.id === id); return p ? p.name : '(profil supprimé)'; };
  const resOf = (sid: string) => G.sections.find((x: any) => x.sec.id === sid);
  return (
    <>
      {LG_ACC.map((a) => {
        const secs = s.laborGrid.sections.filter((x: any) => a.uses.includes(x.use));
        const act = G.sections.filter((x: any) => a.uses.includes(x.sec.use) && x.active);
        let hh = act.reduce((t: number, x: any) => t + x.hours, 0), cs = act.reduce((t: number, x: any) => t + x.cost, 0);
        if (a.key === 'sout') { hh += G.other.hours; cs += G.other.cost; }
        const on = act.length > 0 || (a.key === 'sout' && G.other.hours > 0);
        const title = a.key === 'brew' ? (d.brewKind === 'soft' ? 'Brassage soft' : 'Brassage bière') : (act.length ? 'Soutirage · ' + act.map((x: any) => LG_TYPE[x.sec.use]).join(', ') : 'Soutirage');
        return (
          <details key={a.key} className={'lg-acc' + (on ? '' : ' is-off')} open={!!adv.current['lab-' + a.key]} onToggle={(e: any) => { adv.current['lab-' + a.key] = e.currentTarget.open; }}>
            <summary><span className="t">{title}</span><span className="sum">{on ? `${fnum(hh, 2)} h · ${eur(cs)}` : 'non utilisé'}</span></summary>
            <div className="lg-acc-b">
              {a.key === 'brew' ? (
                <div className="lg-opts" style={{ marginTop: 10 }}><div className="field"><label className="lbl-s" htmlFor="f-draft-brewKind">Type de brassage</label><Sel path="draft.brewKind" opts={[['beer', 'Brassage bière'], ['soft', 'Brassage soft']]} label="Type de brassage" /></div><span className="hint">{`Configuration : ${G.cfg === 'hd' ? 'brassin HD' : 'brassin standard'}`}</span></div>
              ) : (
                <div className="lg-opts" style={{ marginTop: 10 }}><label className="ey-chk" style={{ margin: 0 }}><Chk path="draft.mixPack" label="Cartons mixtes 33 cl et 75 cl" /> Cartons mixtes 33 cl + 75 cl</label><span className="hint">Les types de soutirage suivent les formats de la ventilation du conditionnement.</span></div>
              )}
              {!on && a.key !== 'brew' ? <p className="hint" style={{ margin: '8px 0 0' }}>Aucun temps compté : aucun format de soutirage n'est utilisé dans la ventilation.</p> : null}
              {secs.map((sec: any) => {
                const res = resOf(sec.id); if (!res || !res.active) return null;
                return (
                  <div className="lg-sec" key={sec.id}><h3><span>{sec.name}</span><span className="sum">{`${fnum(res.hours, 2)} h · ${eur(res.cost)}`}</span></h3>
                    <div className="rows">
                      {sec.tasks.map((t: any) => {
                        const r = res.rows.find((x: any) => x.t.id === t.id); if (!r) return null;
                        const nm = t.name || 'la sous-tâche', p = `draft.laborOv.${t.id}`;
                        if (t.mode === 'flat') return (
                          <div className="row r-lg r-flat" key={t.id}><span className="lbl">{t.name || 'Sous-tâche'}<span className="lab-ref">{`Forfait de référence : ${eur(r.defFlat)}`}</span></span><span className="hint">Forfait</span>
                            <div className="with-unit"><Num path={p + '.flat'} label={'Montant du forfait de ' + nm} nullable ph={fnum(r.defFlat, 2)} /><U>€</U></div><span></span><span className="out">{eur(r.cost)}</span></div>);
                        return (
                          <div className="row r-lg" key={t.id}><span className="lbl">{t.name || 'Sous-tâche'}<span className="lab-ref">{`Référence : ${fnum(r.tps, 2)} h × ${fnum(r.pers, 2)} pers. = ${fnum(r.defH, 2)} h-h`}</span></span>
                            <Sel path={p + '.profile'} opts={[['', `Par défaut · ${prof(r.defProfile)}`], ...profOpts(s, (d.laborOv[t.id] || {}).profile).filter((x: any) => x[0] !== '')]} label={'Profil de ' + nm} />
                            <div className="with-unit"><Num path={p + '.hours'} label={'Heures-homme de ' + nm} nullable ph={fnum(r.defH, 2)} /><U>h-h</U></div>
                            <div className="with-unit"><Num path={p + '.rate'} label={'Taux horaire de ' + nm} nullable ph={fnum(r.profRate, 2)} /><U>€/h</U></div>
                            <span className="out">{eur(r.cost)}</span></div>);
                      })}
                    </div></div>
                );
              })}
              {a.key === 'sout' ? (
                <div className="lg-sec"><h3><span>Autre soutirage / tâche générale (propre à cette recette)</span></h3><div className="rows"><div className="row r-lg"><span className="lbl">Temps passé<span className="lab-ref">Réparti sur tous les formats</span></span>
                  <Sel path="draft.soutOther.profile" opts={profOpts(s, d.soutOther.profile)} label="Profil de l'autre soutirage" />
                  <div className="with-unit"><Num path="draft.soutOther.hours" label="Heures de l'autre soutirage" min={0} /><U>h-h</U></div><span></span><span className="out">{eur(G.other.cost)}</span></div></div></div>
              ) : null}
            </div>
          </details>
        );
      })}
      <div className="sub-line"><span>Sous-total brassage, soutirage et forfait</span><span className="mono">{eur(c.moSub1)}</span></div>
      <p className="note">Les heures viennent de la grille des temps (Paramètres), selon le brassin Standard ou HD, le type de brassage et les formats utilisés. Dépliez un bloc pour changer le profil, les heures-homme, le taux horaire ou le montant d'un forfait : ces ajustements ne valent que pour cette recette et ne modifient jamais les Paramètres (champ vide = valeur de référence). Coût = heures-homme × taux, plus les forfaits.</p>
      <div className="addrow" style={{ marginTop: 10 }}>
        <Btn act="lg-reset" className="btn sm" title="Efface les profils, heures, taux et forfaits modifiés pour cette recette" onClick={() => { mutate((st: any) => { st.draft.laborOv = {}; }); toast('Valeurs de référence rétablies'); }}>Remettre les valeurs de référence</Btn>{' '}
        <Btn act="grid-to-legacy" className="btn sm" title="Revient aux quatre lignes simples (brassage, soutirage)" onClick={() => mutate((st: any) => { st.draft.laborMode = 'legacy'; })}>Revenir aux 4 lignes simples</Btn>
      </div>
    </>
  );
}

/* ---------- formulaire de la recette ---------- */
function DraftForm({ c }: any) {
  const { state, mutate, toast, ro, adv } = useCb();
  const d = state.draft, s = state.settings;
  const tot = FORMATS.reduce((a, f) => a + Math.max(0, num(d.mix[f.key])), 0);
  const defP = s.logistics.defaultPallet === 'us' ? 'us' : 'euro';
  const palletOpts = [['default', `Par défaut (${PALLETS[defP].label})`], ['euro', PALLETS.euro.label], ['us', PALLETS.us.label]].map(([v, l]: any) => {
    const bad = palletBad(s, v === 'default' ? defP : v, d);
    return [v, bad.length ? `${l} · Non compatible / Indisponible (${bad.map((f: any) => f.label).join(', ')})` : l, bad.length > 0 && v !== d.pallet];
  });
  const e = s.energyHl[c.hd ? 'hd' : 'noHd'];
  const lab = (key: string, label: string) => {
    const t = taskByRole(s, key);
    return (
      <div className="row r-lab"><span className="lbl">{t && t.name ? t.name : label}{t ? <span className="lab-ref">{`Référence : ${fnum(num(t.hours), 2)} h`}</span> : null}</span>
        <Sel path={`draft.labor.${key}.profile`} opts={profOpts(s, d.labor[key].profile)} label={'Profil ' + label} />
        <div className="with-unit"><Num path={`draft.labor.${key}.hours`} label={'Heures ' + label} /><U>h</U></div>
        <span className="out">{key === 'brew' ? eur(c.L.brew.cost) : key === 'keg' ? (c.kegShare > 0 ? eur(c.L.keg.cost) : 'non utilisé') : (c.botShare > 0 ? eur(c.L[key].cost) : 'non utilisé')}</span></div>
    );
  };
  const tog = (k: string) => ({ open: !!adv.current[k], onToggle: (ev: any) => { adv.current[k] = ev.currentTarget.open; } });
  const tr = d.trace || {}, X = d.acct || {}, dep = c.deposits;
  const bits: string[] = [];
  if (num(X.depositCase) > 0 || num(X.depositKeg) > 0) bits.push('consignes');
  if (num(X.royaltyHl) > 0) bits.push('redevance');
  if (num(X.fuelPct) > 0) bits.push('carburant');
  const pm = (d.priceTarget || {}).mode;
  const PM = (c.ingr || []);
  return (
    <div className="stack">
      <div className="card"><h2>Recette</h2>
        <div className="fields" style={{ marginTop: 12 }}>
          <div className="field" style={{ gridColumn: '1/-1' }}><label className="lbl-s" htmlFor="f-draft-name">Nom de la recette / client{d.example ? <span className="badge">Exemple</span> : null}</label><Txt path="draft.name" label="Nom de la recette" ph="ex. Tchantchès Grand Cru, Univers'ale…" /></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-status">Statut de la recette</label><Sel path="draft.status" opts={STATUSES} label="Statut de la recette" /></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-volumeId">Volume net du brassin</label><Sel path="draft.volumeId" opts={volOpts(s, d.volumeId)} label="Volume net du brassin" /></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-hd">Haute densité (HD)</label><Sel path="draft.hd" opts={[['0', 'Non'], ['1', 'Oui']]} label="Option haute densité" num /></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-plato">Degré Plato (accises)</label><div className="with-unit"><Num path="draft.plato" label="Degré Plato" /><U>°P</U></div></div>
        </div>
        <p className="note">{volOf(d, s) ? `${fnum(c.netHl)} hl nets${c.hd ? ', formule d\'énergie haute densité' : ''}.` : 'Volume supprimé de la base : choisissez un volume net.'}</p></div>

      <div className="card"><h2>Ingrédients</h2>
        <div className="rows" style={{ marginTop: 8 }}>
          <div className="row head r-ing"><span className="lbl-s">Ingrédient</span><span className="lbl-s" style={{ textAlign: 'right' }}>Quantité (kg)</span><span className="lbl-s" style={{ textAlign: 'right' }}>Coût</span><span></span></div>
          {d.ingredients.map((row: any, i: number) => {
            const x = c.ingr[i];
            return (
              <div className="row r-ing" key={i}>
                <select id={`f-draft-ingredients-${i}-ingId`} aria-label={'Ingrédient ' + (i + 1)} disabled={ro} title={x && x.ing ? `${eur(x.price)} / kg` : 'Ingrédient supprimé de la base'}
                  value={row.ingId == null ? '' : row.ingId} onChange={(ev: any) => mutate((st: any) => { st.draft.ingredients[i].ingId = ev.target.value; })}>
                  {row.ingId && !s.ingredients.some((g: any) => g.id === row.ingId) ? <option value={row.ingId}>(ingrédient supprimé)</option> : null}
                  {CATS.map((cat) => { const items = s.ingredients.filter((g: any) => g.cat === cat.id); return items.length ? <optgroup key={cat.id} label={cat.label}>{items.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}</optgroup> : null; })}
                </select>
                <div className="with-unit"><Num path={`draft.ingredients.${i}.qty`} label="Quantité en kg" /></div>
                <span className="out">{x && x.ing ? eur(x.cost) : '—'}</span>
                <button type="button" className="icon-btn" disabled={ro} aria-label="Retirer la ligne" title="Retirer" onClick={() => mutate((st: any) => { st.draft.ingredients.splice(i, 1); })}>×</button>
              </div>
            );
          })}
        </div>
        {d.ingredients.length ? null : <p className="empty">Aucun ingrédient pour l'instant.</p>}
        <div className="addrow"><Btn act="add-ing-row" className="btn sm" onClick={() => mutate((st: any) => { st.draft.ingredients.push({ ingId: (st.settings.ingredients[0] || {}).id || '', qty: 0 }); })}>Ajouter un ingrédient</Btn>{' '}
          <RefreshPricesBtn small /></div>
        <div className="total-line"><span>Total ingrédients</span><span className="mono">{eur(c.ingrCost)}</span></div></div>

      <div className="card"><h2>Énergie et eau <span className="hint">(€ HTVA)</span></h2>
        <p className="hint" style={{ margin: '2px 0 8px' }}>{`Formule ${c.hd ? 'HD' : 'non-HD'} par hL : ${fnum(num(e.eau), 3)} m³ d'eau + ${fnum(num(e.elec), 3)} kWh + ${fnum(num(e.gaz), 3)} m³ de gaz, × ${fnum(c.netHl)} hl nets = ${fnum(c.enQ.eau, 4)} m³ + ${fnum(c.enQ.elec, 4)} kWh + ${fnum(c.enQ.gaz, 4)} m³.`}</p>
        <div className="rows">
          <div className="row r-en"><span className="lbl">Eau</span><span className="out">{fnum(c.enQ.eau, 4)} m³</span><span className="out">{eur(c.en.eau)}</span></div>
          <div className="row r-en"><span className="lbl">Gaz</span><span className="out">{fnum(c.enQ.gaz, 4)} m³</span><span className="out">{eur(c.en.gaz)}</span></div>
          <div className="row r-en"><span className="lbl">Électricité</span><span className="out">{fnum(c.enQ.elec, 4)} kWh</span><span className="out">{eur(c.en.elec)}</span></div>
        </div>
        <div className="total-line"><span>Total énergie et eau</span><span className="mono">{eur(c.energyCost)}</span></div></div>

      <div className="card"><h2>Ventilation du conditionnement</h2>
        <p className="hint" style={{ margin: '2px 0 8px' }}>Part du volume net remplie dans chaque format.</p>
        <div className="rows">
          {FORMATS.map((f) => { const x = c.fm[f.key]; return (
            <div className="row r-mix" key={f.key}><span className="lbl">{f.label}</span><div className="with-unit"><Num path={`draft.mix.${f.key}`} label={'Part ' + f.label} min={0} /><U>%</U></div>
              <span className="out hint">{x.share > 0 ? `${fnum(x.liters, 2)} L · ${fnum(x.units, 0)} ${plural(x.units, f.unit)}` : '—'}</span></div>); })}
        </div>
        <div className="total-line"><span>Total</span><span className="mono">{fnum(tot, 2)} %</span></div>
        <div>{tot === 0 ? <div className="alert bad">Aucun format sélectionné : conditionnement, taxes et livraison ne sont pas calculés.</div>
          : (Math.abs(tot - 100) > 0.001 ? <div className="alert">Le total fait {fnum(tot, 2)} %. Les parts sont ramenées à 100 % au prorata.</div> : null)}</div></div>

      <div className="card"><h2>Consommables</h2>
        <p className="hint" style={{ margin: '2px 0 4px' }}>Cochez les consommables utilisés. Seuls les formats de la ventilation apparaissent.</p>
        {FORMATS.filter((f) => c.fm[f.key].share > 0).map((f) => (
          <div className="cgrp" key={f.key}><h3>{f.long}</h3><div className="rows">
            {s.consumables[f.key].map((k: any) => (
              <div className="row r-csel" key={k.id}><Chk id={'f-cons-' + k.id} path={`draft.consOff.${k.id}`} invert label={'Inclure ' + k.name} /><label htmlFor={'f-cons-' + k.id}>{k.name}</label><span className="pr">{eur(num(k.price))}{k.mode === 'forfait' ? ' · forfait' : ''}</span></div>
            ))}</div></div>
        ))}
        {c.mixTotal > 0 ? null : <p className="empty">Aucun format sélectionné dans la ventilation.</p>}
        <div className="cons-sub">
          <div className="sub-line"><span>Sous-total consommables (valeurs de base)</span><span className="mono">{eur(c.consRaw)}</span></div>
          <div className="row r-adj">
            <span className="hint" style={{ alignSelf: 'center' }}>Simulation, propre à cette recette</span>
            <div className="field"><label className="lbl-s" htmlFor="f-draft-consAdj-coef">Coefficient</label><div className="with-unit"><Num path="draft.consAdj.coef" label="Coefficient du sous-total des consommables en pourcentage" min={0} /><U>%</U></div></div>
            <div className="field"><label className="lbl-s" htmlFor="f-draft-consAdj-override">Montant imposé</label><div className="with-unit"><Num path="draft.consAdj.override" label="Montant imposé du sous-total des consommables en euros" min={0} nullable ph={fnum(c.consRaw * Math.max(0, num((d.consAdj || {}).coef)) / 100, 2)} /><U>€</U></div></div>
            <button type="button" className="btn sm" disabled={ro} title="Revient aux valeurs de base" onClick={() => { mutate((st: any) => { st.draft.consAdj = { coef: 100, override: null }; }); toast('Consommables : valeurs de base rétablies'); }}>Réinitialiser</button>
          </div>
          <div className="total-line"><span>Sous-total consommables (simulation)</span><span className="mono">{eur(c.consTotal)}</span></div>
          <p className="hint" style={{ margin: '6px 0 0' }}>Le coefficient multiplie le sous-total ; un montant imposé le remplace (le champ vide désactive l'imposition). Seule cette recette est concernée : les prix des consommables des Paramètres ne changent pas.</p>
        </div></div>

      <div className="card"><h2>Main-d'œuvre</h2>
        {d.laborMode === 'grid' ? <LaborGridDraft d={d} s={s} c={c} /> : (
          <>
            <div className="rows" style={{ marginTop: 8 }}>
              {lab('brew', 'Brassage')}
              <div className="row plain"><span className="lbl-s">Soutirage bouteilles</span></div>
              {lab('bot1', 'Aidant 1')}{lab('bot2', 'Aidant 2')}
              <div className="row plain"><span className="lbl-s">Soutirage fûts</span></div>
              {lab('keg', 'Profil unique')}
            </div>
            <div className="sub-line"><span>Sous-total brassage et soutirage</span><span className="mono">{eur(c.moSub1)}</span></div>
            <p className="note">Le soutirage est compté seulement si le format correspondant est utilisé. Les canettes passent par la prestation Cahute.</p>
            <div className="addrow" style={{ marginTop: 10 }}><Btn act="labor-defaults" className="btn sm" title="Remet les heures et profils des quatre lignes ci-dessus aux valeurs de la matrice des tâches" onClick={() => { mutate((st: any) => { applyTaskDefaults(st.draft, st.settings); }); toast('Heures et profils remis aux valeurs de référence'); }}>Remettre les valeurs de référence</Btn></div>
            <div className="addrow" style={{ marginTop: 10 }}><Btn act="labor-to-grid" className="btn primary sm" title="Remplace ces quatre lignes par la grille détaillée des temps par poste" onClick={() => { mutate((st: any) => { st.draft.laborMode = 'grid'; st.draft.laborOv = {}; }); toast('Grille détaillée activée : les heures viennent maintenant de la matrice des temps'); }}>Passer à la grille détaillée des temps</Btn></div>
          </>
        )}
        <h3 style={{ marginTop: 16 }}>Forfait main-d'œuvre</h3>
        <div className="fields">
          <div className="field"><label className="lbl-s" htmlFor="f-draft-laborFlat-mode">Application du forfait</label><Sel path="draft.laborFlat.mode" opts={[['off', 'Pas de forfait'], ['add', 'En plus du calcul au taux horaire'], ['replace', 'À la place du calcul au taux horaire']]} label="Application du forfait de main-d'œuvre" /></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-laborFlat-amount">Forfait (€ HTVA)</label><div className="with-unit"><Num path="draft.laborFlat.amount" label="Forfait de main-d'œuvre en euros" min={0} /><U>€</U></div></div>
        </div>
        <div className="sub-line"><span>Forfait retenu</span><span className="mono">{eur(c.flatMO)}</span></div>
        <p className="hint" style={{ margin: '4px 0 0' }}>{c.flatMode === 'replace' ? 'Le forfait remplace le calcul heures × taux des postes ci-dessus ; les prestations supplémentaires restent comptées.' : c.flatMode === 'add' ? 'Le forfait s\'ajoute au calcul au taux horaire.' : 'Aucun forfait appliqué.'}</p>
        <div className="addrow" style={{ marginTop: 8 }}><Btn act="flat-defaults" className="btn sm" title="Reprend le forfait défini dans les Paramètres" onClick={() => { mutate((st: any) => { const lf = st.settings.laborFlat; st.draft.laborFlat = { mode: ['add', 'replace'].includes(lf.mode) ? lf.mode : 'off', amount: Math.max(0, num(lf.amount)) }; }); toast('Forfait des Paramètres repris'); }}>Reprendre le forfait des Paramètres</Btn></div>
        <h3 style={{ marginTop: 16 }}>Prestations supplémentaires et tâches sur mesure</h3>
        <div className="rows">
          {d.extras.map((x: any, i: number) => (
            <div className="row r-extra" key={i}><span className="lbl"><Txt path={`draft.extras.${i}.label`} label="Libellé de la prestation" ph="ex. Préparation des piments pour la Badjawe Salsa" /></span>
              <Sel path={`draft.extras.${i}.profile`} opts={profOpts(s, x.profile)} label={'Profil de la tâche ' + (i + 1)} />
              <div className="with-unit"><Num path={`draft.extras.${i}.hours`} label={'Heures de la tâche ' + (i + 1)} /><U>h</U></div>
              <span className="out">{c.extras[i] ? eur(c.extras[i].cost) : ''}</span>
              <button type="button" className="icon-btn" disabled={ro} aria-label="Retirer la tâche" title="Retirer" onClick={() => mutate((st: any) => { st.draft.extras.splice(i, 1); })}>×</button></div>
          ))}
        </div>
        {d.extras.length ? null : <p className="empty" style={{ padding: '6px 0' }}>Aucune prestation supplémentaire.</p>}
        <div className="addrow"><Btn act="add-extra" className="btn sm" onClick={() => mutate((st: any) => { st.draft.extras.push({ label: '', profile: (st.settings.rates[0] || {}).id || '', hours: 1 }); })}>Ajouter une prestation sur mesure</Btn></div>
        <div className="std-add">
          <select id="std-task" aria-label="Ajouter une tâche standard" disabled={ro} value="" onChange={(ev: any) => { const t = s.tasks.find((x: any) => x.id === ev.target.value); if (t) mutate((st: any) => { st.draft.extras.push({ label: t.name, profile: t.profile, hours: num(t.hours) }); }); }}>
            <option value="">+ Ajouter une tâche standard…</option>{s.tasks.map((t: any) => <option key={t.id} value={t.id}>{(t.name || 'Tâche') + ' · ' + fnum(num(t.hours), 2) + ' h'}</option>)}</select></div>
        <div className="sub-line"><span>Sous-total heures annexes</span><span className="mono">{eur(c.extraMO)}</span></div>
        <div className="total-line"><span>Total main-d'œuvre</span><span className="mono">{eur(c.moCost)}</span></div></div>

      <div className="card"><h2>Main-d'œuvre indirecte</h2>
        <p className="hint" style={{ margin: '2px 0 8px' }}>Direction, commercial, logistique, administratif : coût par hL défini dans les Paramètres, appliqué au volume net du brassin.</p>
        <div className="sub-line"><span>Coût MOI ajusté des Paramètres <span className="hint">{s.moi && s.moi.year ? '(réf. ' + s.moi.year + ')' : ''}</span></span><span className="mono">{eur(c.moiAdjHl) + ' / hL'}</span></div>
        <div className="row r-adj">
          <span className="hint" style={{ alignSelf: 'center' }}>Ajustement propre à cette recette</span>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-moiAdj-pct">Ajustement</label><div className="with-unit"><Num path="draft.moiAdj.pct" label="Ajustement en pourcentage du coût de la main-d'œuvre indirecte pour cette recette" /><U>%</U></div></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-moiAdj-perHl">Montant personnalisé</label><div className="with-unit"><Num path="draft.moiAdj.perHl" label="Montant personnalisé de la main-d'œuvre indirecte en euros par hectolitre" min={0} nullable ph={fnum(c.moiAdjHl * (1 + num((d.moiAdj || {}).pct) / 100), 4)} /><U>€/hL</U></div></div>
          <button type="button" className="btn sm" disabled={ro} title="Revient au coût des Paramètres" onClick={() => { mutate((st: any) => { st.draft.moiAdj = { pct: 0, perHl: null }; }); toast('Main-d\'œuvre indirecte : coût des Paramètres rétabli'); }}>Réinitialiser</button>
        </div>
        <div className="sub-line"><span>Coût MOI retenu</span><span className="mono">{eur(c.moiHl) + ' / hL' + (c.moiOv ? ' · montant personnalisé' : '')}</span></div>
        <div className="total-line"><span>Coût MOI du brassin <span className="hint">{'(' + fnum(c.netHl) + ' hL nets)'}</span></span><span className="mono">{eur(c.moiCost)}</span></div>
        <p className="hint" style={{ margin: '6px 0 0' }}>Coût MOI du brassin (€) = volume net du brassin (hL) × coût MOI ajusté (€/hL). Un montant personnalisé remplace le coût des Paramètres ; le champ vide l'ignore. Seule cette recette est concernée.</p></div>

      <div className="card"><h2>Forfaits et prestations</h2>
        <p className="hint" style={{ margin: '2px 0 8px' }}>Frais fixes de la commande. La remise s'applique ligne par ligne.</p>
        <div className="rows"><div className="row head r-forf"><span className="lbl-s">Libellé</span><span className="lbl-s" style={{ textAlign: 'right' }}>Montant</span><span className="lbl-s" style={{ textAlign: 'right' }}>Remise</span><span className="lbl-s" style={{ textAlign: 'right' }}>Net</span><span></span></div>
          {d.forfaits.map((x: any, i: number) => (
            <div className="row r-forf" key={i}><span className="lbl"><Txt path={`draft.forfaits.${i}.label`} label="Libellé du forfait" ph="ex. Création recette" /></span>
              <Num path={`draft.forfaits.${i}.amount`} label={'Montant du forfait ' + (i + 1)} dec />
              <div className="with-unit"><Num path={`draft.forfaits.${i}.disc`} label={'Remise sur le forfait ' + (i + 1)} /><U>%</U></div>
              <span className="out">{c.forfaits[i] ? eur(c.forfaits[i].net) : ''}</span>
              <button type="button" className="icon-btn" disabled={ro} aria-label="Retirer le forfait" title="Retirer" onClick={() => mutate((st: any) => { st.draft.forfaits.splice(i, 1); })}>×</button></div>
          ))}
        </div>
        {d.forfaits.length ? null : <p className="empty" style={{ padding: '6px 0' }}>Aucun forfait.</p>}
        <div className="addrow"><Btn act="add-forfait" className="btn sm" onClick={() => mutate((st: any) => { st.draft.forfaits.push({ label: '', amount: 0, disc: 0 }); })}>Ajouter un forfait</Btn>
          {PRESET_FORFAITS.map(([n, a]: any) => <Btn key={n} act="add-forfait" className="btn sm" onClick={() => mutate((st: any) => { st.draft.forfaits.push({ label: n, amount: a, disc: 0 }); })}>{`+ ${n} (${eur(a, 0)})`}</Btn>)}</div>
        <div className="total-line"><span>Total forfaits (net)</span><span className="mono">{eur(c.forfaitTotal)}</span></div></div>

      <div className="card"><h2>Livraison</h2>
        <div className="fields" style={{ marginTop: 12 }}>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-delivery">Facturation</label><Sel path="draft.delivery" opts={[['case', 'À la caisse (fûts à la palette)'], ['pallet', 'À la palette'], ['none', 'Sans livraison']]} label="Mode de livraison" /></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-pallet">Type de palette</label><Sel path="draft.pallet" opts={palletOpts} label="Type de palette de la recette" /></div>
        </div>
        <div><PalletAlert c={c} /></div>
        <p className="hint" style={{ margin: '8px 0 0' }}>{`${(PALLETS[c.palletType] || PALLETS.euro).label} · ${eur(c.palletPrice)} par palette · ${eur(num(s.logistics.perCase))} par caisse`}</p>
        <div className="rows" style={{ marginTop: 10 }}>
          {FORMATS.map((f) => { const x = c.fm[f.key]; return (
            <div className="row r-deliv" key={f.key}><span className="lbl">{f.label}</span>
              <span className="out">{x.blocked ? 'Palette non compatible : logistique non calculée' : x.units > 0 ? `${f.caseable ? `${fnum(x.cases, 0)} ${plural(x.cases, 'caisse')} · ` : ''}${fnum(x.pallets, 0)} ${plural(x.pallets, 'palette')} → ${eur(x.deliv)}` : '—'}</span></div>); })}
        </div>
        <div className="sub-line"><span>Caisses · palettes générées</span><span className="mono">{`${fnum(c.casesTotal, 0)} · ${fnum(c.palletsTotal, 0)}`}</span></div>
        <div className="total-line"><span>Total livraison</span><span className="mono">{eur(c.delivTotal)}</span></div>
        <p className="note">Tarifs et colisage : onglet Paramètres. Les palettes sont comptées par format, arrondies à la palette entière.</p></div>

      <div className="card"><h2>Marge commerciale</h2>
        <div className="fields" style={{ marginTop: 12 }}>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-marginScheme">Type de marge</label><Sel path="draft.marginScheme" opts={[['single', 'Marge unique (tout le brassin)'], ['perFormat', 'Marge différenciée par format']]} label="Type de marge" /></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-marginMode">Calculée</label><Sel path="draft.marginMode" opts={[['markup', 'En plus du coût de revient'], ['margin', 'Sur le prix de vente']]} label="Mode de calcul de la marge" /></div>
          {d.marginScheme !== 'perFormat' ? <div className="field" id="margin-single"><label className="lbl-s" htmlFor="f-draft-margin">Marge souhaitée</label><div className="with-unit"><Num path="draft.margin" label="Marge" /><U>%</U></div></div> : null}
        </div>
        {d.marginScheme === 'perFormat' ? (
          <div id="margin-fmt"><p className="hint" style={{ margin: '12px 0 4px' }}>Marge de chaque format. L'aperçu donne le prix à la pièce, HTVA.</p><div className="rows">
            {FORMATS.map((f) => <div className="row r-mix" key={f.key}><span className="lbl">{f.label}</span><div className="with-unit"><Num path={`draft.marginFmt.${f.key}`} label={'Marge ' + f.label} /><U>%</U></div><span className="out hint">{c.fm[f.key].share > 0 ? `${eur(c.fm[f.key].unitHT)} HTVA` : 'non utilisé'}</span></div>)}</div></div>
        ) : null}
        <p className="note">En plus du coût : coût × (1 + marge). Sur le prix de vente : coût ÷ (1 − marge).</p>
        <div className="pt-box" id="pt-box">
          <h3>Prix de vente souhaité (marge inverse)</h3>
          <p className="hint" style={{ margin: '0 0 8px' }}>Saisissez le prix que vous voulez obtenir : l'application en déduit la marge réelle par rapport au coût de revient.</p>
          <div className="fields">
            <div className="field"><label className="lbl-s" htmlFor="f-draft-priceTarget-mode">Saisie du prix</label><Sel path="draft.priceTarget.mode" opts={[['off', 'Non : je pars de la marge ci-dessus'], ['batch', 'Prix de vente du brassin (€ HTVA)'], ['piece', 'Prix de vente par format / pièce (€ HTVA)']]} label="Mode de saisie du prix de vente souhaité" /></div>
            {pm === 'batch' ? <div className="field" id="pt-batch"><label className="lbl-s" htmlFor="f-draft-priceTarget-batch">Prix de vente souhaité du brassin</label><div className="with-unit"><Num path="draft.priceTarget.batch" label="Prix de vente souhaité du brassin en euros HTVA" min={0} nullable ph={fnum(c.priceHT, 2)} /><U>€ HTVA</U></div></div> : null}
          </div>
          {pm === 'piece' ? (
            <div id="pt-piece"><p className="hint" style={{ margin: '12px 0 4px' }}>Prix à la pièce, HTVA. Un format laissé vide garde la marge ci-dessus.</p><div className="rows">
              {FORMATS.map((f) => { const x = c.fm[f.key]; const mk = x.unitCost > 0 ? x.unitHT / x.unitCost - 1 : null, mp = x.unitHT > 0 ? 1 - x.unitCost / x.unitHT : null; return (
                <div className="row r-mix" key={f.key}><span className="lbl">{f.label}</span><div className="with-unit"><Num path={`draft.priceTarget.piece.${f.key}`} label={'Prix de vente souhaité ' + f.label + ' en euros HTVA par ' + f.unit} min={0} nullable ph={x.share > 0 ? fnum(x.unitHT, 4) : ''} /><U>€</U></div>
                  <span className="out hint">{x.share <= 0 ? 'non utilisé' : (x.pieceOn && mk != null ? `marge réelle ${fnum(mk * 100)} % sur coût · ${fnum(mp * 100)} % sur prix` : `marge ${fnum(x.margin)} % (sans prix imposé)`)}</span></div>); })}</div></div>
          ) : null}
          {(pm === 'batch' || pm === 'piece') && c.targetMode !== 'off' ? <div className="pt-real" id="o-pt-real"><b>{`Marge réelle obtenue : ${fnum(c.realMarkup * 100)} % sur le coût de revient`}</b>{` · ${fnum(c.realMarginPrice * 100)} % sur le prix de vente`}<br />{`Prix de vente du brassin ${eur(c.priceHT)} HTVA pour un coût de ${eur(c.total)} : gain ${eur(c.gross)} HTVA.`}</div> : null}
        </div></div>

      <details className="card" {...tog('tech')}>
        <summary><h2>Suivi technique et brassage</h2><span className="sum">{[c.abv != null ? `${fnum(c.abv)} % vol.` : '', c.days > 0 ? `${fnum(c.days, 0)} j d'occupation` : ''].filter(Boolean).join(' · ') || 'à compléter'}</span></summary>
        <div className="fields">
          <div className="field"><label className="lbl-s" htmlFor="f-draft-tech-og">Densité initiale (DI / OG)</label><div className="with-unit"><Num path="draft.tech.og" label="Densité initiale en degrés Sg" dec blank ph="1.0550" /><span>°Sg</span></div></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-tech-fg">Densité finale (DF / FG)</label><div className="with-unit"><Num path="draft.tech.fg" label="Densité finale en degrés Sg" dec blank ph="1.0100" /><span>°Sg</span></div></div>
          <div className="field"><span className="lbl-s">Alcool estimé (ABV)</span><div className="disp">{c.abv != null ? `${fnum(c.abv)} % vol.` : '—'}</div></div>
          <div className="field"><span className="lbl-s">Atténuation apparente</span><div className="disp">{c.att != null ? `${fnum(c.att)} %` : '—'}</div></div>
          <div className="field"><span className="lbl-s">DI en degrés Plato</span><div className="disp">{c.ogPlato != null ? `${fnum(c.ogPlato)} °P` : '—'}</div></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-tech-efficiency">Rendement salle de brassage</label><div className="with-unit"><Num path="draft.tech.efficiency" label="Rendement de la salle de brassage" /><span>%</span></div></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-tech-loss">Pertes de fabrication</label><div className="with-unit"><Num path="draft.tech.loss" label="Pertes de fabrication en pourcentage" min={0} /><span>%</span></div></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-tech-tankDays">Occupation de la cuverie</label><div className="with-unit"><Num path="draft.tech.tankDays" label="Occupation de la cuverie en jours" min={0} /><span>jours</span></div></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-tech-referDays">Occupation en chambre de refermentation</label><div className="with-unit"><Num path="draft.tech.referDays" label="Occupation en chambre de refermentation en jours" min={0} /><span>jours</span></div></div>
          <div className="field"><span className="lbl-s">Occupation globale (cuverie + refermentation)</span><div className="disp">{c.days > 0 ? `${fnum(c.days, 0)} j` : '—'}</div></div>
        </div>
        <p className="note">ABV = (DI − DF) × 131,25. Les pertes de fabrication réduisent le volume conditionné : les coûts du brassin sont répartis sur moins de pièces et le prix au HL se calcule sur le volume conditionné. Le rendement est conservé pour vos suivis et n'influence pas encore le coût.</p>
        <p className="note">{`Volume conditionné : ${fnum(c.sellHl)} hl sur ${fnum(c.netHl)} hl nets${c.lossPct > 0 ? ` (pertes de ${fnum(c.lossPct)} %)` : ''}. Degré Plato utilisé pour les accises : ${fnum(num(d.plato))} °P.`}</p>
      </details>

      <details className="card" {...tog('trace')}>
        <summary><h2>Traçabilité et versioning</h2><span className="sum">{[tr.code, tr.version, tr.client].filter(Boolean).join(' · ') || 'à compléter'}</span></summary>
        <div className="fields">
          <div className="field"><label className="lbl-s" htmlFor="f-draft-trace-client">Client / marque partenaire</label><Txt path="draft.trace.client" label="Client ou marque partenaire" ph="ex. Taverne Tchantchès, Client interne" /></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-trace-code">Code interne / référence</label><Txt path="draft.trace.code" label="Code interne de la recette" ph="ex. BAD-2026-001" /></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-trace-version">Version</label><Txt path="draft.trace.version" label="Version de la recette" ph="ex. v1.0" /></div>
          <div className="field"><span className="lbl-s">Dernière révision</span><div className="disp">{tr.revised ? fmtDate(tr.revised) : "À l'enregistrement"}</div></div>
        </div>
        <p className="note">La date de révision se remplit toute seule avec la date du jour à chaque enregistrement de la recette.</p>
      </details>

      <details className="card" {...tog('acct')}>
        <summary><h2>Comptabilité et logistique complémentaire</h2><span className="sum">{bits.length ? bits.join(' · ') : 'aucun'}</span></summary>
        <div className="fields">
          <div className="field"><label className="lbl-s" htmlFor="f-draft-acct-depositCase">Consigne casier</label><div className="with-unit"><Num path="draft.acct.depositCase" label="Consigne par casier" dec min={0} /><span>€ / casier</span></div></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-acct-depositKeg">Consigne fût</label><div className="with-unit"><Num path="draft.acct.depositKeg" label="Consigne par fût" dec min={0} /><span>€ / fût</span></div></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-acct-royaltyHl">Redevance / commission sur marque</label><div className="with-unit"><Num path="draft.acct.royaltyHl" label="Redevance sur marque par HL" dec min={0} /><span>€ / HL</span></div></div>
          <div className="field"><label className="lbl-s" htmlFor="f-draft-acct-fuelPct">Surcharge carburant logistique</label><div className="with-unit"><Num path="draft.acct.fuelPct" label="Surcharge carburant en pourcentage" min={0} /><span>%</span></div></div>
        </div>
        <p className="hint" style={{ margin: '10px 0 0' }}>{`Consignes à facturer en plus : ${fnum(dep.caseCount, 0)} ${plural(dep.caseCount, 'casier')} (${eur(dep.caseAmt)}) · ${fnum(dep.kegCount, 0)} ${plural(dep.kegCount, 'fût')} (${eur(dep.kegAmt)}) · total ${eur(dep.total)}. Redevance : ${eur(c.royaltyTotal)}. Surcharge carburant : ${eur(c.fuelTotal)} sur ${eur(c.delivBase)} de livraison.`}</p>
        <p className="note">Les consignes sont facturées en plus des prix et ne comptent ni dans le coût de revient ni dans la marge. Le casier consigné correspond au format 33 cl consignée, et chaque fût 20 L porte une consigne. La redevance s'ajoute au coût de revient sur le volume conditionné. La surcharge carburant majore les frais de livraison.</p>
      </details>
    </div>
  );
}

function RefreshPricesBtn({ small }: any) {
  const { refreshPrices } = useCb();
  return <Btn act="refresh-prices" className={small ? 'btn sm' : 'btn'} title="Relit les prix de la table des ingrédients et recalcule la recette" onClick={refreshPrices}>⟳ Actualiser les prix des ingrédients</Btn>;
}

/* ---------- panneau de résultats ---------- */
function ResultsCard({ c }: any) {
  const { state } = useCb();
  const d = state.draft, s = state.settings;
  const parts: any[] = [['Ingrédients', c.ingrCost, '--c1'], ['Main-d\'œuvre', c.moCost, '--c2'], ['Main-d\'œuvre indirecte', c.moiCost, '--c9'], ['Énergie et eau', c.energyCost, '--c3'], ['Consommables', c.consTotal, '--c4'], ['Taxes et accises', c.taxTotal, '--c5'], ['Forfaits et prestations', c.forfaitTotal, '--c6'], ['Livraison', c.delivTotal, '--c7'], ['Redevance de marque', c.royaltyTotal, '--c8']];
  const used = FORMATS.filter((f) => c.fm[f.key].share > 0);
  const missing = c.ingr.filter((x: any) => !x.ing).length;
  const warns: string[] = [];
  if (!volOf(d, s)) warns.push('Le volume net de cette recette n\'existe plus dans la base : choisissez-en un autre.');
  if (!c.ingr.length) warns.push('Ajoutez au moins un ingrédient pour obtenir un coût réaliste.');
  if (missing) warns.push(`${missing} ingrédient${missing > 1 ? 's' : ''} supprimé${missing > 1 ? 's' : ''} de la base : compté${missing > 1 ? 's' : ''} à 0 €.`);
  if (c.kBad) warns.push('Une marge de 100 % sur le prix de vente est impossible.');
  const mTxt = c.targetMode !== 'off' ? marginDesc(c, d).replace(/^./, (m: string) => m.toLowerCase()) : d.marginScheme === 'perFormat' ? `marges différenciées (moyenne ${fnum((c.kEff - 1) * 100)} % sur coût)` : `marge ${fnum(num(d.margin))} % ${d.marginMode === 'margin' ? 'sur prix' : 'sur coût'}`;
  const ptxt = (PALLETS[c.palletType] || PALLETS.euro).label;
  const trc = d.trace || {}, trLine = [trc.code, trc.version, trc.client].filter(Boolean).join(' · ');
  const KV = ({ l, v }: any) => <div className="kv"><span>{l}</span><span>{v}</span></div>;
  const dp = c.deposits;
  const hasTech = c.targetMode !== 'off' || c.abv != null || num(d.tech.efficiency) > 0 || c.lossPct > 0 || c.days > 0 || c.royaltyTotal > 0 || c.fuelPct > 0;
  return (
    <div className="card" id="results">
      <h2>{d.name || 'Recette sans nom'}{d.example ? <span className="badge">Exemple</span> : null}</h2>
      {trLine ? <p className="hint" style={{ margin: '2px 0 0' }}>{trLine}</p> : null}
      <p className="hint" style={{ margin: '2px 0 0' }}>{`${(volOf(d, s) || {}).label || 'Volume ?'}${c.hd ? ' · HD' : ''} · ${fnum(c.netHl)} hl nets · ${fnum(num(d.plato))} °P · ${mTxt}`}</p>
      <p className="hint" style={{ margin: '2px 0 0' }}>{`Livraison : ${fnum(c.palletsTotal, 0)} ${plural(c.palletsTotal, 'palette')} (${ptxt}) · ${fnum(c.casesTotal, 0)} ${plural(c.casesTotal, 'caisse')} · ${eur(c.delivTotal)}`}{c.palletBlocked ? <b style={{ color: 'var(--bad)' }}>{' · non calculé pour : ' + c.palletBad.map((f: any) => f.label).join(', ')}</b> : null}</p>
      <div className="kpis">
        <div className="kpi"><div className="v">{eur(c.perHl)}</div><div className="l">Coût de revient par HL</div></div>
        <div className="kpi"><div className="v">{eur(c.priceHlHT)}</div><div className="l">Prix de vente par HL, HTVA</div></div>
        <div className="kpi"><div className="v">{eur(c.total)}</div><div className="l">Coût du brassin</div></div>
        <div className="kpi"><div className="v">{eur(c.priceHT)}</div><div className="l">Prix du brassin, HTVA</div></div>
      </div>
      {c.total > 0 ? <div className="bar" aria-hidden="true">{parts.map((p) => <i key={p[0]} style={{ flex: `${Math.max(p[1], 0)} 1 0`, background: `var(${p[2]})` }} title={p[0]}></i>)}</div> : null}
      <div className="legend">{parts.map((p) => <div key={p[0]}><b style={{ background: `var(${p[2]})` }}></b><span>{p[0]}</span><span className="mono">{eur(p[1])}</span><em>{c.total > 0 ? pct(p[1] / c.total) : ''}</em></div>)}</div>
      {used.length ? <div className="scroll" style={{ marginTop: 14 }}><table className="fmt-tbl"><thead><tr><th>Format</th><th>Coût / pièce</th><th>Marge</th><th>HTVA</th><th>TVAC</th></tr></thead><tbody>
        {used.map((f) => { const x = c.fm[f.key]; return <tr key={f.key}><td>{f.label}<br /><span className="hint">{fnum(x.units, 0)} {plural(x.units, f.unit)}</span></td><td className="n">{eur(x.unitCost)}</td><td className="n">{fnum(x.margin)} %</td><td className="n">{eur(x.unitHT)}</td><td className="n">{eur(x.unitTTC)}</td></tr>; })}
      </tbody></table></div> : null}
      {hasTech ? (<>
        <h3 style={{ margin: '16px 0 4px' }}>Suivi et compléments</h3>
        {c.targetMode !== 'off' ? <KV l="Marge réelle obtenue" v={`${fnum(c.realMarkup * 100)} % sur coût · ${fnum(c.realMarginPrice * 100)} % sur prix`} /> : null}
        {c.abv != null ? <KV l="Alcool estimé" v={`${fnum(c.abv)} % vol.`} /> : null}
        {num(d.tech.efficiency) > 0 ? <KV l="Rendement salle de brassage" v={`${fnum(num(d.tech.efficiency))} %`} /> : null}
        {c.lossPct > 0 ? <KV l="Pertes de fabrication" v={`${fnum(c.lossPct)} % · ${fnum(c.sellHl)} hl conditionnés`} /> : null}
        {c.days > 0 ? (<>
          <KV l="Occupation de la cuverie" v={`${fnum(c.tankDays, 0)} j`} />
          {c.referDays > 0 ? (<><KV l="Occupation en chambre de refermentation" v={`${fnum(c.referDays, 0)} j`} /><KV l="Occupation globale" v={`${fnum(c.days, 0)} j`} /></>) : null}
          <KV l={'Marge brute par jour de cuverie' + (c.referDays > 0 ? ' (occupation globale)' : '')} v={eur(c.grossPerDay)} />
        </>) : null}
        {c.royaltyTotal > 0 ? <KV l="Redevance de marque" v={`${eur(c.royaltyTotal)} (${eur(num(d.acct.royaltyHl))} / HL)`} /> : null}
        {c.fuelPct > 0 ? <KV l="Surcharge carburant" v={`${eur(c.fuelTotal)} (${fnum(c.fuelPct)} %)`} /> : null}
      </>) : null}
      {dp.total > 0 ? (<>
        <h3 style={{ margin: '16px 0 4px' }}>Consignes à facturer en plus</h3>
        {dp.caseAmt > 0 ? <KV l={`Casiers (${fnum(dp.caseCount, 0)} × ${eur(dp.caseUnit)})`} v={eur(dp.caseAmt)} /> : null}
        {dp.kegAmt > 0 ? <KV l={`Fûts (${fnum(dp.kegCount, 0)} × ${eur(dp.kegUnit)})`} v={eur(dp.kegAmt)} /> : null}
        <KV l="Total des consignes" v={eur(dp.total)} />
        <p className="note">Remboursables : hors coût de revient et hors marge.</p>
      </>) : null}
      <PalletAlert c={c} />{warns.map((w) => <div className="alert" key={w}>{w}</div>)}
    </div>
  );
}

/* ---------- onglet Recette ---------- */
function RecipeTab() {
  const { state, mutate, toast, role, saveFile, getState, scrollTop, sheetOpen } = useCb();
  const s = state.settings, d = state.draft;
  const c = useMemo(() => compute(d, s), [d, s]);
  const recFile = useRef<any>(null), bakFile = useRef<any>(null);

  const savedRows = useMemo(() => state.recipes.map((r: any) => ({ r, c: compute(r, s) })), [state.recipes, s]);

  const saveRecipe = () => {
    const st0 = getState();
    const r0 = clone(st0.draft); const name = (r0.name || '').trim() || 'Recette sans nom';
    const i0 = r0.id ? st0.recipes.findIndex((x: any) => x.id === r0.id) : -1;
    const renamed = i0 >= 0 && (st0.recipes[i0].name || '').trim() !== name;
    mutate((st: any) => {
      const r = clone(st.draft); r.name = name; r.example = false; r.trace.revised = todayIso();
      const i = r.id ? st.recipes.findIndex((x: any) => x.id === r.id) : -1;
      const ren = i >= 0 && (st.recipes[i].name || '').trim() !== r.name;
      if (i >= 0 && !ren) st.recipes[i] = r; else { r.id = uid(); st.recipes.push(r); }
      st.draft.id = r.id; st.draft.name = r.name; st.draft.example = false; st.draft.trace.revised = r.trace.revised;
      if (!st.selected) st.selected = r.id;
    });
    toast(renamed ? 'Nouvelle recette créée : l\'originale est conservée' : 'Recette enregistrée');
  };
  const newRecipe = () => { mutate((st: any) => { st.draft = applyTaskDefaults(blankRecipe(), st.settings); }); scrollTop(); };
  const loadRecipe = (id: string) => { const r = state.recipes.find((x: any) => x.id === id); if (!r) return; mutate((st: any) => { st.draft = clone(r); }); scrollTop(); toast('Recette chargée'); };
  const dupRecipe = (id: string) => {
    const r = state.recipes.find((x: any) => x.id === id); if (!r) return;
    mutate((st: any) => { st.draft = clone(r); st.draft.id = null; st.draft.example = false; st.draft.name = (r.name || 'Recette') + ' (copie)'; st.draft.trace.revised = ''; });
    scrollTop(); toast('Copie prête : modifiez puis enregistrez');
  };
  const delRecipe = (id: string) => mutate((st: any) => {
    st.recipes = st.recipes.filter((x: any) => x.id !== id);
    if (st.draft.id === id) st.draft.id = null;
    if (st.selected === id) st.selected = st.recipes[0] ? st.recipes[0].id : null;
  });
  const exportJson = () => {
    const dd = clone(d); dd.name = (dd.name || '').trim() || 'Recette sans nom'; delete dd.id; dd.example = false;
    const cc = compute(dd, s), lg = s.logistics, pt = cc.palletType;
    const usedP = new Set([dd.labor.brew, dd.labor.bot1, dd.labor.bot2, dd.labor.keg, ...dd.extras, ...(cc.grid ? cc.grid.sections.flatMap((x: any) => x.rows.filter((r: any) => !r.isFlat).map((r: any) => ({ profile: r.profile }))) : []), { profile: (dd.soutOther || {}).profile }].map((l: any) => l.profile));
    const refs = {
      ingredients: dd.ingredients.map((x: any) => s.ingredients.find((i: any) => i.id === x.ingId)).filter(Boolean),
      volumes: [volOf(dd, s)].filter(Boolean),
      rates: s.rates.filter((r: any) => usedP.has(r.id)),
      logistics: { palletType: pt, palletLabel: (PALLETS[pt] || PALLETS.euro).label, perPallet: cc.palletPrice, perCase: num(lg.perCase), kegsPerPallet: num((lg.kegsPerPallet || {})[pt]), casesPerPallet: clone((lg.casesPerPallet || {})[pt] || {}) },
    };
    const formats: any = {};
    FORMATS.forEach((f) => { const x = cc.fm[f.key]; if (x.share > 0) formats[f.key] = { label: f.label, share: x.share, liters: x.liters, units: x.units, cases: x.cases, pallets: x.pallets, palletCapacity: x.cap, delivery: x.deliv, royalty: x.royalty, unitCost: x.unitCost, marginPct: x.margin, unitHT: x.unitHT, unitTTC: x.unitTTC, caseHT: f.caseable ? x.caseHT : null, caseTTC: f.caseable ? x.caseTTC : null }; });
    const result = { netHl: cc.netHl, palletType: pt, pallets: cc.palletsTotal, cases: cc.casesTotal, delivery: cc.delivTotal, total: cc.total, marginScheme: dd.marginScheme, sellHl: cc.sellHl, royalty: cc.royaltyTotal, deliveryBase: cc.delivBase, fuelSurcharge: cc.fuelTotal, abv: cc.abv, apparentAttenuation: cc.att, ogPlato: cc.ogPlato, gross: cc.gross, grossPerTankDay: cc.grossPerDay, deposits: cc.deposits, priceHT: cc.priceHT, priceTTC: cc.priceTTC, priceHlHT: cc.priceHlHT, priceHlTTC: cc.priceHlTTC, formats };
    saveFile(`${slug(dd.name) || 'recette'}.json`, JSON.stringify({ kind: 'recette-brasserie', version: 3, recipe: dd, refs, result }, null, 1), false);
  };
  const onImportRecipe = (e: any) => {
    const f = e.target.files[0]; if (!f) return;
    if (role === 'user') { e.target.value = ''; toast('Mode lecture seule : modification impossible'); return; }
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = JSON.parse(fr.result as string);
        if (data && data.settings && Array.isArray(data.recipes)) { toast('Ce fichier est une sauvegarde complète : utilisez « Restaurer une sauvegarde »'); return; }
        const rec = data && data.kind === 'recette-brasserie' ? data.recipe : data;
        if (!rec || typeof rec !== 'object' || !Array.isArray(rec.ingredients)) throw new Error('format');
        const refs = (data && data.refs) || {}; let added = 0;
        mutate((st: any) => {
          const ss = st.settings;
          (refs.ingredients || []).forEach((i: any) => { if (i && i.id && !ss.ingredients.some((x: any) => x.id === i.id)) { ss.ingredients.push({ id: i.id, cat: i.cat || 'divers', name: i.name || i.id, price: num(i.price) }); added++; } });
          (refs.volumes || []).forEach((v: any) => { if (v && v.id && !ss.volumes.some((x: any) => x.id === v.id)) { ss.volumes.push({ id: v.id, label: v.label || v.id, net: num(v.net), hd: num(v.hd) }); added++; } });
          (refs.rates || []).forEach((r: any) => { if (r && r.id && !ss.rates.some((x: any) => x.id === r.id)) { ss.rates.push({ id: r.id, name: r.name || r.id, rate: num(r.rate) }); added++; } });
          st.draft = migrateRecipe(rec); st.draft.id = null; st.draft.example = false;
        });
        scrollTop();
        toast(added ? `Recette importée, ${added} élément${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''} à la base` : 'Recette importée : vérifiez puis enregistrez');
      } catch (err) { toast('Fichier de recette non reconnu'); }
    };
    fr.readAsText(f); e.target.value = '';
  };
  const onImportBackup = (e: any) => {
    const f = e.target.files[0]; if (!f) return;
    if (role !== 'admin') { e.target.value = ''; toast('Action réservée aux administrateurs'); return; }
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = JSON.parse(fr.result as string);
        if (data && data.kind === 'recette-brasserie') { toast('Ce fichier est une seule recette : utilisez « Importer une recette »'); return; }
        const st = mergeState(data); if (!st) throw new Error('format');
        getState.replace(st); toast('Sauvegarde restaurée');
      } catch (err) { toast('Fichier de sauvegarde non reconnu'); }
    };
    fr.readAsText(f); e.target.value = '';
  };

  return (
    <div className="split">
      <DraftForm c={c} />
      <div className="aside">
        <ResultsCard c={c} />
        <RefreshPricesBtn />
        <div className="card">
          <div className="btn-row">
            <Btn act="save-recipe" className="btn primary" onClick={saveRecipe}>Enregistrer la recette</Btn>
            <Btn act="new-recipe" onClick={newRecipe}>Nouvelle recette</Btn>
          </div>
          <p className="note">Les montants se recalculent avec les paramètres en vigueur.</p>
        </div>
        <div className="card">
          <h2>Import et export</h2>
          <h3 style={{ marginTop: 12 }}>Recette en cours</h3>
          <div className="btn-row">
            <Btn act="export-recipe-json" onClick={exportJson}>Exporter la recette (JSON)</Btn>
            <Btn act="export-draft" onClick={() => saveFile(`${slug(d.name || 'recette') || 'recette'}.csv`, draftCSV(state), true)}>Exporter la recette (CSV)</Btn>
            <Btn act="import-recipe" onClick={() => recFile.current && recFile.current.click()}>Importer une recette</Btn>
          </div>
          <h3 style={{ marginTop: 14 }}>Toute la base</h3>
          <div className="btn-row">
            <Btn act="backup-export" onClick={() => saveFile('sauvegarde-calculateur-brassin.json', JSON.stringify(state, null, 1), false)}>Sauvegarder toute la base</Btn>
            {role === 'admin' ? <Btn act="backup-import" onClick={() => bakFile.current && bakFile.current.click()}>Restaurer une sauvegarde</Btn> : null}
          </div>
          <input type="file" ref={recFile} id="import-recipe-file" accept=".json,application/json" hidden onChange={onImportRecipe} />
          <input type="file" ref={bakFile} id="import-file" accept=".json,application/json" hidden onChange={onImportBackup} />
          <p className="note">Le JSON d'une recette embarque ses ingrédients, son volume et ses profils : à l'import, ceux qui manquent dans votre base sont ajoutés. La sauvegarde complète contient toutes les recettes et tous les paramètres.</p>
        </div>
        <div className="card">
          <h2>Recettes enregistrées</h2>
          <div className="saved">
            {state.recipes.length === 0 ? <p className="empty">Aucune recette enregistrée. Remplissez le formulaire puis cliquez sur « Enregistrer la recette ».</p> : savedRows.map(({ r, c: cc }: any) => (
              <div className="it" key={r.id}><div className="nm"><b>{r.name || 'Recette sans nom'}{r.example ? <span className="badge">Exemple</span> : null}</b><span>{`${statusLabel(r)} · ${r.trace && r.trace.code ? `${r.trace.code} ${r.trace.version || ''} · ` : ''}${fnum(cc.netHl)} hl nets · ${fnum(num(r.plato))} °P · ${eur(cc.priceHlHT)} / HL HTVA`}</span></div>
                <div className="btn-row">
                  <Btn act="load-recipe" className="btn sm" onClick={() => loadRecipe(r.id)}>Charger</Btn>
                  {canDo(role, 'write') ? <Btn act="dup-recipe" className="btn sm" onClick={() => dupRecipe(r.id)}>Dupliquer</Btn> : null}
                  {canDo(role, 'delete') ? <ConfirmButton act="del-recipe" className="btn sm danger" confirmText="Confirmer" onConfirm={() => delRecipe(r.id)}>Supprimer</ConfirmButton> : null}
                </div></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


/* ====================================================================
   ONGLET 4 : ANALYSE ANNUELLE ET RENTABILITÉ (administrateurs)
   ==================================================================== */
function AnnualTab() {
  const { state, mutate, toast, ro, saveFile } = useCb();
  const A = state.annual;
  const a = useMemo(() => annualCalc(state.recipes, state.settings, A), [state.recipes, state.settings, A]);
  const [fName, setFName] = useState(''), [fAmt, setFAmt] = useState('');
  const pc = (v: number) => fnum(v * 100, 2) + ' %';
  const ex = state.recipes.filter((r: any) => r.status !== 'permanente' && r.status !== 'facon').length;
  const loss = a.resSim < 0, zero = Math.abs(a.resSim) < 5e-5;
  const dlt = (s: number, b: number, f: any) => { const d = s - b; return Math.abs(d) < 5e-9 ? '—' : (d > 0 ? '+' : '−') + f(Math.abs(d)); };
  const beD = (a.breakEvenBase == null || a.breakEvenSim == null || Math.abs(a.breakEvenSim - a.breakEvenBase) < 5e-9) ? '—' : (a.breakEvenSim > a.breakEvenBase ? '+' : '−') + fnum(Math.abs(a.breakEvenSim - a.breakEvenBase), 2) + ' hL';
  const resCls = (v: number) => (v < -5e-5 ? 'an-neg' : v > 5e-5 ? 'an-pos' : '');

  const TotRow = ({ t, label, cls, base }: any) => (
    <tr className={cls}><td>{label}</td><td className="n">{fnum(t.base, 2)}</td><td></td>
      <td className="n">{fnum(t.sim, 2)}</td><td className="n">{a.tot.sim > 0 ? pc(t.sim / a.tot.sim) : '—'}</td>
      <td className="n">{t.sim > 0 ? eurH(t.mHlSim, 4) : '—'}</td><td className="n">{t.revSim > 0 ? pc(t.mPctSim) : '—'}</td>
      <td className="n">{eurH(t.contribSim)}</td><td className="n">{a.tot.contribSim !== 0 ? pc(t.contribSim / a.tot.contribSim) : '—'}</td></tr>
  );
  const BeerRow = ({ x }: any) => (
    <tr><td className="nm">{x.r.name || 'Recette sans nom'}{x.r.example ? <span className="badge">Exemple</span> : null}{x.r.trace && x.r.trace.client ? <small>{x.r.trace.client}</small> : null}</td>
      <td><Num path={`annual.vol.${x.r.id}`} label={'Volume annuel de ' + (x.r.name || 'la recette') + ' en hL par an'} ph="0" blank /></td>
      <td><Num path={`annual.var.${x.r.id}`} label={'Variation du volume de ' + (x.r.name || 'la recette') + ' en %'} ph="0" blank /></td>
      <td className="n">{fnum(x.sim, 2)}</td><td className="n">{a.tot.sim > 0 ? pc(x.shareSim) : '—'}</td>
      <td className="n">{x.c.sellHl > 0 ? eurH(x.mHl, 4) : '—'}</td><td className="n">{x.priceHl > 0 ? pc(x.mPct) : '—'}</td>
      <td className="n">{eurH(x.contribSim)}</td><td className="n">{a.tot.contribSim !== 0 ? pc(x.contribShareSim) : '—'}</td></tr>
  );
  const Grp = ({ title, empty, list, t, tl }: any) => (
    <>
      <tr className="grp"><td colSpan={9}>{title}</td></tr>
      {list.length ? <>{list.map((x: any) => <BeerRow key={x.r.id} x={x} />)}<TotRow t={t} label={tl} cls="subtot" /></> : <tr><td colSpan={9} className="hint">{empty}</td></tr>}
    </>
  );
  const Res = ({ label, b, s, f, cls, bold }: any) => (
    <tr className={bold ? 'tot' : ''}><td>{label}</td><td className={'n ' + (cls ? resCls(b) : '')}>{f(b)}</td><td className={'n ' + (cls ? resCls(s) : '')}>{f(s)}</td><td className="n">{dlt(s, b, f)}</td></tr>
  );

  return (
    <div>
      <div className="sec-title"><h2>Analyse annuelle et rentabilité</h2><Btn act="export-annual" className="btn sm" onClick={() => saveFile('analyse-annuelle-rentabilite.csv', annualCSV(state), true)}>Exporter en CSV (Excel)</Btn></div>
      <div className="card">
        <div className="an-kpis">
          <div className="kpi"><div className="v">{fnum(a.tot.sim, 2) + ' hL'}</div><div className="l">Volume annuel (simulé)</div></div>
          <div className="kpi"><div className="v">{eurH(a.tot.contribSim)}</div><div className="l">Marge brute annuelle (simulée)</div></div>
          <div className="kpi"><div className="v">{eurH(a.fixedTotal)}</div><div className="l">Charges fixes annuelles</div></div>
          <div className="kpi"><div className={'v ' + resCls(a.resSim)}>{eurH(a.resSim)}</div><div className="l">Résultat d'exploitation (simulé)</div></div>
        </div>
        <div className={'an-banner' + (loss ? ' loss' : '')} role="status">{zero ? `Résultat d'exploitation à l'équilibre : ${eurH(0)} par an` : `${loss ? 'Perte nette' : 'Bénéfice net'} annuel(le) : ${eurH(Math.abs(a.resSim))}${a.rows.length ? '' : ' (aucun volume saisi)'}`}</div>
      </div>

      <div className="sec-title"><h2>Simulation des volumes</h2><p>Faites varier les ventes et observez l'effet sur le résultat</p></div>
      <div className="card"><div className="ey-bar"><div className="field"><label className="lbl-s" htmlFor="f-annual-global">Variation globale des volumes (%)</label><div className="with-unit"><Num path="annual.global" label="Variation globale des volumes en pourcentage" blank ph="0" /><span>%</span></div></div>
        <p className="hint" style={{ margin: 0, flex: '1 1 260px' }}>+10 pour 10 % de ventes en plus, −20 pour 20 % en moins. Elle se combine avec la variation propre à chaque bière (colonne « Var. % »).</p></div></div>

      <div className="sec-title"><h2>Répartition des volumes et marges</h2><p>Montants en € HTVA ; marge = prix de vente HTVA − coût de revient (par hL conditionné)</p></div>
      <div className="card"><div className="scroll"><table className="fmt-tbl ey-tbl an-tbl"><thead><tr><th>Bière</th><th className="n">Volume (hL/an)</th><th className="n">Var. %</th><th className="n">Volume simulé (hL/an)</th><th className="n">% du volume</th><th className="n">Marge (€ HTVA/hL)</th><th className="n">Marge (%)</th><th className="n">Contribution (€ HTVA/an)</th><th className="n">% du bénéfice brut</th></tr></thead>
        <tbody>
          <Grp title="Bières permanentes" empty="Aucune recette enregistrée avec le statut « Bière permanente »." list={a.perm} t={a.tPerm} tl="Total bières permanentes" />
          <Grp title="Bières à façon" empty="Aucune recette enregistrée avec le statut « Bière à façon »." list={a.facon} t={a.tFacon} tl="Total bières à façon (regroupées)" />
          <TotRow t={a.tot} label="Total général" cls="tot" />
        </tbody></table></div>
        <p className="note">Le volume saisi est exprimé en hL conditionnés et vendus, comme le coût de revient et le prix de vente par hL de chaque recette. Seules les recettes <b>enregistrées</b> classées « permanente » ou « à façon » comptent ; les simulations, devis et recettes expérimentales sont exclus. {ex ? `${ex} recette${ex > 1 ? 's' : ''} exclue${ex > 1 ? 's' : ''} de l'analyse (simulation, devis ou expérimentale).` : ''}</p></div>

      <div className="sec-title"><h2>Charges fixes annuelles</h2><p>Montants en € HTVA par an</p></div>
      <div className="card"><div className="rows">
        {A.fixed.map((f: any, i: number) => (
          <div className="row an-fixed" key={f.id}><Txt path={`annual.fixed.${i}.name`} label="Nature de la charge fixe" />
            <div className="with-unit"><Num path={`annual.fixed.${i}.amount`} label={'Montant annuel de ' + (f.name || 'la charge') + ' en € HTVA'} blank ph="0" /><span>€ HTVA/an</span></div>
            <button type="button" className="icon-btn" disabled={ro} aria-label={'Supprimer ' + (f.name || 'la charge')} title="Supprimer" onClick={() => mutate((st: any) => { st.annual.fixed.splice(i, 1); })}>✕</button></div>
        ))}</div>
        <div className="addrow">
          <input type="text" disabled={ro} placeholder="Nouvelle charge (ex. Assurances)" aria-label="Nom de la nouvelle charge fixe" value={fName} onChange={(e: any) => setFName(e.target.value)} />
          <input type="number" disabled={ro} className="num" inputMode="decimal" step="0.0001" placeholder="€ HTVA/an" aria-label="Montant annuel de la nouvelle charge" value={fAmt} onChange={(e: any) => setFAmt(e.target.value)} />
          <button type="button" className="btn sm" disabled={ro} onClick={() => { const n = fName.trim(); if (!n) { toast('Indiquez la nature de la charge'); return; } mutate((st: any) => { st.annual.fixed.push({ id: uid(), name: n, amount: num(fAmt) }); }); setFName(''); setFAmt(''); }}>Ajouter une charge</button></div>
        <div className="total-line"><span>Total des charges fixes</span><span className="mono">{eurH(a.fixedTotal)}</span></div>
        <p className="note">Le coût de revient d'une recette inclut déjà la main-d'œuvre de brassage et de conditionnement, l'énergie, les taxes et la livraison. N'inscrivez en « Personnel » que la part qui n'y figure pas, pour ne pas la compter deux fois.</p></div>

      <div className="sec-title"><h2>Résultat d'exploitation annuel</h2><p>Bénéfice / Perte = marge brute totale − charges fixes</p></div>
      <div className="card"><div className="scroll"><table className="fmt-tbl ey-tbl"><thead><tr><th>€ HTVA par an</th><th className="n">Volumes saisis</th><th className="n">Scénario simulé</th><th className="n">Écart</th></tr></thead><tbody>
        <Res label="Volume total (hL/an)" b={a.tot.base} s={a.tot.sim} f={(v: number) => fnum(v, 2)} />
        <Res label="Chiffre d'affaires HTVA" b={a.tot.revBase} s={a.tot.revSim} f={(v: number) => eurH(v)} />
        <Res label="Marge brute totale" b={a.tot.contribBase} s={a.tot.contribSim} f={(v: number) => eurH(v)} />
        <Res label="− Charges fixes" b={a.fixedTotal} s={a.fixedTotal} f={(v: number) => eurH(v)} />
        <Res label="Bénéfice / Perte nette" b={a.resBase} s={a.resSim} f={(v: number) => eurH(v)} cls bold />
        <tr><td>Seuil de rentabilité (hL/an)</td><td className="n">{a.breakEvenBase == null ? '—' : fnum(a.breakEvenBase, 2) + ' hL'}</td><td className="n">{a.breakEvenSim == null ? '—' : fnum(a.breakEvenSim, 2) + ' hL'}</td><td className="n">{beD}</td></tr></tbody></table></div>
        <p className="note">Seuil de rentabilité = charges fixes ÷ marge moyenne par hL du mélange de bières.</p></div>

      <div className="sec-title"><h2>Classification des recettes enregistrées</h2><p>Choisissez le statut de chaque recette</p></div>
      <div className="card">{state.recipes.length ? <div className="scroll"><table className="fmt-tbl an-tbl"><thead><tr><th>Recette</th><th style={{ textAlign: 'left' }}>Statut</th></tr></thead><tbody>
        {state.recipes.map((r: any, i: number) => <tr key={r.id}><td className="nm">{r.name || 'Recette sans nom'}{r.example ? <span className="badge">Exemple</span> : null}</td><td style={{ textAlign: 'left' }}><Sel path={`recipes.${i}.status`} opts={STATUSES} label={'Statut de ' + (r.name || 'la recette')} /></td></tr>)}
      </tbody></table></div> : <p className="empty">Aucune recette enregistrée.</p>}</div>
    </div>
  );
}

function annualCSV(state: any) {
  const a = annualCalc(state.recipes, state.settings, state.annual), out: any[] = [];
  out.push(['Analyse annuelle et rentabilité (montants en € HTVA)'], [], ['Bière', 'Statut', 'Volume saisi (hL/an)', 'Variation (%)', 'Volume simulé (hL/an)', '% du volume', 'Marge (€/hL)', 'Marge (%)', 'Contribution (€/an)', '% du bénéfice brut']);
  a.rows.forEach((x: any) => out.push([x.r.name || 'Sans nom', statusLabel(x.r), x.base, x.v, x.sim, x.shareSim * 100, x.mHl, x.mPct * 100, x.contribSim, x.contribShareSim * 100]));
  out.push(['Total bières permanentes', '', a.tPerm.base, '', a.tPerm.sim, a.tot.sim > 0 ? a.tPerm.sim / a.tot.sim * 100 : 0, a.tPerm.mHlSim, a.tPerm.mPctSim * 100, a.tPerm.contribSim, ''],
    ['Total bières à façon', '', a.tFacon.base, '', a.tFacon.sim, a.tot.sim > 0 ? a.tFacon.sim / a.tot.sim * 100 : 0, a.tFacon.mHlSim, a.tFacon.mPctSim * 100, a.tFacon.contribSim, ''],
    ['Total général', '', a.tot.base, '', a.tot.sim, 100, a.tot.mHlSim, a.tot.mPctSim * 100, a.tot.contribSim, 100], [],
    ['Variation globale des volumes (%)', num(state.annual.global)], [], ['Charges fixes annuelles', 'Montant (€ HTVA/an)']);
  state.annual.fixed.forEach((f: any) => out.push([f.name, num(f.amount)]));
  out.push(['Total des charges fixes', a.fixedTotal], [], ['Résultat', 'Volumes saisis', 'Scénario simulé'],
    ['Marge brute totale', a.tot.contribBase, a.tot.contribSim], ['Charges fixes', a.fixedTotal, a.fixedTotal], ['Bénéfice / Perte nette', a.resBase, a.resSim],
    ['Seuil de rentabilité (hL/an)', a.breakEvenBase == null ? '' : a.breakEvenBase, a.breakEvenSim == null ? '' : a.breakEvenSim]);
  return toCSV(out.map((r: any[]) => r.map((v) => (typeof v === 'number' ? csvNum(v) : v))));
}


/* ---------- fonctions de comparaison et d'export (reprises de la version HTML) ---------- */
function csvNum(v){ return String(Math.round(v*10000)/10000).replace('.',','); }
function toCSV(rows){
  return rows.map(r=>r.map(v=>{
    if(typeof v==='number') return isFinite(v)?csvNum(v):'';
    const t = String(v==null?'':v);
    return /[;"\n]/.test(t) ? '"'+t.replace(/"/g,'""')+'"' : t;
  }).join(';')).join('\r\n');
}
function cmpRecipes(state){
  const get = id=>state.recipes.find(r=>r.id===id) || null;
  return [get(state.selected), get(state.cmpB), get(state.cmpC)];
}
function buildCompare(state){
  const s = state.settings;
  const calcs = cmpRecipes(state).map(r=>r ? {r, c:compute(r,s)} : null);
  const live = calcs.filter(Boolean);
  const used = FORMATS.filter(f=>live.some(x=>x.c.fm[f.key].share>0));
  const rows = [];
  const sec = label=>rows.push({sec:label});
  const sub = label=>rows.push({subsec:label});
  const row = (label,fn,fmt,strong,indent,cls)=>rows.push({label,fmt,strong,indent,cls,cells:calcs.map(x=>x ? fn(x.c,x.r) : {})});
  const ifUsed = (f,fn)=>(c)=> c.fm[f.key].share>0 ? fn(c.fm[f.key]) : {};
  sec('Recette');
  row('Volume', (c,r)=>({t:(volOf(r,s)||{}).label||'—'}), 'txt');
  row('Volume net', c=>({v:c.netHl}), 'hl');
  row('Haute densité', c=>({t:c.hd?'Oui':'Non'}), 'txt');
  row('Degré Plato', (c,r)=>({v:num(r.plato)}), 'plato');
  row('Marge', (c,r)=>({t: marginDesc(c,r)}), 'txt');
  row('Statut', (c,r)=>({t:statusLabel(r)}), 'txt');
  row('Client / marque', (c,r)=>({t:(r.trace&&r.trace.client)||'—'}), 'txt');
  row('Code interne', (c,r)=>({t:(r.trace&&r.trace.code)||'—'}), 'txt');
  row('Version', (c,r)=>({t:(r.trace&&r.trace.version)||'—'}), 'txt');
  row('Dernière révision', (c,r)=>({t:(r.trace&&r.trace.revised)?fmtDate(r.trace.revised):'—'}), 'txt');
  sec('Suivi technique');
  row('Densité initiale (DI)', (c,r)=>({v:num(r.tech.og)>0?num(r.tech.og):null}), 'sg');
  row('Densité finale (DF)', (c,r)=>({v:num(r.tech.fg)>0?num(r.tech.fg):null}), 'sg');
  row('Alcool estimé', c=>({v:c.abv}), 'abv');
  row('Rendement salle de brassage', (c,r)=>({v:num(r.tech.efficiency)>0?num(r.tech.efficiency):null}), 'pct');
  row('Pertes de fabrication', c=>({v:c.lossPct}), 'pct');
  row('Volume conditionné', c=>({v:c.sellHl}), 'hl');
  row('Occupation de la cuverie', c=>({v:c.tankDays>0?c.tankDays:null}), 'days');
  row('Occupation en chambre de refermentation', c=>({v:c.referDays>0?c.referDays:null}), 'days');
  row('Occupation globale (cuverie + refermentation)', c=>({v:c.days>0?c.days:null}), 'days', true);
  row('Marge brute par jour de cuverie', c=>({v:c.grossPerDay}), 'eur');
  sec('Décomposition des coûts, par brassin');
  const allZero = fn=>calcs.every(x=>!x || !(Math.abs(fn(x.c,x.r).v||0)>1e-9));
  const share = (c,k)=>c.total>0 ? pct(c[k]/c.total) : '';
  const cat = (label,key,details)=>{
    details.forEach(([l,fn])=>{ if(!allZero(fn)) row(l, (c,r)=>({v:fn(c,r).v}), 'eur', false, true); });
    row('Sous-total · '+label, c=>({v:c[key], sub:share(c,key)}), 'eur', false, false, 'subtot');
  };
  const ingNames = []; calcs.forEach(x=>{ if(x) x.c.ingr.forEach(g=>{ const n = g.ing ? g.ing.name : '(supprimé)'; if(!ingNames.includes(n)) ingNames.push(n); }); });
  cat('Ingrédients','ingrCost', ingNames.map(n=>[n, c=>({v:c.ingr.filter(g=>(g.ing?g.ing.name:'(supprimé)')===n).reduce((a,g)=>a+g.cost,0)})]));
  cat('Main-d\'œuvre','moCost', [['Heures de brassage et de soutirage', c=>({v:c.moCost-c.flatMO-c.extraMO})],['Forfait main-d\'œuvre', c=>({v:c.flatMO})],['Prestations supplémentaires', c=>({v:c.extraMO})]]);
  cat('Main-d\'œuvre indirecte','moiCost', []);
  cat('Énergie et eau','energyCost', [['Eau', c=>({v:c.en.eau})],['Gaz', c=>({v:c.en.gaz})],['Électricité', c=>({v:c.en.elec})]]);
  cat('Consommables','consTotal', used.map(f=>[`Consommables · ${f.label}`, c=>({v:c.fm[f.key].consumables})]));
  cat('Taxes et accises','taxTotal', used.map(f=>[`Accises et écotaxe · ${f.label}`, c=>({v:c.fm[f.key].taxes})]));
  const foNames = []; calcs.forEach(x=>{ if(x) x.c.forfaits.forEach(g=>{ if(!foNames.includes(g.label)) foNames.push(g.label); }); });
  cat('Forfaits et prestations','forfaitTotal', foNames.map(n=>[n||'Forfait', c=>({v:c.forfaits.filter(g=>g.label===n).reduce((a,g)=>a+g.net,0)})]));
  cat('Livraison','delivTotal', [['Frais de livraison hors carburant', c=>({v:c.delivBase})],['Surcharge carburant', c=>({v:c.fuelTotal})]]);
  cat('Redevance de marque','royaltyTotal', []);
  row('Total général du coût de revient du brassin', c=>({v:c.total}), 'eur', false, false, 'grand');
  sec('Livraison et palettes');
  row('Type de palette', c=>({t:(PALLETS[c.palletType]||PALLETS.euro).label+(c.palletBlocked?' ⚠ non compatible':'')}), 'txt');
  row('Prix par palette', c=>({v:c.palletPrice}), 'eur');
  row('Caisses', c=>({v:c.casesTotal}), 'int');
  row('Palettes', c=>({v:c.palletsTotal}), 'int');
  used.forEach(f=>row(`Palettes · ${f.label}`, ifUsed(f,x=>x.blocked?{t:'Non compatible'}:{v:x.pallets}), 'int', false, true));
  row('Frais de livraison', c=>({v:c.delivTotal, sub:c.palletBlocked?`non calculé : ${c.palletBad.map(f=>f.label).join(', ')}`:''}), 'eur', true);
  row('dont surcharge carburant', c=>({v:c.fuelTotal}), 'eur', false, true);
  sec('Consignes à facturer en plus des prix');
  row('Casiers consignés', c=>({v:c.deposits.caseCount}), 'int');
  row('Consigne casier, montant', c=>({v:c.deposits.caseAmt}), 'eur');
  row('Fûts', c=>({v:c.deposits.kegCount}), 'int');
  row('Consigne fût, montant', c=>({v:c.deposits.kegAmt}), 'eur');
  row('Total des consignes', c=>({v:c.deposits.total}), 'eur', true);
  sec('Coût de revient, sans marge');
  row('Par brassin', c=>({v:c.total}), 'eur');
  row('Par HL', c=>({v:c.perHl}), 'eur');
  used.forEach(f=>row(`Par ${f.unit} · ${f.label}`, ifUsed(f,x=>({v:x.unitCost})), 'eur'));
  used.filter(f=>f.caseable).forEach(f=>row(`Caisse de ${num(s.perCase[f.key])||24} · ${f.label}`, ifUsed(f,x=>({v:x.caseCost})), 'eur'));
  sec('Prix de vente avec marge');
  row('Par brassin, HTVA', c=>({v:c.priceHT}), 'eur');
  row('Par brassin, TVAC', c=>({v:c.priceTTC}), 'eur');
  row('Par HL, HTVA', c=>({v:c.priceHlHT}), 'eur');
  row('Par HL, TVAC', c=>({v:c.priceHlTTC}), 'eur');
  used.forEach(f=>{
    sub(f.long);
    row('Marge appliquée', (c,r)=> c.fm[f.key].share>0 ? {t:`${fnum(c.fm[f.key].margin)} % ${r.marginMode==='margin'?'sur prix':'sur coût'}`} : {}, 'txt', false, true);
    row(`Par ${f.unit}, HTVA`, ifUsed(f,x=>({v:x.unitHT})), 'eur', false, true);
    row(`Par ${f.unit}, TVAC`, ifUsed(f,x=>({v:x.unitTTC})), 'eur', false, true);
    if(f.caseable){
      const n = num(s.perCase[f.key])||24;
      row(`Par caisse de ${n}, HTVA`, ifUsed(f,x=>({v:x.caseHT})), 'eur', false, true);
      row(`Par caisse de ${n}, TVAC`, ifUsed(f,x=>({v:x.caseTTC})), 'eur', false, true);
    }
  });
  sec('Rentabilité globale du brassin');
  row('Total général du coût de revient du brassin (€ HTVA)', c=>({v:c.total}), 'eur', false, false, 'grand');
  row('Prix de vente total du brassin (€ HTVA)', c=>({v:c.priceHT}), 'eur', true);
  row('Gain / marge brute totale du brassin (€ HTVA)', c=>({v:c.gross}), 'eur', true);
  row('% de marge globale du brassin', c=>({v:c.realMarginPrice==null?null:c.realMarginPrice*100, sub:c.realMarkup==null?'':`${fnum(c.realMarkup*100)} % sur le coût de revient`}), 'pct', true);
  return {calcs, rows};
}
function cellText(cell,fmt){
  if(cell.t!=null) return cell.t;
  if(cell.v==null || !isFinite(cell.v)) return '—';
  if(fmt==='eur') return eur(cell.v);
  if(fmt==='hl') return fnum(cell.v)+' hl';
  if(fmt==='plato') return fnum(cell.v)+' °P';
  if(fmt==='int') return fnum(cell.v,0);
  if(fmt==='sg') return fnum(cell.v,4);
  if(fmt==='abv') return fnum(cell.v)+' % vol.';
  if(fmt==='pct') return fnum(cell.v)+' %';
  if(fmt==='days') return fnum(cell.v,0)+' j';
  return String(cell.v);
}
function promoText(p){
  if(p.scheme==='5+1') return '5 + 1 gratuit : le client paie 5 pièces sur 6';
  if(p.scheme==='10+1') return '10 + 1 gratuit : le client paie 10 pièces sur 11';
  if(p.scheme==='xy') return `${fnum(num(p.x),2)} + ${fnum(num(p.y),2)} gratuits : le client paie ${fnum(num(p.x),2)} pièces sur ${fnum(num(p.x)+num(p.y),2)}`;
  if(p.scheme==='pct') return `Remise de ${fnum(num(p.pct),2)} % sur le prix`;
  return 'Aucune promotion';
}
function promoModel(state,r){
  const s = state.settings, c = compute(r,s), p = state.promo;
  const ch = s.channels.find(x=>x.id===p.channel) || s.channels[0];
  const fac = chFactor(ch,s), pf = promoFactor(p);
  const rows = FORMATS.filter(f=>c.fm[f.key].share>0).map(f=>{
    const x = c.fm[f.key];
    const nHT = x.unitHT*fac, eHT = nHT*pf;
    return {f, cost:x.unitCost, nHT, nTTC:nHT*c.vat, eHT, eTTC:eHT*c.vat,
      cHT: f.caseable ? eHT*x.perCase : null, cTTC: f.caseable ? eHT*x.perCase*c.vat : null,
      perCase:x.perCase, margin: x.unitCost>0 ? eHT/x.unitCost-1 : NaN};
  });
  return {r, c, ch, pf, rows};
}
function promoModels(state){ return cmpRecipes(state).map((r,i)=>r ? Object.assign(promoModel(state,r),{tag:'ABC'[i]}) : null).filter(Boolean); }
function draftCSV(state){
  const d = state.draft, s = state.settings, c = compute(d,s);
  const used = FORMATS.filter(f=>c.fm[f.key].share>0);
  const out = [];
  out.push(['Recette',d.name||'Sans nom'],['Volume',(volOf(d,s)||{}).label||''],['Haute densité',c.hd?'Oui':'Non'],['Volume net (hl)',c.netHl],
    ['Degré Plato (°P)',num(d.plato)],['Type de marge',c.perFmt?'Différenciée par format':'Unique'],['Marge unique (%)',c.perFmt?'':num(d.margin)],['Mode de marge',d.marginMode==='margin'?'Sur le prix de vente':'En plus du coût de revient'],['TVA (%)',num(s.vat)],['Type de palette',(PALLETS[c.palletType]||PALLETS.euro).label],[]);
  out.push(['Traçabilité'],['Client / marque',d.trace.client||''],['Code interne',d.trace.code||''],['Version',d.trace.version||''],['Dernière révision',d.trace.revised||''],[]);
  out.push(['Suivi technique'],['Densité initiale (°Sg)',num(d.tech.og)||''],['Densité finale (°Sg)',num(d.tech.fg)||''],['Alcool estimé (% vol.)',c.abv==null?'':c.abv],
    ['Atténuation apparente (%)',c.att==null?'':c.att],['DI en degrés Plato',c.ogPlato==null?'':c.ogPlato],['Rendement salle de brassage (%)',num(d.tech.efficiency)],
    ['Pertes de fabrication (%)',c.lossPct],['Volume conditionné (hl)',c.sellHl],['Occupation de la cuverie (jours)',c.tankDays],['Occupation en chambre de refermentation (jours)',c.referDays],['Occupation globale (jours)',c.days],[]);
  out.push(['Comptabilité et logistique'],['Consigne casier (€)',num(d.acct.depositCase)],['Consigne fût (€)',num(d.acct.depositKeg)],
    ['Redevance de marque (€/HL)',num(d.acct.royaltyHl)],['Surcharge carburant (%)',c.fuelPct],[]);
  out.push(['Ingrédient','Quantité (kg)','Prix (€/kg)','Coût (€)']);
  c.ingr.forEach(x=>out.push([x.ing?x.ing.name:'(supprimé)',x.qty,x.price,x.cost]));
  out.push([],['Énergie et eau','Quantité','Coût (€)'],['Eau (m³)',c.enQ.eau,c.en.eau],['Gaz (m³)',c.enQ.gaz,c.en.gaz],['Électricité (kWh)',c.enQ.elec,c.en.elec],[]);
  out.push(['Main-d\'œuvre','Heures-homme','Taux (€/h)','Coût (€)']);
  if(c.grid) c.grid.sections.filter(x=>x.active).forEach(x=>x.rows.forEach(r=>out.push(r.isFlat ? [x.sec.name+' · '+r.t.name+' (forfait)','','',r.cost] : [x.sec.name+' · '+r.t.name, r.hrs, r.rate, r.cost])));
  else out.push(
    ['Brassage',c.L.brew.hours,c.L.brew.rate,c.L.brew.cost],
    ['Soutirage bouteilles, aidant 1',c.L.bot1.hours,c.L.bot1.rate,c.botShare>0?c.L.bot1.cost:0],
    ['Soutirage bouteilles, aidant 2',c.L.bot2.hours,c.L.bot2.rate,c.botShare>0?c.L.bot2.cost:0],
    ['Soutirage fûts',c.L.keg.hours,c.L.keg.rate,c.kegMO]);
  if(c.grid && c.grid.other.hours>0) out.push(['Autre soutirage / général', c.grid.other.hours, c.grid.other.rate, c.grid.other.cost]);
  if(c.flatMode!=='off') out.push(['Forfait main-d\'œuvre ('+(c.flatMode==='replace'?'à la place des heures':'en plus des heures')+')','','',c.flatMO]);
  if(c.consOv || Math.abs(c.consTotal-c.consRaw)>1e-9) out.push([],['Consommables : valeur de base',c.consRaw],['Consommables : simulation',c.consTotal]);
  c.extras.forEach(x=>out.push(['Heures annexes : '+(x.label||'sans libellé'),x.hours,x.rate,x.cost]));
  out.push(['Total main-d\'œuvre','','',c.moCost],[]);
  out.push(['Forfaits et prestations','Montant (€)','Remise (%)','Net (€)']);
  c.forfaits.forEach(x=>out.push([x.label||'Sans libellé',x.amount,x.disc,x.net]));
  out.push(['Total forfaits','','',c.forfaitTotal],[]);
  out.push(['Livraison',(PALLETS[c.palletType]||PALLETS.euro).label,'Prix par palette (€)',c.palletPrice,'Prix par caisse (€)',num(s.logistics.perCase)]);
  out.push(['Format','Caisses','Palettes','Capacité par palette','Coût (€)']);
  used.forEach(f=>{ const x=c.fm[f.key]; out.push(x.blocked ? [f.label,x.cases,'Non compatible',x.cap,'non calculé'] : [f.label,x.cases,x.pallets,x.cap,x.deliv]); });
  out.push(['Total livraison',c.casesTotal,c.palletsTotal,'',c.delivTotal],['dont surcharge carburant (€)','','','',c.fuelTotal],[]);
  const T = c.total;
  out.push(['Décomposition des coûts','€ par brassin','Part'],
    ['Ingrédients',c.ingrCost,T?c.ingrCost/T:0],['Main-d\'œuvre',c.moCost,T?c.moCost/T:0],['Main-d\'œuvre indirecte',c.moiCost,T?c.moiCost/T:0],['Énergie et eau',c.energyCost,T?c.energyCost/T:0],
    ['Consommables',c.consTotal,T?c.consTotal/T:0],['Taxes et accises',c.taxTotal,T?c.taxTotal/T:0],
    ['Forfaits et prestations',c.forfaitTotal,T?c.forfaitTotal/T:0],['Livraison',c.delivTotal,T?c.delivTotal/T:0],['Redevance de marque',c.royaltyTotal,T?c.royaltyTotal/T:0],['Total (coût de revient)',T,1],[],
    ['Coût de revient par HL',c.perHl],['Prix de vente par brassin HTVA',c.priceHT],['Prix de vente par brassin TVAC',c.priceTTC],
    ['Prix de vente par HL HTVA',c.priceHlHT],['Prix de vente par HL TVAC',c.priceHlTTC],
    ['Marge brute (€ HTVA)',c.gross],['Marge brute par jour de cuverie (€)',c.grossPerDay==null?'':c.grossPerDay],[],
    ['Consignes à facturer en plus (hors prix)','Quantité','Montant unitaire (€)','Montant (€)'],
    ['Casiers consignés',c.deposits.caseCount,c.deposits.caseUnit,c.deposits.caseAmt],['Fûts',c.deposits.kegCount,c.deposits.kegUnit,c.deposits.kegAmt],
    ['Total des consignes','','',c.deposits.total],[]);
  out.push(['Format','Part du volume','Litres','Pièces','Taxes par pièce','Coût par pièce','Coût par caisse','Marge (%)','Prix pièce HTVA','Prix pièce TVAC','Prix caisse HTVA','Prix caisse TVAC']);
  used.forEach(f=>{ const x=c.fm[f.key]; out.push([f.long,x.share,x.liters,x.units,x.taxUnit,x.unitCost,f.caseable?x.caseCost:'',x.margin,x.unitHT,x.unitTTC,f.caseable?x.caseHT:'',f.caseable?x.caseTTC:'']); });
  out.push([],['Grille tarifaire (prix par pièce)','Remise',...used.flatMap(f=>[f.label+' HTVA',f.label+' TVAC'])]);
  s.channels.forEach(ch=>{ const fac=chFactor(ch,s); out.push([ch.name, num(ch.pct), ...used.flatMap(f=>{ const ht=c.fm[f.key].unitHT*fac; return [ht,ht*c.vat]; })]); });
  return toCSV(out);
}
function compareCSV(state){
  const {calcs, rows} = buildCompare(state);
  const out = [['',...calcs.filter(Boolean).map((x,i)=>x.r.name||'Sans nom')]];
  rows.forEach(r=>{
    if(r.sec) out.push([r.sec]);
    else if(r.subsec) out.push([r.subsec]);
    else out.push([r.label, ...r.cells.filter((c,i)=>calcs[i]).map(c=> c.t!=null ? c.t : (c.v==null||!isFinite(c.v) ? '' : c.v))]);
  });
  promoModels(state).forEach(m=>{
    if(!m.rows.length) return;
    out.push([],['Simulateur de promotion · Recette '+m.tag+' : '+(m.r.name||'Sans nom')],['Promotion',promoText(state.promo)],['Canal',m.ch?m.ch.name:''],['Remise effective (%)',(1-m.pf)*100],[]);
    out.push(['Format','Prix normal pièce HTVA','Prix normal pièce TVAC','Prix effectif pièce HTVA','Prix effectif pièce TVAC','Prix effectif caisse HTVA','Prix effectif caisse TVAC','Coût de revient pièce','Marge réelle (%)']);
    m.rows.forEach(x=>out.push([x.f.label,x.nHT,x.nTTC,x.eHT,x.eTTC,x.cHT==null?'':x.cHT,x.cTTC==null?'':x.cTTC,x.cost,isFinite(x.margin)?x.margin*100:'']));
  });
  return toCSV(out);
}



/* ====================================================================
   ONGLET 3 : COMPARATEUR & PROMOTIONS
   ==================================================================== */
function CompareTab() {
  const { state, setAt, saveFile, ro } = useCb();
  const s = state.settings;
  const [unit, setUnit] = useState('piece');
  const recs = state.recipes;
  const ids = new Set(recs.map((r: any) => r.id));
  const val = (k: string) => (state[k] && ids.has(state[k]) ? state[k] : '');
  const selA = ids.has(state.selected) ? state.selected : (recs[0] ? recs[0].id : '');
  const opt = (r: any) => <option key={r.id} value={r.id}>{(r.name || 'Sans nom') + (r.example ? ' (exemple)' : '')}</option>;
  const empty = !recs.length;
  const built = useMemo(() => (empty ? null : buildCompare({ ...state, selected: selA })), [state, selA, empty]);
  const live = useMemo(() => cmpRecipes({ ...state, selected: selA }).map((r: any, i: number) => (r ? { r, c: compute(r, s), i, tag: 'ABC'[i] } : null)).filter(Boolean), [state, selA, s]);
  const models = useMemo(() => promoModels({ ...state, selected: selA }), [state, selA]);
  const p = state.promo;
  const chanOk = s.channels.some((c: any) => c.id === p.channel);
  const chanVal = chanOk ? p.channel : ((s.channels[0] || {}).id || '');

  /* --- comparatif --- */
  const cmpTable = () => {
    if (!built) return <p className="empty">Aucune recette enregistrée. Créez-en une dans l'onglet Recette, puis enregistrez-la pour la comparer ici.</p>;
    const { calcs, rows } = built;
    return (
      <table className="cmp"><thead><tr><th></th>{calcs.map((x: any, i: number) => {
        const tag = <span className="th-sub">{`Recette ${'ABC'[i]}${i === 0 ? ' · principale' : ''}`}</span>;
        return x ? <th key={i}>{tag}{x.r.name || 'Sans nom'}{x.r.example ? <span className="badge">Exemple</span> : null}<small>{`${fnum(x.c.netHl)} hl nets · ${fnum(num(x.r.plato))} °P`}</small></th> : <th key={i}>{tag}—</th>;
      })}</tr></thead>
        <tbody>{rows.map((r: any, k: number) => {
          if (r.sec) return <tr className="sec" key={k}><td colSpan={calcs.length + 1}>{r.sec}</td></tr>;
          if (r.subsec) return <tr className="subsec" key={k}><td colSpan={calcs.length + 1}>{r.subsec}</td></tr>;
          return <tr key={k} className={[r.strong ? 'strong' : '', r.cls || ''].join(' ').trim()}><td className={r.indent ? 'sub-l' : ''}>{r.label}</td>{r.cells.map((c: any, j: number) => {
            const t = cellText(c, r.fmt), na = t === '—';
            return <td key={j} className={'n' + (na ? ' na' : '')}>{t}{c.sub ? <small>{c.sub}</small> : null}</td>;
          })}</tr>;
        })}</tbody></table>
    );
  };

  /* --- grille tarifaire --- */
  const grid = () => {
    if (!live.length) return <p className="empty">Enregistrez une recette pour afficher sa grille tarifaire.</p>;
    const fmts = FORMATS.filter((f) => live.some((x: any) => x.c.fm[f.key].share > 0));
    if (!fmts.length) return <p className="empty">Ces recettes n'ont aucun format de conditionnement.</p>;
    const isCase = unit === 'case', n = live.length;
    return (
      <table className="price-grid"><thead>
        <tr><th rowSpan={2}>Canal</th><th rowSpan={2}>Remise</th>{fmts.map((f) => {
          const x = live.map((l: any) => l.c.fm[f.key]).find((y: any) => y.share > 0);
          const lab = isCase && f.caseable ? `Caisse de ${x.perCase} · ${f.label}` : f.label;
          return <th key={f.key} colSpan={n} className="grp">{lab}<span className="th-sub">TVAC / HTVA</span></th>;
        })}</tr>
        <tr>{fmts.map((f) => live.map((l: any, j: number) => <th key={f.key + l.tag} className={'grp-s' + (j === 0 ? ' gs' : '')} title={l.r.name || 'Sans nom'}>{'Recette ' + l.tag}</th>))}</tr></thead>
        <tbody>{s.channels.map((ch: any) => {
          const fac = chFactor(ch, s);
          let anyBelow = false;
          const base = s.channels.find((x: any) => x.id === ch.base);
          const rem = base ? `−${fnum(num(ch.pct), 2)} % sur ${base.name}` : (num(ch.pct) ? `−${fnum(num(ch.pct), 2)} %` : '—');
          const cells = fmts.map((f) => live.map((l: any, j: number) => {
            const x = l.c.fm[f.key], gs = j === 0 ? ' gs' : '';
            if (!(x.share > 0)) return <td key={f.key + l.tag} className={'na' + gs}>—</td>;
            const ht = (isCase && f.caseable ? x.caseHT : x.unitHT) * fac, ttc = ht * l.c.vat;
            const below = x.k * fac < 1 - 1e-9; if (below) anyBelow = true;
            return <td key={f.key + l.tag} className={'cell' + (below ? ' below' : '') + (ch.id === 'part' ? ' part' : '') + gs}><b>{eur(ttc)}</b><small>{eur(ht)}</small></td>;
          }));
          return <tr key={ch.id}><td>{ch.name}{anyBelow ? <> <span className="badge">sous le coût</span></> : null}</td><td className="n" style={{ color: 'var(--muted)' }}>{rem}</td>{cells}</tr>;
        })}</tbody></table>
    );
  };
  const depLines = live.filter((x: any) => x.c.deposits.caseUnit > 0 || x.c.deposits.kegUnit > 0).map((x: any) => `${x.tag} : casier ${eur(x.c.deposits.caseUnit)} · fût ${eur(x.c.deposits.kegUnit)}`);

  /* --- promotion --- */
  const promo = () => {
    if (!models.length) return <p className="empty">Enregistrez une recette pour simuler une promotion.</p>;
    const fmts = FORMATS.filter((f) => models.some((m: any) => m.rows.some((x: any) => x.f.key === f.key)));
    if (!fmts.length) return <p className="empty">Ces recettes n'ont aucun format de conditionnement.</p>;
    const m0 = models[0];
    const sub = ['Prix normal|pièce · TVAC / HTVA', 'Prix effectif|pièce · TVAC / HTVA', 'Prix effectif|caisse · TVAC / HTVA', 'Marge réelle|sur coût · coût pièce'];
    return (
      <>
        <div><p style={{ margin: '0 0 10px' }}><b>{promoText(p)}</b>{` · ${m0.ch ? m0.ch.name : ''} · remise effective ${pct(1 - m0.pf)}`}</p></div>
        <div className="scroll">
          <table className="promo-tbl"><thead>
            <tr><th rowSpan={2}>Format</th>{models.map((m: any) => <th key={m.tag} colSpan={4} className="grp">{`Recette ${m.tag} · ${m.r.name || 'Sans nom'}`}</th>)}</tr>
            <tr>{models.map((m: any) => sub.map((t, j) => { const [a, b] = t.split('|'); return <th key={m.tag + j} className={j === 0 ? 'gs' : undefined}>{a}<span className="th-sub">{b}</span></th>; }))}</tr></thead>
            <tbody>{fmts.map((f) => (
              <tr key={f.key}><td>{f.label}</td>{models.map((m: any) => {
                const x = m.rows.find((y: any) => y.f.key === f.key);
                if (!x) return <td key={m.tag} className="na gs" colSpan={4}>format non utilisé</td>;
                const below = x.margin < -1e-9, cls = below ? ' below' : '';
                return [
                  <td key={m.tag + 'a'} className="cell gs"><b>{eur(x.nTTC)}</b><small>{eur(x.nHT)}</small></td>,
                  <td key={m.tag + 'b'} className={'cell eff' + cls}><b>{eur(x.eTTC)}</b><small>{eur(x.eHT)}</small></td>,
                  <td key={m.tag + 'c'} className={'cell eff' + cls}>{f.caseable ? <><b>{eur(x.cTTC)}</b><small>{eur(x.cHT)}</small><small>{'caisse de ' + x.perCase}</small></> : <><b>—</b><small>pas de caisse</small></>}</td>,
                  <td key={m.tag + 'd'} className={'cell' + cls}><b>{isFinite(x.margin) ? pct(x.margin) : '—'}</b><small>{'coût ' + eur(x.cost)}</small></td>,
                ];
              })}</tr>))}</tbody></table>
        </div>
      </>
    );
  };

  return (
    <div>
      <div className="sec-title"><h2>Comparatif de trois recettes</h2><Btn act="export-compare" className="btn sm" onClick={() => saveFile('comparatif-recettes.csv', compareCSV({ ...state, selected: selA }), true)}>Exporter en CSV (Excel)</Btn></div>
      <div className="card">
        <div className="toolbar">
          <div className="field"><label className="lbl-s" htmlFor="cmp-a">Recette A (principale)</label><select id="cmp-a" value={selA} onChange={(e: any) => setAt('selected', e.target.value)}>{recs.map(opt)}</select></div>
          <div className="field"><label className="lbl-s" htmlFor="cmp-b">Recette B</label><select id="cmp-b" value={val('cmpB')} onChange={(e: any) => setAt('cmpB', e.target.value)}><option value="">— Aucune —</option>{recs.map(opt)}</select></div>
          <div className="field"><label className="lbl-s" htmlFor="cmp-c">Recette C</label><select id="cmp-c" value={val('cmpC')} onChange={(e: any) => setAt('cmpC', e.target.value)}><option value="">— Aucune —</option>{recs.map(opt)}</select></div>
        </div>
        <div className="scroll" id="cmp-root">{cmpTable()}</div>
      </div>

      <div className="sec-title"><h2>Grille tarifaire par canal de vente</h2><p>Recettes A, B et C côte à côte, avec la marge de chaque recette</p></div>
      <div className="card">
        <div className="toolbar"><div className="seg" role="group" aria-label="Unité de prix">
          <button type="button" aria-pressed={unit === 'piece'} onClick={() => setUnit('piece')}>Par pièce</button>
          <button type="button" aria-pressed={unit === 'case'} onClick={() => setUnit('case')}>Par caisse</button></div></div>
        <div className="cmp-info">{live.map((x: any) => <div key={x.tag}><b>{x.tag}</b>{`${x.r.name || 'Sans nom'} · palette ${(PALLETS[x.c.palletType] || PALLETS.euro).label} · marge : ${marginDesc(x.c, x.r)}`}</div>)}</div>
        <div className="scroll" id="grid-root">{grid()}</div>
        <p className="note">Les cellules sur fond ambré sont vendues sous le coût de revient. Les canaux et leurs remises se règlent dans l'onglet Paramètres.</p>
        {depLines.length ? <p className="note">{'Consignes à ajouter hors prix : ' + depLines.join(' ; ') + '.'}</p> : null}
      </div>

      <div className="sec-title"><h2>Simulateur de promotion</h2><p>Recettes A, B et C côte à côte, même schéma et même canal</p></div>
      <div className="card">
        <div className="toolbar">
          <div className="field"><label className="lbl-s" htmlFor="f-promo-channel">Canal de vente</label><select id="f-promo-channel" disabled={ro} value={chanVal} onChange={(e: any) => setAt('promo.channel', e.target.value)}>{s.channels.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="field"><label className="lbl-s" htmlFor="f-promo-scheme">Schéma promotionnel</label><Sel path="promo.scheme" label="Schéma promotionnel" opts={[['5+1', '5 + 1 gratuit'], ['10+1', '10 + 1 gratuit'], ['xy', 'X + Y gratuits (personnalisé)'], ['pct', 'Remise en % (personnalisée)'], ['none', 'Aucune promotion']]} /></div>
          {p.scheme === 'xy' ? <div className="field" id="promo-xy"><span className="lbl-s">Achetés + offerts</span><div className="with-unit"><Num path="promo.x" label="Pièces achetées" min={0} /><span style={{ minWidth: 0 }}>+</span><Num path="promo.y" label="Pièces offertes" min={0} /></div></div> : null}
          {p.scheme === 'pct' ? <div className="field" id="promo-pct"><span className="lbl-s">Remise</span><div className="with-unit"><Num path="promo.pct" label="Remise en pourcentage" min={0} /><span>%</span></div></div> : null}
        </div>
        {promo()}
        <p className="note">Le prix effectif est le prix du canal multiplié par la part réellement payée. La marge réelle se compare au coût de revient de chaque format.</p>
      </div>
    </div>
  );
}


/* ====================================================================
   PAGE : état, rôles, persistance locale et synchronisation Supabase
   ==================================================================== */
const SB_TABLE = 'app_state', SB_ROW = 'main', SB_DEBOUNCE = 2500;
const TABS: any[] = [['params', 'Paramètres', ' & base de données'], ['recette', 'Recette', ' & simulateur'], ['compare', 'Comparateur', ' & promotions'], ['annuel', 'Analyse annuelle', ' & rentabilité']];
const hm = () => new Date().toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
const VIEW_PATHS = new Set(['selected', 'cmpB', 'cmpC']);

export default function CalculateurPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const routerRef = useRef(router); routerRef.current = router;
  const [state, setStateRaw] = useState<any>(null);
  const stateRef = useRef<any>(null);
  const [role, setRole] = useState<string>('user');
  const [user, setUser] = useState<any>(null);
  const [tab, setTab] = useState<string>('params');
  const [sync, setSync] = useState<{ txt: string; off: boolean }>({ txt: 'Chargement…', off: false });
  const [toastMsg, setToastMsg] = useState<string>('');
  const [sheet, setSheet] = useState<string | null>(null);
  const adv = useRef<any>({ tech: false, trace: false, acct: false });
  const R = useRef<any>({ remoteStamp: null, timer: null, pushing: false, dirty: false, conflict: false, suppress: false, editSeq: 0, own: new Set(), useStateJson: true, saveTimer: null, toastTimer: null, user: null, role: 'user' });
  const ro = role === 'user';

  const toast = useCallback((msg: string) => {
    setToastMsg(msg); clearTimeout(R.current.toastTimer);
    R.current.toastTimer = setTimeout(() => setToastMsg(''), 2800);
  }, []);
  const status = useCallback((txt: string, off = false) => setSync({ txt, off }), []);

  /* ---- écriture de l'état + persistance locale + envoi différé ---- */
  const remoteDirty = () => {
    const r = R.current; if (r.role === 'user') return;
    r.dirty = true; r.editSeq++;
    if (r.conflict) { status('Conflit : cliquez sur Synchroniser', true); return; }
    status('Modifications à synchroniser…'); clearTimeout(r.timer); r.timer = setTimeout(() => pushRemote(), SB_DEBOUNCE);
  };
  const persist = (st: any) => {
    const r = R.current; clearTimeout(r.saveTimer);
    r.saveTimer = setTimeout(() => {
      let ok = true;
      try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { ok = false; }
      if (r.user && !r.suppress) remoteDirty();
      else if (!r.user) status(ok ? 'Enregistré dans ce navigateur' : 'Stockage indisponible : exportez une sauvegarde', !ok);
    }, 250);
  };
  const commit = (next: any) => { stateRef.current = next; setStateRaw(next); persist(next); };
  const mutate = (fn: any) => {
    if (!stateRef.current) return;
    const next = clone(stateRef.current); fn(next); commit(next);
  };
  const setAt = (path: string, v: any) => {
    if (R.current.role === 'user' && !VIEW_PATHS.has(path)) return;
    mutate((st: any) => {
      setPath(st, path, v);
      const mS = /^recipes\.(\d+)\.status$/.exec(path);
      if (mS && st.recipes[+mS[1]] && st.recipes[+mS[1]].id && st.recipes[+mS[1]].id === st.draft.id) st.draft.status = v;
      const mY = /^settings\.energyYears\.(\d+)\./.exec(path); if (mY && st.settings.energyYears[+mY[1]]) st.settings.energyYears[+mY[1]].example = false;
      if (/^settings\.energy(Years|Ref|Var|Vat|HdCoef|UseRef)/.test(path)) energyApply(st.settings);
      const mT = /^settings\.tasks\.(\d+)\.role$/.exec(path);
      if (mT && v) st.settings.tasks.forEach((t: any, j: number) => { if (j !== +mT[1] && t.role === v) t.role = ''; });
      if (path === 'draft.volumeId') { const vo = volOf(st.draft, st.settings); if (vo) st.draft.hd = num(vo.hd) === 1 ? 1 : 0; }
      if (path === 'draft.marginScheme' && v === 'perFormat' && !st.draft.marginFmtSet) {
        FORMATS.forEach((f) => { st.draft.marginFmt[f.key] = num(st.draft.margin); });
        st.draft.marginFmtSet = true;
      }
      if (path.indexOf('draft.marginFmt.') === 0) st.draft.marginFmtSet = true;
    });
  };
  const getState = (() => { const f: any = () => stateRef.current; return f; })();
  const replaceState = (st: any) => { commit(st); };
  getState.replace = replaceState;

  /* ---- prix des ingrédients ---- */
  const refreshPrices = () => {
    const st0 = stateRef.current; if (!st0) return;
    const tot = (st: any) => { try { return compute(st.draft, st.settings).total; } catch (e) { return 0; } };
    const before = tot(st0), snap = st0.priceSnap || null;
    const now: any = {}; st0.settings.ingredients.forEach((i: any) => { now[i.id] = num(i.price); });
    const used = Array.from(new Set(st0.draft.ingredients.map((r: any) => r.ingId))).filter(Boolean) as string[];
    const changed = snap ? used.filter((id) => id in now && (id in snap) && Math.abs(snap[id] - now[id]) > 1e-9).length : 0;
    mutate((st: any) => { st.priceSnap = now; });
    const after = tot(st0), n = st0.draft.ingredients.length;
    const miss = st0.draft.ingredients.filter((r: any) => !st0.settings.ingredients.some((i: any) => i.id === r.ingId)).length;
    let msg = n ? `Prix actualisés pour ${n} ingrédient${n > 1 ? 's' : ''}${snap ? ` (${changed} modifié${changed > 1 ? 's' : ''})` : ''} · coût du brassin ${eur(after)}` : 'Aucun ingrédient dans la recette';
    if (snap && Math.abs(after - before) > 1e-9) msg += ` (${after - before > 0 ? '+' : '−'}${eur(Math.abs(after - before))})`;
    if (miss) msg += ` · ${miss} ingrédient${miss > 1 ? 's' : ''} absent${miss > 1 ? 's' : ''} de la table`;
    toast(msg);
  };

  /* ---- fichiers ---- */
  const saveFile = (filename: string, text: string, bom: boolean) => {
    try {
      const blob = new Blob([(bom ? '﻿' : '') + text], { type: /\.json$/.test(filename) ? 'application/json' : 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Fichier téléchargé : ' + filename); return;
    } catch (e) { /* repli : copie manuelle */ }
    setSheet(text);
  };
  const scrollTop = () => { try { window.scrollTo(0, 0); } catch (e) { /* ignore */ } };

  /* ---- Supabase : état partagé ---- */
  const pullRemote = async () => {
    const { data, error } = await supabase.from(SB_TABLE).select('*').eq('id', SB_ROW).maybeSingle();
    if (error) throw error;
    if (data && !data.data && data.state_json) { try { data.data = typeof data.state_json === 'string' ? JSON.parse(data.state_json) : data.state_json; } catch (e) { /* ignore */ } }
    return data;
  };
  const applyRemote = (row: any) => {
    const st = mergeState(row.data); if (!st) throw new Error('Format de données partagées non reconnu');
    const r = R.current; r.suppress = true;
    try { stateRef.current = st; setStateRaw(st); } finally { setTimeout(() => { r.suppress = false; }, 450); }
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* ignore */ }
    r.remoteStamp = row.updated_at; r.dirty = false; r.conflict = false; status('Synchronisé à ' + hm());
  };
  async function pushRemote(): Promise<void> {
    const r = R.current;
    if (!r.user || r.role === 'user' || !stateRef.current) return;
    if (r.pushing) { r.timer = setTimeout(() => pushRemote(), 500); return; }
    r.pushing = true; clearTimeout(r.timer); status('Synchronisation…');
    const seq = r.editSeq;
    try {
      const payload = JSON.parse(JSON.stringify(stateRef.current)), now = new Date().toISOString();
      const send = (cols: any) => supabase.from(SB_TABLE).upsert(Object.assign({ id: SB_ROW, updated_at: now }, cols), { onConflict: 'id' }).select('updated_at');
      let res: any = r.useStateJson ? await send({ data: payload, state_json: JSON.stringify(payload) }) : await send({ data: payload });
      if (res.error && r.useStateJson && /state_json/i.test(res.error.message || '')) { r.useStateJson = false; res = await send({ data: payload }); }
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) throw new Error('écriture refusée par la base (droits insuffisants ?)');
      r.remoteStamp = res.data[0].updated_at; r.own.add(r.remoteStamp); r.conflict = false;
      r.dirty = r.editSeq !== seq;
      if (r.dirty) { clearTimeout(r.timer); r.timer = setTimeout(() => pushRemote(), SB_DEBOUNCE); status('Modifications à synchroniser…'); }
      else status('Synchronisé à ' + hm());
    } catch (e: any) {
      status('Synchronisation impossible', true); toast('Synchronisation impossible : ' + (e && e.message ? e.message : 'erreur réseau'));
    } finally { r.pushing = false; }
  }
  const manualSync = async () => {
    const r = R.current; if (!r.user) return;
    clearTimeout(r.timer); status('Synchronisation…');
    for (let i = 0; r.pushing && i < 100; i++) await new Promise((res) => setTimeout(res, 100));
    await loadRole();
    try {
      const row = await pullRemote();
      if (!row) {
        if (r.role === 'user') { status('Base partagée vide'); toast('Base partagée vide : un brasseur ou un administrateur doit l\'initialiser'); return; }
        r.remoteStamp = null; r.conflict = false; await pushRemote(); toast('Base partagée créée'); return;
      }
      const remoteChanged = row.updated_at !== r.remoteStamp;
      if (r.dirty || r.conflict) {
        if (remoteChanged && r.role !== 'user' && (r.conflict || r.own.has(row.updated_at))) {
          try { localStorage.setItem(KEY + '-sauvegarde-distante', JSON.stringify({ at: new Date().toISOString(), data: row.data })); } catch (e) { /* ignore */ }
          r.remoteStamp = row.updated_at; r.conflict = false; await pushRemote(); toast('Version de l\'écran envoyée : la base partagée est remplacée');
        } else if (remoteChanged) {
          if (confirm('La base partagée a été modifiée par quelqu\'un d\'autre ET vous avez des modifications non synchronisées.\n\nOK = charger la version partagée (vos modifications locales sont perdues).\nAnnuler = écraser la version partagée avec la vôtre.')) { applyRemote(row); toast('Version partagée chargée'); }
          else { r.remoteStamp = row.updated_at; r.conflict = false; await pushRemote(); toast('Version partagée remplacée par la vôtre'); }
        } else { r.conflict = false; await pushRemote(); toast('Modifications envoyées'); }
        return;
      }
      if (remoteChanged) { applyRemote(row); toast('Données partagées chargées'); }
      else { status('Synchronisé à ' + hm()); toast('Déjà à jour'); }
    } catch (e: any) { status('Synchronisation impossible', true); toast('Synchronisation impossible : ' + (e && e.message ? e.message : 'erreur réseau')); }
  };

  /* ---- rôle : table profiles, puis métadonnées du compte ---- */
  const roleFrom = async (u: any) => {
    let rl: string | null = null;
    try { const { data } = await supabase.from('profiles').select('role').eq('id', u.id).maybeSingle(); rl = data && data.role; } catch (e) { /* ignore */ }
    if (!rl) { const meta = u.user_metadata || {}; rl = meta.role; }
    return ROLES[rl as string] ? (rl as string) : 'user';
  };
  async function loadRole() {
    try {
      const { data } = await supabase.auth.getUser(); const u = data && data.user; if (!u) return;
      const nr = await roleFrom(u);
      if (nr !== R.current.role) { const was = R.current.role; R.current.role = nr; setRole(nr); toast('Rôle mis à jour : ' + ROLES[nr][1]); if (was === 'user' && nr !== 'user') status('Synchronisé à ' + hm()); }
    } catch (e) { /* ignore */ }
  }

  /* ---- démarrage ---- */
  useEffect(() => {
    let alive = true;
    const st0 = loadState() || freshState();
    stateRef.current = st0; setStateRaw(st0);
    const h = (location.hash || '').replace('#', '');
    if (['params', 'recette', 'compare', 'annuel'].includes(h)) setTab(h);
    status('Enregistré dans ce navigateur');
    (async () => {
      try {
        const { data } = await supabase.auth.getUser(); const u = data && data.user;
        if (!u || !alive) return;
        try { const acc = await supabase.rpc('has_app_access', { p_route: '/apps/calculateur' }); if (acc && acc.data === false) { routerRef.current.replace('/dashboard'); return; } } catch (e) { /* ignore */ }
        const rl = await roleFrom(u); if (!alive) return;
        R.current.user = u; R.current.role = rl; setUser(u); setRole(rl);
        status('Chargement de la base partagée…');
        try {
          const row = await pullRemote();
          if (row && row.data) applyRemote(row);
          else if (rl !== 'user') { R.current.dirty = true; await pushRemote(); toast('Base partagée initialisée avec vos données'); }
          else { status('Base partagée vide'); toast('Base partagée vide : un brasseur ou un administrateur doit l\'initialiser'); }
        } catch (e: any) { status('Base partagée inaccessible', true); toast('Chargement impossible : ' + (e && e.message ? e.message : 'erreur réseau') + '. Données locales conservées.'); }
      } catch (e) { /* hors ligne : on garde les données locales */ }
    })();
    const onOnline = () => { const r = R.current; if (r.user && r.dirty && !r.conflict) pushRemote(); };
    const onUnload = (e: any) => { const r = R.current; if (r.user && r.dirty && !r.conflict) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('online', onOnline); window.addEventListener('beforeunload', onUnload);
    const onKey = (e: any) => { if (e.key === 'Escape') setSheet(null); };
    document.addEventListener('keydown', onKey);
    const sub = supabase.auth.onAuthStateChange((evt: string) => { if (evt === 'SIGNED_OUT') { R.current.user = null; setUser(null); } });
    return () => { alive = false; window.removeEventListener('online', onOnline); window.removeEventListener('beforeunload', onUnload); document.removeEventListener('keydown', onKey); try { sub.data.subscription.unsubscribe(); } catch (e) { /* ignore */ } clearTimeout(R.current.timer); clearTimeout(R.current.saveTimer); };
    // eslint-disable-next-line
  }, []);

  /* onglet courant : lien (#) et onglet annuel réservé aux administrateurs */
  const curTab = tab === 'annuel' && role !== 'admin' && user ? 'params' : tab;
  const go = (id: string) => { setTab(id); try { history.replaceState(null, '', '#' + id); } catch (e) { /* ignore */ } scrollTop(); };
  useEffect(() => {
    const setHh = () => { const el = document.getElementById('site-header'); if (el) document.documentElement.style.setProperty('--hh', el.offsetHeight + 'px'); };
    setHh(); window.addEventListener('resize', setHh);
    try { (document as any).fonts && (document as any).fonts.ready.then(setHh); } catch (e) { /* ignore */ }
    return () => window.removeEventListener('resize', setHh);
  }, [state === null]);

  const ctx = { state, mutate, setAt, toast, role, ro, replaceState, getState, adv, refreshPrices, saveFile, scrollTop };

  const tabs = TABS.filter((t) => t[0] !== 'annuel' || role === 'admin').map((t) => (
    <button key={t[0]} type="button" role="tab" id={'tb-' + t[0]} className="site-tab" aria-selected={curTab === t[0]} onClick={() => go(t[0])}>{t[1]}<span className="x">{t[2]}</span></button>
  ));
  const right = (
    <>
      <span className={'site-state' + (sync.off ? ' off' : '')} role="status"><span className="dot" /><span>{sync.txt}</span></span>
      {user ? <button type="button" className="site-btn" onClick={manualSync} title={sync.txt}>⟳ Synchroniser</button> : null}
      {user ? <span className="site-who" title={user.email || ''}>{user.email || ''}</span> : null}
      {user ? <span className={'site-role' + (role === 'user' ? ' ro' : '')} title={ROLES[role][1]}>{ROLES[role][0]}</span> : null}
    </>
  );

  return (
    <>
      <AppHeader title="Calculateur de brassin" tabs={tabs} right={right} />
      <div className={'cb-root role-' + role}>
        <style dangerouslySetInnerHTML={{ __html: CB_CSS }} />
        {state === null ? <p className="loading">Chargement…</p> : (
          <CbCtx.Provider value={ctx}>
            <main className="wrap" id="main">
              {curTab === 'params' ? <SettingsTab /> : null}
              {curTab === 'recette' ? <RecipeTab /> : null}
              {curTab === 'compare' ? <CompareTab /> : null}
              {curTab === 'annuel' && role === 'admin' ? <AnnualTab /> : null}
            </main>
          </CbCtx.Provider>
        )}
        {sheet !== null ? (
          <div className="sheet" onClick={(e: any) => { if (e.target === e.currentTarget) setSheet(null); }}>
            <div className="box" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
              <h2 id="sheet-title" style={{ fontSize: 16 }}>Copier le fichier</h2>
              <p className="hint">L'enregistrement direct n'est pas disponible ici. Copiez le texte puis collez-le dans un fichier .csv ou dans Excel.</p>
              <textarea id="sheet-text" readOnly aria-label="Contenu du fichier" value={sheet} onFocus={(e: any) => e.target.select()} />
              <div className="btn-row">
                <button type="button" className="btn primary" onClick={() => { (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(sheet) : Promise.reject()).then(() => toast('Copié'), () => toast('Sélectionnez le texte puis copiez-le')); }}>Copier</button>
                <button type="button" className="btn" onClick={() => setSheet(null)}>Fermer</button>
              </div>
            </div>
          </div>
        ) : null}
        {toastMsg ? <div className="toast" role="status">{toastMsg}</div> : null}
      </div>
    </>
  );
}


/* ---------- styles propres au calculateur (portée .cb-root) ---------- */
const CB_CSS = `.cb-root{--c1:#D6AD00;--c2:#012735;--c3:#3F7F96;--c4:#8B67B5;--c5:#B5503C;--c6:#5E9C6B;--c7:#7B8F96;--c8:#B65D8F;--c9:#4E9A8F}
.cb-root .grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));align-items:start}
.cb-root .split{display:grid;gap:20px;grid-template-columns:minmax(0,1fr) minmax(0,460px);align-items:start}
.cb-root .split>*{min-width:0}
.cb-root .stack{display:flex;flex-direction:column;gap:16px;min-width:0}
.cb-root .card{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:16px;min-width:0}
.cb-root .card>h2{font-size:15px}
.cb-root .card h3{font-size:13px;margin-bottom:8px}
.cb-root .sec-title{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 12px;margin:26px 0 10px}
.cb-root .sec-title:first-child{margin-top:0}
.cb-root .sec-title h2{font-size:17px}
.cb-root .sec-title p{margin:0;color:var(--muted);font-size:12px}
.cb-root .lbl-s{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:600}
.cb-root .fields{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr))}
.cb-root .field{display:flex;flex-direction:column;gap:5px;min-width:0}
.cb-root .hint{font-size:12px;color:var(--muted)}
.cb-root input,.cb-root select{background:var(--surface);border:1px solid var(--line);border-radius:4px;height:32px;padding:0 8px;width:100%;min-width:0}
.cb-root input.num{text-align:right;font-family:var(--font-mono);font-size:13px;font-variant-numeric:tabular-nums}
.cb-root input[type="checkbox"]{width:18px;height:18px;padding:0;accent-color:var(--accent)}
.cb-root input:hover,.cb-root select:hover{border-color:var(--muted)}
.cb-root input:focus-visible,.cb-root select:focus-visible,.cb-root button:focus-visible,.cb-root summary:focus-visible{outline:2px solid var(--focus,var(--ink));outline-offset:1px}
.cb-root .with-unit{display:flex;align-items:center;gap:6px;min-width:0}
.cb-root .with-unit span{font-size:12px;color:var(--muted);white-space:nowrap;min-width:34px}
.cb-root .ey-bar{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:flex-end;margin-bottom:12px}
.cb-root .ey-bar .field{min-width:0}
.cb-root .ey-bar select{width:auto;min-width:130px}
.cb-root .ey-bar input.num{width:96px}
.cb-root .ey-tbl td input.num{width:112px;text-align:right}
.cb-root .ey-tbl td.n,.cb-root .ey-tbl th.n{white-space:nowrap}
.cb-root .ey-tbl tr.tot td{font-weight:700;border-top:1px solid var(--ink)}
.cb-root .ey-tbl tr.sim td{background:var(--accent-soft)}
.cb-root .ey-tbl tr.refrow td{font-weight:600}
.cb-root .ey-chk{display:flex;align-items:center;gap:8px;font-size:13px;margin:4px 0 10px}
.cb-root .ey-grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));align-items:start;margin-top:14px}
.cb-root .ey-up{color:var(--bad)}
.cb-root .ey-down{color:var(--accent-text)}
.cb-root .pal-off{border-color:var(--bad)!important;background:var(--bad-soft)!important;color:var(--bad)}
.cb-root .pal-legend{font-size:12px;color:var(--muted);margin:6px 0 0}
.cb-root .an-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:14px;margin:4px 0 4px}
.cb-root .an-tbl td input.num{width:96px;text-align:right}
.cb-root .an-tbl td.nm{white-space:normal;min-width:150px}
.cb-root .an-tbl td.nm small{display:block;color:var(--muted);font-size:11px}
.cb-root .an-tbl tr.grp td{background:var(--surface-2);font-family:var(--font-display);font-weight:600;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.cb-root .an-tbl tr.subtot td{font-weight:600;border-top:1px solid var(--ink)}
.cb-root .an-tbl tr.tot td{font-weight:700;background:var(--accent-soft);border-top:2px solid var(--brand-2)}
.cb-root .an-banner{margin-top:12px;padding:12px 14px;border-radius:6px;border-left:6px solid var(--brand-2);background:var(--accent-soft);font-family:var(--font-display);font-size:18px;font-weight:600}
.cb-root .an-banner.loss{border-left-color:var(--bad);background:var(--bad-soft);color:var(--bad)}
.cb-root .an-pos{color:var(--accent-text)}
.cb-root .an-neg{color:var(--bad)}
.cb-root .an-fixed{grid-template-columns:minmax(0,1fr) minmax(0,160px) 30px}
.cb-root .an-fixed .with-unit input{min-width:0;flex:1 1 70px}
.cb-root .r-task{grid-template-columns:minmax(0,1.3fr) 104px minmax(0,1fr) minmax(0,1.3fr) 30px}
.cb-root .r-task.head{align-items:end}
.cb-root .lab-ref{font-size:11px;color:var(--muted);font-weight:400;display:block}
.cb-root .std-add{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}
.cb-root .std-add select{width:auto;min-width:220px;max-width:100%}
.cb-root .lg-tbl td input.num{width:70px;text-align:right}
.cb-root .lg-tbl td input[type="text"]{min-width:200px}
.cb-root .lg-tbl td select{min-width:130px;max-width:170px}
.cb-root .lg-tbl th{white-space:normal;text-align:right}
.cb-root .lg-tbl th:first-child{text-align:left}
.cb-root .flat-cell{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.cb-root .flat-cell input{width:110px}
.cb-root .lg-name{min-width:215px}
.cb-root .lg-name input,.cb-root .lg-name select{display:block;width:100%}
.cb-root .lg-name select{margin-top:4px}
.cb-root .r-flat .hint{align-self:center}
.cb-root .lg-tbl td.sep,.cb-root .lg-tbl th.sep{border-left:2px solid var(--line)}
.cb-root .lg-tbl tr.tot td{font-weight:700;border-top:1px solid var(--ink)}
.cb-root .r-lg{grid-template-columns:minmax(0,1.3fr) minmax(0,1.1fr) 92px 92px 96px}
.cb-root .lg-sec{border-top:1px solid var(--line);padding-top:10px;margin-top:12px}
.cb-root .lg-sec h3{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px}
.cb-root .lg-sec h3 .sum{font-size:12px;font-weight:400;color:var(--muted)}
.cb-root .lg-acc{border:1px solid var(--line);border-radius:6px;margin-top:8px;background:var(--surface)}
.cb-root .lg-acc>summary{cursor:pointer;list-style:none;display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;padding:10px 12px;font-weight:600}
.cb-root .lg-acc>summary::-webkit-details-marker{display:none}
.cb-root .lg-acc>summary::before{content:"▸";color:var(--muted);width:14px;flex:0 0 14px}
.cb-root .lg-acc[open]>summary::before{content:"▾"}
.cb-root .lg-acc>summary .t{flex:1 1 0;min-width:0}
.cb-root .lg-acc>summary .sum{margin-left:auto;font-size:12px;font-weight:500;color:var(--muted);text-align:right;font-family:var(--mono,inherit)}
.cb-root .lg-acc.is-off>summary{opacity:.6}
.cb-root .lg-acc-b{padding:0 12px 12px;border-top:1px solid var(--line)}
.cb-root .lg-acc-b .lg-sec:first-child{border-top:0;margin-top:6px}
.cb-root .r-adj{grid-template-columns:minmax(0,1fr) 120px 150px auto;align-items:end}
.cb-root .cons-sub{border-top:1px solid var(--line);margin-top:12px;padding-top:8px}
.cb-root .lg-opts{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:flex-end;margin:6px 0 4px}
.cb-root .btn{appearance:none;border:1px solid var(--line);background:var(--surface);border-radius:4px;height:34px;padding:0 14px;cursor:pointer;font-weight:500;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}
.cb-root .btn:hover{border-color:var(--ink)}
.cb-root .btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.cb-root .btn.primary{font-weight:600}
.cb-root .btn.primary:hover{filter:brightness(1.07)}
.cb-root .btn.sm{height:28px;padding:0 10px;font-size:13px}
.cb-root .btn.danger.armed{background:var(--bad);border-color:var(--bad);color:#fff}
.cb-root .icon-btn{appearance:none;background:none;border:1px solid transparent;border-radius:4px;width:30px;height:30px;cursor:pointer;color:var(--muted);font-size:16px;line-height:1}
.cb-root .icon-btn:hover{color:var(--bad);border-color:var(--line)}
.cb-root .btn-row{display:flex;flex-wrap:wrap;gap:8px}
.cb-root .rows{display:flex;flex-direction:column}
.cb-root .row{display:grid;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid var(--line)}
.cb-root .row:last-child{border-bottom:0}
.cb-root .row.head{padding:0 0 4px}
.cb-root .row.plain{border:0;padding-bottom:0}
.cb-root .row .out{font-family:var(--font-mono);font-size:13px;text-align:right;font-variant-numeric:tabular-nums}
.cb-root .row .lbl{min-width:0}
.cb-root .r-ing{grid-template-columns:minmax(0,1fr) 96px 112px 30px}
.cb-root .r-rate{grid-template-columns:minmax(0,1fr) 124px 30px}
.cb-root .r-energy{grid-template-columns:minmax(0,1fr) minmax(0,190px)}
.cb-root .r-energy .with-unit input{min-width:0;flex:1 1 70px}
.cb-root .r-energy .with-unit span{min-width:0}
.cb-root .r-hd{grid-template-columns:minmax(0,1fr) 96px 96px}
.cb-root .r-base{grid-template-columns:minmax(0,1fr) 108px 30px}
.cb-root .r-excise{grid-template-columns:76px minmax(0,1fr) 30px}
.cb-root .r-cons{grid-template-columns:minmax(0,1fr) 96px 124px 30px;grid-template-areas:"n p m d"}
.cb-root .r-cons .n{grid-area:n}
.cb-root .r-cons .p{grid-area:p}
.cb-root .r-cons .m{grid-area:m}
.cb-root .r-cons .d{grid-area:d}
.cb-root .r-lab{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) 72px 108px}
.cb-root .r-extra{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) 72px 108px 30px}
.cb-root .r-forf{grid-template-columns:minmax(0,1.2fr) 104px 76px 112px 30px}
.cb-root .r-mix{grid-template-columns:minmax(0,1fr) 92px minmax(0,1.3fr)}
.cb-root .r-chan{grid-template-columns:minmax(0,1fr) minmax(0,1fr) 92px 30px;grid-template-areas:"n b p d"}
.cb-root .r-chan .n{grid-area:n}
.cb-root .r-chan .b{grid-area:b}
.cb-root .r-chan .p{grid-area:p}
.cb-root .r-chan .d{grid-area:d}
.cb-root .r-vol{grid-template-columns:minmax(0,1fr) 112px 92px 30px;grid-template-areas:"n p h d"}
.cb-root .r-vol .n{grid-area:n}
.cb-root .r-vol .p{grid-area:p}
.cb-root .r-vol .h{grid-area:h}
.cb-root .r-vol .d{grid-area:d}
.cb-root .r-en{grid-template-columns:minmax(0,1fr) 112px 120px}
.cb-root .r-colis3{grid-template-columns:minmax(0,1fr) 88px 92px 92px}
.cb-root .r-sel{grid-template-columns:minmax(0,1fr) minmax(0,230px)}
.cb-root .r-csel{grid-template-columns:22px minmax(0,1fr) auto;gap:10px}
.cb-root .r-deliv{grid-template-columns:minmax(0,1fr) auto}
.cb-root .addrow{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)}
.cb-root .addrow input{flex:1 1 110px;width:auto}
.cb-root .addrow select{flex:0 1 150px;width:auto}
.cb-root .addrow .btn{flex:0 0 auto}
.cb-root .total-line{display:flex;justify-content:space-between;gap:12px;margin-top:10px;padding-top:10px;border-top:1px solid var(--ink);font-weight:600}
.cb-root .sub-line{display:flex;justify-content:space-between;gap:12px;margin-top:8px;color:var(--muted);font-size:13px}
.cb-root .mono{font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.cb-root .badge{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:3px;background:var(--warn-soft);color:var(--warn);vertical-align:middle;margin-left:6px;white-space:nowrap}
.cb-root .note{font-size:12px;color:var(--muted);margin:8px 0 0}
.cb-root .alert{font-size:13px;padding:8px 10px;border-radius:4px;background:var(--warn-soft);color:var(--warn);margin-top:10px}
.cb-root .alert.bad{background:var(--bad-soft);color:var(--bad)}
.cb-root details.card>summary{cursor:pointer;list-style:none;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px}
.cb-root details.card>summary::-webkit-details-marker{display:none}
.cb-root details.card>summary h2{font-size:15px;flex:1 1 0;min-width:0}
.cb-root details.card>summary::before{content:"▸";color:var(--muted);display:inline-block;width:14px;flex:0 0 14px}
.cb-root details.card[open]>summary::before{content:"▾"}
.cb-root details.card[open]>summary{margin-bottom:12px}
.cb-root details.card>summary .sum{margin-left:auto;font-size:12px;color:var(--muted);text-align:right}
.cb-root .disp{height:32px;display:flex;align-items:center;padding:0 8px;border-radius:4px;background:var(--surface-2);font-family:var(--font-mono);font-size:13px;font-variant-numeric:tabular-nums}
.cb-root .kv{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:3px 0;border-bottom:1px solid var(--line)}
.cb-root .kv span:first-child{color:var(--muted)}
.cb-root .kv span:last-child{text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.cb-root .cgrp{margin-top:12px}
.cb-root .cgrp:first-of-type{margin-top:6px}
.cb-root .cgrp h3{margin-bottom:2px}
.cb-root .r-csel label{cursor:pointer}
.cb-root .r-csel .pr{font-family:var(--font-mono);font-size:12px;color:var(--muted);white-space:nowrap}
.cb-root .aside{position:sticky;top:calc(var(--hh,96px) + env(safe-area-inset-top,0px) + 14px);display:flex;flex-direction:column;gap:16px;min-width:0}
.cb-root .kpis{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:12px 0 16px}
.cb-root .kpi .v{color:var(--ink);box-shadow:inset 0 -3px 0 var(--brand-2);width:fit-content;max-width:100%;font-family:var(--font-mono);font-size:18px;font-weight:500;letter-spacing:-.02em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.cb-root .kpi .l{font-size:12px;color:var(--muted)}
.cb-root .bar{display:flex;height:12px;border-radius:2px;overflow:hidden;background:var(--surface-2);gap:2px}
.cb-root .bar i{display:block;min-width:2px}
.cb-root .legend{display:flex;flex-direction:column;gap:3px;margin-top:10px}
.cb-root .legend div{display:flex;align-items:center;gap:8px;font-size:13px}
.cb-root .legend b{width:10px;height:10px;border-radius:2px;flex:0 0 auto}
.cb-root .legend span:nth-child(3){margin-left:auto}
.cb-root .legend em{font-style:normal;color:var(--muted);font-size:12px;min-width:50px;text-align:right}
.cb-root .scroll{overflow-x:auto;max-width:100%}
.cb-root table{border-collapse:collapse;width:100%;font-size:13px}
.cb-root th,.cb-root td{padding:6px 10px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
.cb-root th:first-child,.cb-root td:first-child{text-align:left}
.cb-root thead th{font-weight:600;vertical-align:bottom}
.cb-root td.n,.cb-root th.n{font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.cb-root .fmt-tbl th,.cb-root .fmt-tbl td{padding:5px 6px;font-size:12.5px}
.cb-root .cmp{min-width:560px}
.cb-root .cmp th:first-child,.cb-root .cmp td:first-child{position:sticky;left:0;background:var(--surface);z-index:1;min-width:210px;white-space:normal}
.cb-root .cmp thead th{background:var(--surface);color:var(--ink);border-bottom:2px solid var(--brand-2)}
.cb-root .cmp thead th small{display:block;font-weight:400;color:var(--muted);font-size:12px}
.cb-root .cmp tr.sec td{background:var(--surface-2);font-family:var(--font-display);font-weight:600;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding-top:9px;padding-bottom:9px}
.cb-root .cmp tr.subsec td{font-weight:600;padding-top:10px;color:var(--ink);background:var(--surface)}
.cb-root .cmp tr.strong td{font-weight:700;border-top:1px solid var(--ink)}
.cb-root .cmp td small{display:block;color:var(--muted);font-size:11px;font-family:var(--font-body)}
.cb-root .cmp td.sub-l{padding-left:22px;color:var(--muted)}
.cb-root .cmp tr.subtot td{background:var(--surface-2);font-weight:700;border-top:1px solid var(--line)}
.cb-root .cmp tr.subtot td:first-child{background:var(--surface-2)}
.cb-root .cmp tr.grand td{font-weight:700;border-top:2px solid var(--brand-2);background:var(--accent-soft)}
.cb-root .cmp tr.grand td:first-child{background:var(--accent-soft)}
.cb-root .price-grid th.grp,.cb-root .promo-tbl th.grp{text-align:center;border-left:2px solid var(--line)}
.cb-root .price-grid th.grp-s{text-align:right}
.cb-root .price-grid td.gs,.cb-root .price-grid th.gs,.cb-root .promo-tbl td.gs,.cb-root .promo-tbl th.gs{border-left:2px solid var(--line)}
.cb-root .price-grid td.na,.cb-root .promo-tbl td.na{color:var(--muted);text-align:center}
.cb-root .cmp-info{display:grid;gap:4px;margin:0 0 10px;font-size:13px}
.cb-root .cmp-info b{display:inline-block;min-width:1.4em;color:var(--accent-text)}
.cb-root .pt-box{border-top:1px solid var(--line);margin-top:14px;padding-top:10px}
.cb-root .pt-real{margin-top:10px;padding:8px 10px;border-radius:4px;background:var(--accent-soft);font-size:13px}
.cb-root .cmp td.na{color:var(--muted)}
.cb-root .price-grid td.cell,.cb-root .promo-tbl td.cell{padding:7px 10px}
.cb-root .price-grid td.cell b,.cb-root .promo-tbl td.cell b{display:block;font-family:var(--font-mono);font-weight:500;font-size:14px}
.cb-root .price-grid td.cell small,.cb-root .promo-tbl td.cell small{display:block;font-family:var(--font-mono);color:var(--muted);font-size:12px}
.cb-root .price-grid td.below,.cb-root .promo-tbl td.below{background:var(--warn-soft)}
.cb-root .price-grid td.below b,.cb-root .price-grid td.below small,.cb-root .promo-tbl td.below b,.cb-root .promo-tbl td.below small{color:var(--warn)}
.cb-root .price-grid td.cell.part b{color:var(--accent-text)}
.cb-root .promo-tbl td.eff b{color:var(--accent-text)}
.cb-root .promo-tbl td.below.eff b{color:var(--warn)}
.cb-root .th-sub{display:block;font-weight:400;color:var(--muted);font-size:12px}
.cb-root .seg{display:inline-flex;border:1px solid var(--line);border-radius:4px;overflow:hidden}
.cb-root .seg button{appearance:none;border:0;background:var(--surface);padding:0 12px;height:32px;cursor:pointer;color:var(--muted)}
.cb-root .seg button[aria-pressed="true"]{background:var(--accent-soft);color:var(--ink);font-weight:600}
.cb-root .toolbar{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:flex-end;margin-bottom:12px}
.cb-root .toolbar .field{min-width:0}
.cb-root .toolbar select{width:auto;min-width:190px;max-width:100%}
.cb-root .toolbar .with-unit input{width:84px}
.cb-root .saved{display:flex;flex-direction:column}
.cb-root .saved .it{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:9px 0;border-bottom:1px solid var(--line)}
.cb-root .saved .it:last-child{border-bottom:0}
.cb-root .saved .it .nm{flex:1 1 180px;min-width:0}
.cb-root .saved .it .nm b{display:block;overflow-wrap:anywhere}
.cb-root .saved .it .nm span{font-size:12px;color:var(--muted)}
.cb-root .empty{color:var(--muted);padding:14px 0;font-size:13px}
.cb-root .sheet{position:fixed;inset:0;z-index:30;background:rgba(10,14,8,.55);display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) max(16px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px))}
.cb-root .sheet[hidden]{display:none}
.cb-root .sheet .box{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:16px;width:min(720px,100%);max-height:100%;display:flex;flex-direction:column;gap:10px}
.cb-root .sheet textarea{width:100%;min-height:240px;flex:1;font-family:var(--font-mono);font-size:12px;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:4px;padding:8px;resize:vertical}
.cb-root .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:40;background:var(--ink);color:var(--bg);padding:9px 16px;border-radius:4px;font-size:13px;max-width:calc(100% - 32px)}
.cb-root .toast[hidden]{display:none}
@media (max-width:960px){.cb-root .split{grid-template-columns:minmax(0,1fr)}
.cb-root .aside{position:static}}
@media (max-width:640px){.cb-root .card{padding:14px}
.cb-root .r-lab{grid-template-columns:minmax(0,1fr) 72px 100px}
.cb-root .r-lab .lbl{grid-column:1/-1}
.cb-root .r-lg{grid-template-columns:repeat(3,minmax(0,1fr))}
.cb-root .r-lg .lbl,.cb-root .r-lg select{grid-column:1/-1}
.cb-root .lg-acc>summary .sum{flex:1 1 100%;margin-left:0;padding-left:24px;text-align:left}
.cb-root .r-adj{grid-template-columns:repeat(2,minmax(0,1fr))}
.cb-root .r-task{grid-template-columns:minmax(0,1fr) 92px 30px}
.cb-root .r-task>.t-name{grid-column:1/-1}
.cb-root .r-task>.t-prof{grid-column:1/-1}
.cb-root .r-task>.t-role{grid-column:1/-1}
.cb-root .r-extra{grid-template-columns:minmax(0,1fr) 72px 30px}
.cb-root .r-extra .lbl{grid-column:1/-1}
.cb-root .r-extra .out{text-align:left}
.cb-root .r-forf{grid-template-columns:minmax(0,1fr) 76px 30px}
.cb-root .r-forf .lbl{grid-column:1/-1}
.cb-root .r-forf .out{grid-column:1/-1;text-align:left}
.cb-root .r-cons{grid-template-columns:minmax(0,1fr) 96px 30px;grid-template-areas:"n p d" "m m m"}
.cb-root .r-chan{grid-template-columns:minmax(0,1fr) 92px 30px;grid-template-areas:"n p d" "b b b"}
.cb-root .r-vol{grid-template-columns:minmax(0,1fr) 112px 30px;grid-template-areas:"n p d" "h h h"}
.cb-root .r-colis3{grid-template-columns:repeat(3,minmax(0,1fr))}
.cb-root .r-colis3 .lbl{grid-column:1/-1}
.cb-root .r-sel{grid-template-columns:minmax(0,1fr)}
.cb-root details.card>summary .sum{flex:1 1 100%;margin-left:0;padding-left:22px;text-align:left}
.cb-root .r-mix{grid-template-columns:minmax(0,1fr) 92px}
.cb-root .r-mix .out{grid-column:1/-1;text-align:left}
.cb-root .r-en{grid-template-columns:minmax(0,1fr) 100px}
.cb-root .r-en .out{grid-column:1/-1;text-align:left}
.cb-root .r-ing{grid-template-columns:minmax(0,1fr) 112px 30px}
.cb-root .r-ing select{grid-column:1/-1}}
@media (prefers-reduced-motion:no-preference){@keyframes fadein{from{opacity:.4}to{opacity:1}}}
.cb-root,.cb-root *{box-sizing:border-box}
.cb-root{font-family:var(--font-body);color:var(--ink);background:var(--bg);min-height:100vh}
.cb-root h1,.cb-root h2,.cb-root h3{color:var(--ink);font-family:var(--font-display);margin:0;text-wrap:balance;font-weight:600}
.cb-root button,.cb-root input,.cb-root select,.cb-root textarea{font:inherit;color:inherit}
.cb-root .wrap{max-width:1320px;margin:0 auto;padding:20px max(16px,env(safe-area-inset-right,0px)) 40px max(16px,env(safe-area-inset-left,0px))}
.cb-root .btn:disabled{opacity:.45;cursor:not-allowed}
.cb-root input:disabled,.cb-root select:disabled,.cb-root textarea:disabled{cursor:not-allowed}
.cb-root .tab{animation:cbfade .18s ease-out}
@keyframes cbfade{from{opacity:.4}to{opacity:1}}
.cb-root .loading{padding:60px 16px;text-align:center;color:var(--muted)}
.cb-root :root{}
`;
