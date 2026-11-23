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
const badMarkers = ['ОКАЗАНИЕ','ФИНАНСОВ','ПОМОЩ','БЛАГОТВОР','ПОЖЕРТВ','САДАК','САДАКЬ','ПЕРЕВОД','СБП','ОПЛАТА','НДС НЕ ОБЛАГАЕТСЯ','БЕЗНАЛИЧНЫЙ','СПИСАНИЕ','ПОСТУПЛЕНИЕ'];
let offset=0; const page=1000; const suspects=[];
let total=0;
while(true){
  const rows=await q(`/rest/v1/transactions?select=id,transaction_date,type,amount,currency,description,sender_name,recipient_name,source_type,payment_method,bank_transaction_id,data_source,is_public,category_id&order=transaction_date.desc&limit=${page}&offset=${offset}`);
  if(!Array.isArray(rows)||rows.length===0) break;
  for(const r of rows){
    total++;
    if(r.type!=='income') continue;
    const s=(r.sender_name||'').trim();
    const d=(r.description||'').trim();
    const su=s.toUpperCase();
    const reasons=[];
    if(!s) reasons.push('empty_sender');
    if(badMarkers.some(m=>su.includes(m))) reasons.push('sender_has_purpose_marker');
    if(/^[А-ЯЁA-Z]{2,}\s+[А-ЯЁA-Z]\.\s*[А-ЯЁA-Z]?\.?$/.test(s) && d){
      const dw=d.toUpperCase().replace(/[^А-ЯЁA-Z\s]/g,' ').split(/\s+/).filter(Boolean);
      const sw=su.replace(/[^А-ЯЁA-Z\s]/g,' ').split(/\s+/).filter(Boolean);
      if(sw[0] && dw.includes(sw[0])) reasons.push('sender_initials_from_purpose');
    }
    if(s.length>80) reasons.push('sender_too_long');
    if(reasons.length) suspects.push({id:r.id,date:r.transaction_date,amount:r.amount,currency:r.currency,sender_name:s,description:d.slice(0,140),bank_transaction_id:r.bank_transaction_id,data_source:r.data_source,reasons});
  }
  offset+=rows.length;
  if(rows.length<page) break;
}
const byReason={};
for(const s of suspects){ for(const r of s.reasons){ byReason[r]=(byReason[r]||0)+1; } }
console.log(JSON.stringify({total_rows:total,total_suspects:suspects.length,byReason,suspects:suspects.slice(0,60)},null,2));
