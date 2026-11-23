import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const envText = await fs.readFile(path.join(ROOT, '.env'), 'utf8').catch(() => '');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
async function q(pathname) {
  const res = await fetch(new URL(pathname, url), { headers: { apikey:key, Authorization:`Bearer ${key}` } });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return json;
}
const suspectIds = [
"77aa6c5c-b784-45b2-b97c-ff14b66bcf25","ba59b9bf-8c31-40c3-902d-63e0e866f0d7","80d5748f-c78d-4e72-9652-4a1be233afca",
"61ff1bfa-9b87-4edc-b077-6612dc3de3b8","364c96d7-7cc7-41c8-adc7-53a7b238fe48","294d149d-a53f-4011-a34e-36a9117deaa6",
"15736557-68ed-4638-b820-169a55d26e51","1129b9be-648b-4de4-a3a5-17316bd3b78e","7b61d00b-faef-4225-b86a-2997b3ee89ef",
"bab063c0-2716-4fa3-a4d5-030e330c9e33","7fdb7f9c-2fc3-4359-ab51-60ae34d36756","5bb63d02-b407-4823-8e64-a2c6de9f5335",
"cbecf8b9-39d3-4b45-9e4c-95be2b71a8d4","3706a510-a0d4-4aff-bb8f-a9e8924d029a","43a9b69f-4317-4ffe-8551-9a22545874ab",
"af951d5d-d957-4585-b8d0-5729f5ca625e","57d8fc46-3f1c-4228-ab9e-d1632396c286","9ac0f980-ebe9-4c1a-9b22-ed9aab7be365",
"d5393a5c-ef92-445a-9299-52a4ad4ae3dd","cf668f87-3378-4742-b2a6-b41f0a27ed97","40ececfb-2959-452d-95c5-4ae573847ccf",
"12b63b6f-d04d-4c5d-b559-5900b79a44c7","486fbdaa-a8f8-4cbd-b7a1-0eada45a8ddf","59c8c95b-db9f-4765-96ae-a6511a2370e4",
"47106477-b1a5-4980-9d73-f14c64e8bdcd","5f9aca08-6861-499c-9da0-c9080bbc38f4","4477a355-3573-48fc-91b6-5a1636e0b1fc",
"94180981-2ce1-4706-b9ee-bc325189be9e","81692f6f-bab7-427a-850d-b4659c1922bd","b37acc00-128c-46ca-994a-80ff5571d821",
"2ac540c5-1e40-4f39-b0de-adfaa9540f04","ff29483d-00e1-4221-8e17-c460111468d9","e3244617-83e1-4116-9847-e38ac80fad1d",
"2daedd7f-caa8-498c-8cee-89f1f50826b7","578870d7-83c4-4988-8f81-bd96b9723bcf","3e9b0102-ef59-4343-b1ca-c1351e312874",
"c7a00c7b-c7c0-45cb-b025-001932ec5211","a906568f-3678-423b-932e-ce9d949d9c9f","aa4e49a6-eac0-4814-b857-d5910ee3e023",
"8d60797d-1c79-4d73-b408-5fd9638f96b8","e0e92566-ffbb-4dca-a58f-7ff2b74c5223","4d2299e6-86d6-4e31-8b70-a5e113c62482",
"28042746-51aa-44bb-9d28-1d1740222f17","e6908ef2-e97c-4d6c-8813-b467b65a7622","e4eb929f-7d98-4234-a4e0-cf1e37ac12bc",
"6fadff43-e851-41dd-b553-6c3b05928678","ce405314-4979-4d5d-8f6a-da63207e49ec","e0919e82-03d8-494a-be9d-71e3d25efcc8",
"aa4c264d-4d7a-40d6-9f81-d0824c99876e"
];
const rows = await q(`/rest/v1/transactions?select=id,transaction_date,type,amount,currency,description,sender_name,bank_transaction_id,data_source&id=in.(${suspectIds.join(',')})&order=transaction_date.asc`);
const stage = JSON.parse(await fs.readFile(path.join(ROOT,'.sber-data/sber-secrets/sync-stage.json'),'utf8'));
const byExt = new Map();
for (const t of stage.privateTransactions||[]) byExt.set(t.externalId, t);

