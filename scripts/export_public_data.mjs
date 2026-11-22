import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ybgxfewbhjvtgdklzihr.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_ANON_KEY) {
  console.error('Укажите SUPABASE_ANON_KEY через переменную окружения');
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const { data, error } = await client
  .from('public_transactions')
  .select('date,time,type,category,description,donor,amount,doc')
  .order('date', { ascending: false })
  .limit(250);

if (error) {
  console.error('Ошибка Supabase:', error);
  process.exit(1);
}

const transactions = (data || []).map(t => ({
  date: t.date,
  time: t.time || '',
  type: t.type,
  category: t.category || '—',
  description: t.description || '',
  donor: t.donor || '—',
  amount: Number(t.amount),
  doc: t.doc || '—'
}));

const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
const expense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

const snapshot = {
  updatedAt: new Date().toISOString(),
  balance: income - expense,
  donations: income,
  expenses: expense,
  transactions
};

const fs = await import('node:fs');
fs.writeFileSync('public-site/data.json', JSON.stringify(snapshot, null, 2));

console.log(`Экспортировано ${transactions.length} транзакций в public-site/data.json`);
console.log(`Доходы: ${income}, Расходы: ${expense}, Баланс: ${income - expense}`);
