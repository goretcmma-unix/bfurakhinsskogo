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
const ids = suspectIds.map(id=>`"${id}"`).join(',');
const rows = await q(`/rest/v1/transactions?select=id,transaction_date,type,amount,currency,description,sender_name,recipient_name,bank_transaction_id,data_source,payment_method,is_public&id=in.(${suspectIds.join(',')})&order=transaction_date.desc`);
const stage = JSON.parse(await fs.readFile(path.join(ROOT,'.sber-data/sber-secrets/sync-stage.json'),'utf8'));
const byExt = new Map();
for (const t of stage.privateTransactions||[]) byExt.set(t.externalId, t);
const merged = rows.map(r => {
  const st = byExt.get(r.bank_transaction_id) || null;
  const raw = st?.raw || null;
  const payer = raw?.payerName || raw?.rurTransfer?.payerName || raw?.payeeName || null;
  return { ...r, stage_externalId: st?.externalId||null, stage_counterpartyName: st?.counterpartyName||null, raw_payerName: payer, raw_paymentPurpose: raw?.paymentPurpose||raw?.purpose||null, raw_payeeName: raw?.payeeName||raw?.rurTransfer?.payeeName||null };
});
console.log(JSON.stringify({count:rows.length, merged}, null, 2));