const BANK_MARKERS = ['СБЕРБАНК', 'ТБАНК', 'ТИНЬКОФФ', 'ВТБ', 'АЛЬФА', 'СБП', 'НСПК', 'ЦБ РФ'];
const BANK_WORD_MARKERS = ['БАНК']; // word-boundary to avoid matching surnames like КУРБАНКАДИЕВ
const ORG_OR_IP_MARKERS = ['ООО', 'АО', 'ЗАО', 'ПАО', 'ИП ', 'ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ', 'КФХ', 'БФ', 'АНО', 'НКО', 'ФОНД'];
const PERSON_STOPWORDS = new Set([
  'ЧАСТНОЕ','ЛИЦО','ОКАЗАНИЕ','ФИНАНСОВОЙ','ПОМОЩИ','БЛАГОТВОРИТЕЛЬНОСТЬ','ПОЖЕРТВОВАНИЕ',
  'САДАКА','САДАКЪА','САДАКЬА','САДАКАХ','ПЕРЕВОД','СРЕДСТВ','ОПЛАТА','СЧЕТ','СЧЁТ','УЛ','ДОМ',
  'БАНК','СБП','ПОМОЩЬ','ПОДДЕРЖКА','БЛАГОДАРЯ','БЛАГОДАРЮ','БЛАГОДАРНОСТЬ','ПЕРЕЧИСЛЕНИЕ',
  'ВЗНОС','ДАР','ЦЕЛЕВОЕ','НАЗНАЧЕНИЕ','НДС','КАРТА','СЧЕТА','КОШЕЛЕК','ТЕЛЕФОН','НОМЕР',
  'СБОР','ПОСТРАДАВШИМ','ПОГОРЕЛЬЦАМ','МАЛОИМУЩИМ','НУЖДАЮЩИМСЯ','НУЖДАЮЩИМ','ЛЕЧЕНИЕ','ВОДУ','ВОДА','ВОДОПРОВОД',
  'ВОССТАНОВЛЕНИЕ','ВОСТАНОВЛЕНИЕ','ВОСТОНОВЛЕНИЕ','ПРОВЕДЕНИЕ','ПОДДЕРЖКУ','МАТЕРИ','МЕЧЕТИ','РАДИ','ПОМОШЬ',
  'ПЯТНИЧНЫЙ','ПУСТЬ','БЛАГОЕ','БЛАГИЕ','ПОЖАРЕ','МУРЕГО','БИСМИАЛЛАХ','БИСМИЛЛАХ',
  'ПАКЕТ','ПОМОГИТЕ','ХАДЖИ','УРАХИНСКОГО','ИМ','ФОНДУ','ОТДЕЛЕНИЕ','ФИЛИАЛ'
]);
const escapeRegExp=v=>String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

