import { supabase, getCurrentFundId } from './supabase';
import type {
  Transaction,
  Category,
  BankAccount,
  Document,
  Organization,
  Fund,
  TransactionFormData,
  CategoryFormData,
  BankAccountFormData,
  FullReport,
  ReportPeriod,
} from './types';

const DUP_CHECK_CHUNK = 1000;
const DUP_CHECK_CONCURRENCY = 10;
const INSERT_CHUNK = 1000;
const INSERT_CONCURRENCY = 4;

export async function getFunds(): Promise<Fund[]> {
  const { data, error } = await supabase.from('funds').select('*').order('created_at');
  if (error) throw error;
  return data || [];
}

export async function getCategories(fundId?: string): Promise<Category[]> {
  const targetFundId = fundId || await getCurrentFundId();
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('fund_id', targetFundId)
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return data || [];
}

export async function createCategory(data: CategoryFormData, fundId?: string): Promise<Category> {
  const targetFundId = fundId || await getCurrentFundId();
  const { data: result, error } = await supabase.from('categories').insert({ ...data, fund_id: targetFundId }).select().single();
  if (error) throw error;
  return result;
}

export async function updateCategory(id: string, data: Partial<CategoryFormData>): Promise<Category> {
  const { data: result, error } = await supabase.from('categories').update(data).eq('id', id).select().single();
  if (error) throw error;
  return result;
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
}

export async function getBankAccounts(fundId?: string): Promise<BankAccount[]> {
  const targetFundId = fundId || await getCurrentFundId();
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('fund_id', targetFundId)
    .eq('is_active', true)
    .order('created_at');
  if (error) throw error;
  return data || [];
}

export async function createBankAccount(data: BankAccountFormData, fundId?: string): Promise<BankAccount> {
  const targetFundId = fundId || await getCurrentFundId();
  const { data: result, error } = await supabase.from('bank_accounts').insert({ ...data, fund_id: targetFundId }).select().single();
  if (error) throw error;
  return result;
}

export async function updateBankAccount(id: string, data: Partial<BankAccountFormData>): Promise<BankAccount> {
  const { data: result, error } = await supabase.from('bank_accounts').update(data).eq('id', id).select().single();
  if (error) throw error;
  return result;
}

export async function deleteBankAccount(id: string): Promise<void> {
  const { error } = await supabase.from('bank_accounts').delete().eq('id', id);
  if (error) throw error;
}

export async function getTransactions(
  fundId?: string,
  options?: {
    limit?: number;
    offset?: number;
    type?: 'income' | 'expense';
    startDate?: string;
    endDate?: string;
    categoryId?: string;
  }
): Promise<{ data: Transaction[]; count: number }> {
  const targetFundId = fundId || await getCurrentFundId();
  const offset = options?.offset || 0;
  const limit = options?.limit || 50;
  const wantCount = offset === 0;
  let query = supabase
    .from('transactions')
    .select('*, category:categories(*)', wantCount ? { count: 'planned' } : undefined)
    .eq('fund_id', targetFundId)
    .order('transaction_date', { ascending: false });

  if (options?.type) query = query.eq('type', options.type);
  if (options?.startDate) query = query.gte('transaction_date', options.startDate);
  if (options?.endDate) query = query.lte('transaction_date', options.endDate);
  if (options?.categoryId) query = query.eq('category_id', options.categoryId);
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  const transformed = (data || []).map((row: any) => ({
    ...row,
    category: Array.isArray(row.category) && row.category.length > 0 ? row.category[0] : null,
  }));

  let total = 0;
  if (wantCount) {
    if (transformed.length === 0) total = offset;
    else if (transformed.length < limit) total = offset + transformed.length;
    else total = typeof count === 'number' && count >= offset + transformed.length ? count : offset + transformed.length;
  }

  return { data: transformed as Transaction[], count: total };
}

export async function getTransactionById(id: string): Promise<Transaction | null> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, category:categories(*), documents(*)')
    .eq('id', id)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  const transformed = data ? {
    ...data,
    category: Array.isArray((data as any).category) && (data as any).category.length > 0 ? (data as any).category[0] : null,
  } : null;
  return transformed as Transaction;
}

