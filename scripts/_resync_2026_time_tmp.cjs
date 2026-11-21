const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

(async () => {
  try {
    const root = process.cwd();
    const envText = fs.readFileSync(path.join(root, '.env'), 'utf8');
    for (const line of envText.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }

    const stagePath = path.join(root, '.sber-data', 'sber-secrets', 'sync-stage.json');
    if (fs.existsSync(stagePath)) {
      fs.unlinkSync(stagePath);
      console.log('STAGE_CLEARED', stagePath);
    } else {
      console.log('STAGE_NOT_FOUND', stagePath);
    }

    const req = createRequire(path.join(root, 'scripts', 'dummy.js'));
    const mod = req(path.join(root, 'out', 'main', 'sber-api', 'index.js'));
    const { SberApi } = mod;
    const api = new SberApi({ userDataDir: path.join(root, '.sber-data') });

    if (process.env.SBER_ACCESS_TOKEN) {
      await api.oauth.setTokens({
        accessToken: process.env.SBER_ACCESS_TOKEN,
        refreshToken: process.env.SBER_REFRESH_TOKEN || '',
        expiresInSeconds: Number(process.env.SBER_TOKEN_EXPIRES_IN || 3600)
      });
    }

    const account = (process.env.SBER_PRODUCTION_ACCOUNT_NUMBER || process.env.SBER_ACCOUNT_NUMBER || '').trim();
    if (!account) throw new Error('No account number');

    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date();
    const endStr = end.toISOString().slice(0,10);
    const dates = [];
    for (let d = new Date(start); d.toISOString().slice(0,10) <= endStr; d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(d.toISOString().slice(0,10));
    }

    console.log(JSON.stringify({ from: dates[0], to: dates[dates.length-1], days: dates.length, accountMasked: account.slice(0,4)+'…'+account.slice(-4) }));

    let fetchedTotal = 0, errors = 0, daysWithTx = 0;
    const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      try {
        const res = await api.sync.fetchAndStage({ accountNumber: account, fromDate: date, toDate: date });
        fetchedTotal += res.fetched || 0;
        if ((res.fetched || 0) > 0) daysWithTx++;
        if ((i+1) % 40 === 0 || (res.fetched||0)>0) {
          console.log('PROGRESS', JSON.stringify({ i: i+1, of: dates.length, date, fetched: res.fetched, daysWithTx }));
        }
      } catch (e) {
        errors++;
        console.log('ERR', JSON.stringify({ i: i+1, date, msg: String(e && (e.message||e)).slice(0,220) }));
        if (errors > 40) { console.log('ABORT too many errors'); break; }
      }
      await sleep(250);
    }

    console.log('STAGE_DONE', JSON.stringify({ fetchedTotal, daysWithTx, errors }));

    const prepared = await api.sync.toTransactionRows();
    console.log('PREPARED', JSON.stringify({ rows: prepared.rows.length, incoming: prepared.incoming, outgoing: prepared.outgoing }));

    if (!prepared.rows.length) { console.log('NO_ROWS'); process.exit(0); }

    const { createClient } = require('@supabase/supabase-js');
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: fund, error: fundError } = await admin.from('funds').select('id').limit(1).single();
    if (fundError || !fund) throw new Error('No fund: ' + (fundError && (fundError.message || JSON.stringify(fundError))));

    let upserted = 0;
    const BATCH = 200;
    for (let i = 0; i < prepared.rows.length; i += BATCH) {
      const batch = prepared.rows.slice(i, i + BATCH).map(r => ({ ...r, fund_id: fund.id }));
      const { data, error } = await admin
        .from('transactions')
        .upsert(batch, { onConflict: 'fund_id,bank_transaction_id', ignoreDuplicates: false })
        .select('id');
      if (error) throw error;
      upserted += (data ? data.length : 0);
    }
    console.log('DB_UPSERT', JSON.stringify({ upserted, totalPrepared: prepared.rows.length }));

    // verify sample
    const { data: sample } = await admin.from('transactions')
      .select('transaction_date,description,bank_transaction_id')
      .eq('data_source','sber_api')
      .gte('transaction_date','2026-11-18T00:00:00')
      .order('transaction_date',{ascending:false})
      .limit(5);
    console.log('SAMPLE', JSON.stringify(sample, null, 2));
  } catch (e) {
    console.log('ERROR', JSON.stringify({ message: e && e.message, details: e && e.details, hint: e && e.hint, code: e && e.code, stack: String(e&&e.stack).slice(0,500) }));
    process.exit(1);
  }
})();