const hasWordMarker=(value,markers)=>{const u=String(value||'').toUpperCase(); return markers.some(m=>{const t=String(m).trim().toUpperCase(); if(!t) return false; return new RegExp(`(^|[^А-ЯЁA-Z0-9])${escapeRegExp(t)}([^А-ЯЁA-Z0-9]|$)`,'i').test(u);});};
const hasBankWordMarker = v => hasWordMarker(v,BANK_WORD_MARKERS);
const hasBankMarker = v => hasWordMarker(v,BANK_MARKERS) || hasBankWordMarker(v);
const hasOrgOrIpMarker = v => hasWordMarker(v,ORG_OR_IP_MARKERS);
const fioSegments = v => String(v??'').split('//').map(s=>s.trim()).filter(Boolean);
function cutTechnicalTail(value){
  let s=String(value??'');
  s=s.split(/\bИНН\b/i)[0];
  s=s.split('//')[0];
  s=s.split(';')[0];
  s=s.split(',')[0];
  s=s.split('(')[0];
  for (const word of ['ул','улица','д.','дом','кв.','г.','с.','пос.','р-н','респ.']) {
    const re=new RegExp(`\\b${word.replace(/[.]/g,'\\.')}`,'i');
    const parts=s.split(re); if(parts.length>1) s=parts[0];
  }
  return s.trim();
}
const isOnlyLetters = v => /^[А-ЯЁа-яё-]+$/.test(v);
function hasDigitsOrRef(v){ return /[0-9№]/.test(String(v||'')); }
function formatPerson(raw){
  const source=String(raw||'').trim();
  if(!source || hasDigitsOrRef(source)) return null;
  if(hasBankMarker(source) || hasOrgOrIpMarker(source)) return null;
  const s=cutTechnicalTail(source);
  if(!s) return null;
  const words=s.split(/\s+/).filter(Boolean);
  if(words.length===0) return null;
  const first=words[0];
  if(!isOnlyLetters(first)) return null;
  const firstUpper=first.toUpperCase();
  if(PERSON_STOPWORDS.has(firstUpper)) return null;
  if(hasWordMarker(firstUpper,ORG_OR_IP_MARKERS)||hasWordMarker(firstUpper,BANK_MARKERS)||hasBankWordMarker(firstUpper)) return null;
  const take=words.slice(0,3).map(w=>w.toUpperCase());
  if(take.some(w=>!isOnlyLetters(w)||PERSON_STOPWORDS.has(w))) return null;
  if(take.length===1) return take[0];
  if(take.length===2) return `${take[0]} ${take[1][0]}.`;
  return `${take[0]} ${take[1][0]}. ${take[2][0]}.`;
}
function extractByExplicitMarkers(text){
  const raw=String(text??'').trim(); if(!raw) return null;
  for (const re of [
    /от\s+([А-ЯЁа-яё-]+(?:\s+[А-ЯЁа-яё-]+){0,3})/i,
    /отправитель\s*[:\-]\s*([А-ЯЁа-яё-]+(?:\s+[А-ЯЁа-яё-]+){0,3})/i,
    /плательщик\s*[:\-]\s*([А-ЯЁа-яё-]+(?:\s+[А-ЯЁа-яё-]+){0,3})/i
  ]) { const m=raw.match(re); if(m?.[1]) return m[1]; }
  return null;
}
function firstValidName(...candidates){
  for(const c of candidates){ if(!c) continue; const f=formatPerson(String(c)); if(f) return f; }
  return null;
}
function cleanBankSenderName(raw){
  let s=String(raw||'').trim().split('//')[0].replace(/\s+/g,' ').trim();
  s=cutTechnicalTail(s);
  if (!s) return 'Не указан';
  if (/сбербанк/i.test(s)) return 'ПАО Сбербанк';
  if (/тинькофф|т-?банк|тбанк/i.test(s)) return 'Т-Банк';
  if (/втб/i.test(s)) return 'ВТБ';
  if (/альфа/i.test(s)) return 'Альфа-Банк';
  return s.length > 80 ? 'Банк-отправитель' : s;
}
function resolve(payerName, paymentPurpose){
  const pn=String(payerName??'').trim();
  const pp=String(paymentPurpose??'').trim();
  if(pn && hasOrgOrIpMarker(pn) && !hasBankMarker(pn)) return {newName: cutTechnicalTail(pn)||'Не указан', rule:'org'};
  if(pn && hasBankMarker(pn)){
    const found = firstValidName(...fioSegments(pn), extractByExplicitMarkers(pn));
    if(found) return {newName: found, rule:'sbp_fio'};
    return {newName: cleanBankSenderName(pn), rule:'sbp_bank_fallback'}; // never purpose
  }
  const found = firstValidName(extractByExplicitMarkers(pn), ...fioSegments(pn), pn);
  if(found) return {newName: found, rule:'person'};
  const markerFromPurpose = firstValidName(extractByExplicitMarkers(pp));
  if(markerFromPurpose) return {newName: markerFromPurpose, rule:'purpose_explicit_marker'};
  return {newName: 'Не указан', rule:'unknown_fallback'};
}

const report=[];
for (const r of rows){
  const st = byExt.get(r.bank_transaction_id);
  const raw = st?.raw || {};
  const payer = raw.payerName || raw.rurTransfer?.payerName || r.sender_name || '';
  const purpose = raw.paymentPurpose || raw.purpose || r.description || '';
  const resolved = resolve(payer, purpose);
  const oldName = (r.sender_name||'').trim();
  const newName = resolved.newName;
  report.push({
    id: r.id,
    bank_transaction_id: r.bank_transaction_id,
    date: r.transaction_date,
    amount: r.amount,
    currency: r.currency,
    old_sender_name: oldName,
    new_sender_name: newName,
    will_change: oldName !== newName,
    rule: resolved.rule,
    raw_payerName: payer,
    raw_paymentPurpose: purpose,
    description: r.description
  });
}
await fs.writeFile(path.join(ROOT,'scripts','_tmp_backfill_dry_run.json'), JSON.stringify({generatedAt:new Date().toISOString(), total:report.length, changes:report.filter(x=>x.will_change).length, report}, null, 2), 'utf8');
const changes = report.filter(x=>x.will_change);
console.log(`TOTAL=${report.length} CHANGES=${changes.length}`);
for (const c of changes){
  console.log(`${c.id}\t${c.date}\t${c.amount} ${c.currency}\tOLD=${JSON.stringify(c.old_sender_name)}\tNEW=${JSON.stringify(c.new_sender_name)}\tRULE=${c.rule}\tPAYER=${JSON.stringify(c.raw_payerName).slice(0,120)}`);
}