export async function createTransaction(data: TransactionFormData, fundId?: string): Promise<Transaction> {
  const targetFundId = fundId || await getCurrentFundId();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: result, error } = await supabase
    .from('transactions')
    .insert({ ...data, fund_id: targetFundId, user_id: user?.id })
    .select('*, category:categories(*)')
    .single();
  if (error) throw error;
  return {
    ...result,
    category: Array.isArray((result as any).category) && (result as any).category.length > 0 ? (result as any).category[0] : null,
  } as Transaction;
}

export async function updateTransaction(id: string, data: Partial<TransactionFormData>): Promise<Transaction> {
  const { data: result, error } = await supabase
    .from('transactions')
    .update(data)
    .eq('id', id)
    .select('*, category:categories(*)')
    .single();
  if (error) throw error;
  return {
    ...result,
    category: Array.isArray((result as any).category) && (result as any).category.length > 0 ? (result as any).category[0] : null,
  } as Transaction;
}

export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteAllTransactions(
  fundId?: string,
  onProgress?: (done: number) => void
): Promise<number> {
  const targetFundId = fundId || await getCurrentFundId();

  // 1) Server-side RPC (fast if function exists in DB)
  const { data: rpcData, error: rpcErr } = await supabase.rpc('delete_fund_transactions', { p_fund_id: targetFundId } as any);
  if (!rpcErr) {
    const n = typeof rpcData === 'number' ? rpcData : Number(rpcData);
    onProgress?.(Number.isFinite(n) && n >= 0 ? n : -1);
    return Number.isFinite(n) ? n : -1;
  }

  // 2) Single bulk delete request (instant for small volumes like ~100 rows)
  const { error: fastErr } = await supabase
    .from('transactions')
    .delete()
    .eq('fund_id', targetFundId);
  if (!fastErr) {
    onProgress?.(-1);
    return -1;
  }

  const isTimeout = (e: any) => String(e?.code || '') === '57014' || /statement timeout/i.test(String(e?.message || ''));
  if (isTimeout(rpcErr) || isTimeout(fastErr)) {
    throw new Error(
      'statement timeout (57014): удаление миллиона строк одним запросом превышает лимит времени БД. ' +
      'Сделайте один раз в Supabase → SQL Editor: (1) TRUNCATE TABLE public.transactions CASCADE; ' +
      '(2) выполните обновлённую функцию delete_fund_transactions из supabase/schema.sql и grant execute. ' +
      'После этого «Удалить все» из приложения будет мгновенным (TRUNCATE).'
    );
  }

  // 3) Limited fallback for moderate volumes
  let totalDeleted = 0;
  const batchSize = 200;
  for (let guard = 0; guard < 50; guard++) {
    const { data, error: selErr } = await supabase
      .from('transactions')
      .select('id')
      .eq('fund_id', targetFundId)
      .limit(batchSize);
    if (selErr) throw selErr;
    if (!data || data.length === 0) break;
    const ids = data.map((r: any) => r.id).filter(Boolean);
    if (ids.length === 0) break;

    let lastErr: any = null;
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      const { error: delErr } = await supabase.from('transactions').delete().in('id', ids);
      if (!delErr) ok = true;
      else { lastErr = delErr; await new Promise(r => setTimeout(r, 300 * (attempt + 1))); }
    }
    if (!ok) {
      const msg = lastErr?.message || fastErr.message || rpcErr.message || 'Не удалось удалить операции';
      const err = new Error(totalDeleted ? `${msg} (удалено ${totalDeleted} до ошибки)` : msg);
      (err as any).done = totalDeleted;
      throw err;
    }
    totalDeleted += ids.length;
    onProgress?.(totalDeleted);
  }

  const { data: rest } = await supabase.from('transactions').select('id').eq('fund_id', targetFundId).limit(1);
  if (rest && rest.length > 0) {
    throw new Error(
      `Удалена часть операций (${totalDeleted}). Остальные не удалены из-за лимита времени БД. ` +
      'Очистите таблицу в Supabase → SQL Editor: TRUNCATE TABLE public.transactions CASCADE;'
    );
  }
  return totalDeleted;
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function bulkCreateTransactions(
  transactions: TransactionFormData[],
  fundId?: string,
  options?: { chunkSize?: number; concurrency?: number; returnRows?: boolean; onProgress?: (done: number, total: number) => void }
): Promise<Transaction[]> {
  const targetFundId = fundId || await getCurrentFundId();
  const { data: { user } } = await supabase.auth.getUser();
  const chunkSize = Math.max(1, options?.chunkSize ?? INSERT_CHUNK);
  const concurrency = Math.max(1, options?.concurrency ?? INSERT_CONCURRENCY);
  const returnRows = options?.returnRows ?? false;

  const chunks: TransactionFormData[][] = [];
  for (let i = 0; i < transactions.length; i += chunkSize) chunks.push(transactions.slice(i, i + chunkSize));

  let done = 0;
  const total = transactions.length;
  const isTimeout = (e: any) => String(e?.code || '') === '57014' || /statement timeout/i.test(String(e?.message || ''));
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  const insertPayload = async (payload: any[], attempt = 0): Promise<Transaction[]> => {
    try {
      if (returnRows) {
        const { data, error } = await supabase.from('transactions').insert(payload).select();
        if (error) throw error;
        done += payload.length;
        options?.onProgress?.(Math.min(done, total), total);
        return (data || []) as Transaction[];
      } else {
        const { error } = await supabase.from('transactions').insert(payload);
        if (error) throw error;
        done += payload.length;
        options?.onProgress?.(Math.min(done, total), total);
        return [] as Transaction[];
      }
    } catch (err: any) {
      if (isTimeout(err) && payload.length > 25) {
        await sleep(150);
        const mid = Math.ceil(payload.length / 2);
        const left = await insertPayload(payload.slice(0, mid), 0);
        const right = await insertPayload(payload.slice(mid), 0);
        return left.concat(right);
      }
      if (isTimeout(err) && attempt < 5) {
        await sleep(500 * (attempt + 1));
        return insertPayload(payload, attempt + 1);
      }
      err.done = done;
      throw err;
    }
  };

  const chunkResults = await runWithConcurrency(chunks, concurrency, async (chunk) => {
    const payload = chunk.map(t => ({
      ...t,
      is_public: t.is_public ?? true,
      fund_id: targetFundId,
      user_id: user?.id,
    }));
    return insertPayload(payload);
  });

  return chunkResults.flat();
}

