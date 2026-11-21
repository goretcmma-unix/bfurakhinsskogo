import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('[Supabase] VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env');
}

export const supabase: SupabaseClient<Database> = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  db: {
    schema: 'public',
  },
  global: {
    headers: {
      'X-Client-Info': 'charity-finance-desktop',
    },
  },
});

export function getSupabase(): SupabaseClient<Database> {
  return supabase;
}

// Local-only mode: use first fund without auth
let cachedFundId: string | null = null;
let dbInitialized = false;

export async function initDatabase(): Promise<void> {
  if (dbInitialized) return;
  dbInitialized = true;

  try {
    // Ensure default fund exists
    const { data: existingFund, error: fundError } = await supabase
      .from('funds')
      .select('id')
      .limit(1)
      .single();

    let fundId: string;
    if (fundError || !existingFund) {
      const { data: newFund, error: insertError } = await supabase
        .from('funds')
        .insert({
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Фонд имени Абдуллахажи Урахинского',
          description: 'Прозрачная помощь тем, кто в ней нуждается.',
          is_active: true,
        })
        .select('id')
        .single();

      if (insertError) throw insertError;
      fundId = newFund.id;
    } else {
      fundId = existingFund.id;
    }

    cachedFundId = fundId;

    // Ensure default categories exist
    const { data: existingCats, error: catsError } = await supabase
      .from('categories')
      .select('id')
      .eq('fund_id', fundId);

    if (catsError) throw catsError;

    if (!existingCats || existingCats.length === 0) {
      const defaultCategories = [
        { fund_id: fundId, name: 'Гранты', type: 'income', description: 'Грантовые поступления', is_active: true, sort_order: 10 },
        { fund_id: fundId, name: 'Пожертвования', type: 'income', description: 'Частные пожертвования', is_active: true, sort_order: 20 },
        { fund_id: fundId, name: 'Корпоративные взносы', type: 'income', description: 'Взносы от компаний', is_active: true, sort_order: 25 },
        { fund_id: fundId, name: 'Мероприятия', type: 'income', description: 'Сборы на мероприятиях', is_active: true, sort_order: 30 },
        { fund_id: fundId, name: 'Программы', type: 'expense', description: 'Программные расходы', is_active: true, sort_order: 40 },
        { fund_id: fundId, name: 'Офис и хозяйство', type: 'expense', description: 'Офисные расходы', is_active: true, sort_order: 50 },
        { fund_id: fundId, name: 'Команда', type: 'expense', description: 'Зарплаты и подрядчики', is_active: true, sort_order: 60 },
        { fund_id: fundId, name: 'Прочие расходы', type: 'expense', description: 'Прочие операционные расходы', is_active: true, sort_order: 70 },
      ];
      const { error: catsInsertError } = await supabase.from('categories').insert(defaultCategories as any);
      if (catsInsertError) throw catsInsertError;
    }

    // Ensure default bank account exists
    const { data: existingBanks, error: banksError } = await supabase
      .from('bank_accounts')
      .select('id')
      .eq('fund_id', fundId);

    if (banksError) throw banksError;

    if (!existingBanks || existingBanks.length === 0) {
      const { error: bankInsertError } = await supabase.from('bank_accounts').insert({
        fund_id: fundId,
        bank_name: 'Основной счёт',
        account_name: 'Расчётный счёт',
        account_number_masked: '****0001',
        currency: 'RUB',
        is_active: true,
        is_default: true,
      } as any);
      if (bankInsertError) throw bankInsertError;
    }
  } catch (e: any) {
    console.warn('[Supabase] Auto-initialization skipped (tables may not exist yet):', e.message);
    console.warn('[Supabase] Apply supabase/schema.sql once in Supabase → SQL Editor, then restart.');
  }
}

export async function getCurrentFundId(): Promise<string> {
  if (cachedFundId) return cachedFundId;

  await initDatabase();

  if (cachedFundId) return cachedFundId;

  const { data, error } = await supabase
    .from('funds')
    .select('id')
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error('No fund found. Apply supabase/schema.sql in Supabase → SQL Editor, then restart.');
  }

  cachedFundId = data.id;
  return cachedFundId;
}