export async function getDocuments(transactionId: string): Promise<Document[]> {
  const { data, error } = await supabase.from('documents').select('*').eq('transaction_id', transactionId).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function uploadDocument(transactionId: string, file: File, fundId?: string): Promise<Document> {
  const targetFundId = fundId || await getCurrentFundId();
  const { data: { user } } = await supabase.auth.getUser();
  const fileExt = file.name.split('.').pop();
  const fileName = `${crypto.randomUUID()}.${fileExt}`;
  const storagePath = `${targetFundId}/${transactionId}/${fileName}`;
  const { error: uploadError } = await supabase.storage.from('fund-documents').upload(storagePath, file, { cacheControl: '3600', upsert: false });
  if (uploadError) throw uploadError;
  const { data, error } = await supabase
    .from('documents')
    .insert({ fund_id: targetFundId, transaction_id: transactionId, name: file.name, storage_path: storagePath, mime_type: file.type, size_bytes: file.size, uploaded_by: user?.id })
    .select()
    .single();
  if (error) throw error;
  await supabase.from('transactions').update({ document_status: 'attached', document_name: file.name, document_path: storagePath }).eq('id', transactionId);
  return data;
}

export async function deleteDocument(documentId: string, transactionId: string): Promise<void> {
  const { data: doc, error: fetchError } = await supabase.from('documents').select('storage_path').eq('id', documentId).single();
  if (fetchError) throw fetchError;
  await supabase.storage.from('fund-documents').remove([doc.storage_path]);
  const { error: deleteError } = await supabase.from('documents').delete().eq('id', documentId);
  if (deleteError) throw deleteError;
  const { count } = await supabase.from('documents').select('*', { count: 'exact', head: true }).eq('transaction_id', transactionId);
  if (count === 0) {
    await supabase.from('transactions').update({ document_status: 'missing', document_name: null, document_path: null }).eq('id', transactionId);
  }
}

export async function getDocumentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from('fund-documents').createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function getOrganization(fundId?: string): Promise<Organization | null> {
  const targetFundId = fundId || await getCurrentFundId();
  const { data, error } = await supabase.from('organization').select('*').eq('fund_id', targetFundId).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateOrganization(data: Partial<Organization>, fundId?: string): Promise<Organization> {
  const targetFundId = fundId || await getCurrentFundId();
  const { data: result, error } = await supabase.from('organization').update(data).eq('fund_id', targetFundId).select().single();
  if (error) throw error;
  return result;
}

export async function getFullReport(period: ReportPeriod, fundId?: string): Promise<FullReport> {
  const targetFundId = fundId || await getCurrentFundId();
  console.log('[getFullReport] fundId:', targetFundId, 'period:', period);
  const { data: transactions, error: txError } = await supabase
    .from('transactions')
    .select('*, category:categories(*)')
    .eq('fund_id', targetFundId)
    .gte('transaction_date', period.startDate)
    .lte('transaction_date', period.endDate)
    .order('transaction_date', { ascending: false });
  if (txError) throw txError;

  const { data: incomeBySource } = await supabase.from('income_by_source').select('*').eq('fund_id', targetFundId);
  const { data: expensesByCategory } = await supabase.from('expenses_by_category').select('*').eq('fund_id', targetFundId);
  const { data: monthlyStats } = await supabase.from('monthly_stats').select('*').eq('fund_id', targetFundId);

  const txns = (transactions || []).map((row: any) => ({
    ...row,
    category: Array.isArray(row.category) && row.category.length > 0 ? row.category[0] : null,
  })) as Transaction[];
  const income = txns.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const expense = txns.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);

  return {
    period,
    summary: { totalIncome: income, totalExpense: expense, balanceStart: 0, balanceEnd: income - expense, netChange: income - expense },
    incomeBySource: (incomeBySource || []).map((r: any) => ({ sourceType: r.source_type, totalAmount: Number(r.total_amount), count: r.count })),
    expensesByCategory: (expensesByCategory || []).map((r: any) => ({ categoryId: null, categoryName: r.category_name || 'Без категории', categoryType: r.category_type || 'expense', totalAmount: Number(r.total_amount), count: r.count })),
    monthlyStats: (monthlyStats || []).map((r: any) => ({ month: r.month, income: Number(r.income), expense: Number(r.expense), net: Number(r.net), operations: r.operations })),
    transactions: txns,
  };
}

export interface DailyStat {
  date: string
  income: number
  expense: number
  net: number
}

export async function getDailyStats(
  fundId?: string,
  options?: { startDate?: string; endDate?: string }
): Promise<DailyStat[]> {
  const targetFundId = fundId || await getCurrentFundId();
  let query = supabase
    .from('transactions')
    .select('transaction_date, type, amount')
    .eq('fund_id', targetFundId)
    .order('transaction_date', { ascending: true });

  if (options?.startDate) query = query.gte('transaction_date', options.startDate);
  if (options?.endDate) query = query.lte('transaction_date', options.endDate);

  const { data, error } = await query;
  if (error) throw error;

  const byDay = new Map<string, { income: number; expense: number }>();
  const parseDay = (v: any) => String(v).match(/^(\d{4})-(\d{2})-(\d{2})/)?.[0];
  for (const row of data || []) {
    const day = parseDay(row.transaction_date);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, { income: 0, expense: 0 });
    const bucket = byDay.get(day)!;
    const amt = Number(row.amount || 0);
    if (row.type === 'income') bucket.income += amt;
    else if (row.type === 'expense') bucket.expense += amt;
  }

  const result: DailyStat[] = [];
  for (const [day, v] of byDay.entries()) {
    result.push({ date: day, income: v.income, expense: v.expense, net: v.income - v.expense });
  }
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

export async function checkDuplicateTransactions(
  transactions: TransactionFormData[],
  fundId?: string,
  onProgress?: (done: number, total: number) => void
): Promise<Set<string>> {
  const targetFundId = fundId || await getCurrentFundId();
  const bankIds = Array.from(new Set(transactions.map(t => (t.bank_transaction_id || '').trim()).filter((id): id is string => !!id)));
  if (bankIds.length === 0) {
    onProgress?.(0, 0);
    return new Set();
  }

  const chunks: string[][] = [];
  for (let i = 0; i < bankIds.length; i += DUP_CHECK_CHUNK) chunks.push(bankIds.slice(i, i + DUP_CHECK_CHUNK));

  const existing = new Set<string>();
  let done = 0;
  await runWithConcurrency(chunks, DUP_CHECK_CONCURRENCY, async (chunk) => {
    const { data, error } = await supabase
      .from('transactions')
      .select('bank_transaction_id')
      .eq('fund_id', targetFundId)
      .in('bank_transaction_id', chunk);
    if (error) throw error;
    for (const d of data || []) {
      if (d.bank_transaction_id) existing.add(String(d.bank_transaction_id));
    }
    done += chunk.length;
    onProgress?.(Math.min(done, bankIds.length), bankIds.length);
  });
  return existing;
}
