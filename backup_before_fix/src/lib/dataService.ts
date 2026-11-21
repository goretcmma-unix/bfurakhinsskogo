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
  ImportPreview,
  ImportRow,
  FullReport,
  ReportPeriod,
} from './types';

// ═══════════════════════════════════════════════════════════════
// FUNDS
// ═══════════════════════════════════════════════════════════════
export async function getFunds(): Promise<Fund[]> {
  const { data, error } = await supabase.from('funds').select('*').order('created_at');
  if (error) throw error;
  return data || [];
}

// ═══════════════════════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════════════════════
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
  const { data: result, error } = await supabase
    .from('categories')
    .insert({ ...data, fund_id: targetFundId })
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function updateCategory(id: string, data: Partial<CategoryFormData>): Promise<Category> {
  const { data: result, error } = await supabase
    .from('categories')
    .update(data)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
}

// ═══════════════════════════════════════════════════════════════
// BANK ACCOUNTS
// ═══════════════════════════════════════════════════════════════
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
  const { data: result, error } = await supabase
    .from('bank_accounts')
    .insert({ ...data, fund_id: targetFundId })
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function updateBankAccount(id: string, data: Partial<BankAccountFormData>): Promise<BankAccount> {
  const { data: result, error } = await supabase
    .from('bank_accounts')
    .update(data)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function deleteBankAccount(id: string): Promise<void> {
  const { error } = await supabase.from('bank_accounts').delete().eq('id', id);
  if (error) throw error;
}

// ═══════════════════════════════════════════════════════════════
// TRANSACTIONS
// ═══════════════════════════════════════════════════════════════
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

  const client = supabase;
  let query = client
    .from('transactions')
    .select('*, category:categories(*)', { count: 'exact' })
    .eq('fund_id', targetFundId)
    .order('transaction_date', { ascending: false });

  if (options?.type) query = query.eq('type', options.type);
  if (options?.startDate) query = query.gte('transaction_date', options.startDate);
  if (options?.endDate) query = query.lte('transaction_date', options.endDate);
  if (options?.categoryId) query = query.eq('category_id', options.categoryId);
  if (options?.limit) query = query.limit(options.limit);
  if (options?.offset) query = query.range(options.offset, (options.offset || 0) + (options.limit || 50) - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  const transformed = (data || []).map((row: any) => ({
    ...row,
    category: Array.isArray(row.category) && row.category.length > 0 ? row.category[0] : null,
  }));

  return { data: transformed as Transaction[], count: count || 0 };
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

  const transformed = {
    ...result,
    category: Array.isArray((result as any).category) && (result as any).category.length > 0 ? (result as any).category[0] : null,
  };

  return transformed as Transaction;
}

export async function updateTransaction(id: string, data: Partial<TransactionFormData>): Promise<Transaction> {
  const { data: result, error } = await supabase
    .from('transactions')
    .update(data)
    .eq('id', id)
    .select('*, category:categories(*)')
    .single();
  if (error) throw error;

  const transformed = {
    ...result,
    category: Array.isArray((result as any).category) && (result as any).category.length > 0 ? (result as any).category[0] : null,
  };

  return transformed as Transaction;
}

export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
}

export async function bulkCreateTransactions(transactions: TransactionFormData[], fundId?: string): Promise<Transaction[]> {
  const targetFundId = fundId || await getCurrentFundId();
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('transactions')
    .insert(transactions.map(t => ({ ...t, fund_id: targetFundId, user_id: user?.id })))
    .select();
  if (error) throw error;
  return data || [];
}

// ═══════════════════════════════════════════════════════════════
// DOCUMENTS
// ═══════════════════════════════════════════════════════════════
export async function getDocuments(transactionId: string): Promise<Document[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('transaction_id', transactionId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function uploadDocument(
  transactionId: string,
  file: File,
  fundId?: string
): Promise<Document> {
  const targetFundId = fundId || await getCurrentFundId();
  const { data: { user } } = await supabase.auth.getUser();

  const fileExt = file.name.split('.').pop();
  const fileName = `${crypto.randomUUID()}.${fileExt}`;
  const storagePath = `${targetFundId}/${transactionId}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('fund-documents')
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('documents')
    .insert({
      fund_id: targetFundId,
      transaction_id: transactionId,
      name: file.name,
      storage_path: storagePath,
      mime_type: file.type,
      size_bytes: file.size,
      uploaded_by: user?.id,
    })
    .select()
    .single();
  if (error) throw error;

  await supabase
    .from('transactions')
    .update({ document_status: 'attached', document_name: file.name, document_path: storagePath })
    .eq('id', transactionId);

  return data;
}

export async function deleteDocument(documentId: string, transactionId: string): Promise<void> {
  const { data: doc, error: fetchError } = await supabase
    .from('documents')
    .select('storage_path')
    .eq('id', documentId)
    .single();
  if (fetchError) throw fetchError;

  await supabase.storage.from('fund-documents').remove([doc.storage_path]);

  const { error: deleteError } = await supabase.from('documents').delete().eq('id', documentId);
  if (deleteError) throw deleteError;

  const { data: otherDocs } = await supabase
    .from('documents')
    .select('id')
    .eq('transaction_id', transactionId)
    .limit(1);

  if (!otherDocs || otherDocs.length === 0) {
    await supabase
      .from('transactions')
      .update({ document_status: 'missing', document_name: null, document_path: null })
      .eq('id', transactionId);
  }
}

export async function getDocumentUrl(storagePath: string): Promise<string> {
  const { data } = await supabase.storage.from('fund-documents').createSignedUrl(storagePath, 3600);
  if (!data?.signedUrl) throw new Error('Failed to create signed URL');
  return data.signedUrl;
}

// ═══════════════════════════════════════════════════════════════
// ORGANIZATION
// ═══════════════════════════════════════════════════════════════
export async function getOrganization(fundId?: string): Promise<Organization | null> {
  const targetFundId = fundId || await getCurrentFundId();

  const { data, error } = await supabase
    .from('organization')
    .select('*')
    .eq('fund_id', targetFundId)
    .eq('id', 1)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data;
}

export async function updateOrganization(data: Partial<Organization>, fundId?: string): Promise<Organization> {
  const targetFundId = fundId || await getCurrentFundId();
  const { data: result, error } = await supabase
    .from('organization')
    .upsert({ ...data, fund_id: targetFundId, id: 1 })
    .select()
    .single();
  if (error) throw error;
  return result;
}

// ═══════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════
export async function getFullReport(period: ReportPeriod, fundId?: string): Promise<FullReport> {
  const targetFundId = fundId || await getCurrentFundId();

  const { data: transactions, error: txError } = await supabase
    .from('transactions')
    .select('*, category:categories(*)')
    .eq('fund_id', targetFundId)
    .gte('transaction_date', period.startDate)
    .lte('transaction_date', period.endDate)
    .order('transaction_date', { ascending: false });
  if (txError) throw txError;

  const { data: summary } = await supabase
    .from('fund_summary')
    .select('*')
    .eq('fund_id', targetFundId)
    .single();

  const { data: incomeBySource } = await supabase
    .from('income_by_source')
    .select('*')
    .eq('fund_id', targetFundId);

  const { data: expensesByCategory } = await supabase
    .from('expenses_by_category')
    .select('*')
    .eq('fund_id', targetFundId);

  const { data: monthlyStats } = await supabase
    .from('monthly_stats')
    .select('*')
    .eq('fund_id', targetFundId);

  const txns = (transactions || []).map((row: any) => ({
    ...row,
    category: Array.isArray(row.category) && row.category.length > 0 ? row.category[0] : null,
  })) as Transaction[];
  const income = txns.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const expense = txns.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);

  return {
    period,
    summary: {
      totalIncome: income,
      totalExpense: expense,
      balanceStart: 0,
      balanceEnd: income - expense,
      netChange: income - expense,
    },
    incomeBySource: (incomeBySource || []).map(r => ({
      sourceType: r.source_type,
      totalAmount: Number(r.total_amount),
      count: r.count,
    })),
    expensesByCategory: (expensesByCategory || []).map(r => ({
      categoryId: null,
      categoryName: r.category_name || 'Без категории',
      categoryType: r.category_type || 'expense',
      totalAmount: Number(r.total_amount),
      count: r.count,
    })),
    monthlyStats: (monthlyStats || []).map(r => ({
      month: r.month,
      income: Number(r.income),
      expense: Number(r.expense),
      net: Number(r.net),
      operations: r.operations,
    })),
    transactions: txns,
  };
}

// ═══════════════════════════════════════════════════════════════
// IMPORT HELPERS
// ═══════════════════════════════════════════════════════════════
export async function checkDuplicateTransactions(
  transactions: TransactionFormData[],
  fundId?: string
): Promise<Set<string>> {
  const targetFundId = fundId || await getCurrentFundId();

  const bankIds = transactions
    .map(t => t.bank_transaction_id)
    .filter((id): id is string => !!id);

  if (bankIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from('transactions')
    .select('bank_transaction_id')
    .eq('fund_id', targetFundId)
    .in('bank_transaction_id', bankIds);
  if (error) throw error;

  return new Set((data || []).map(d => d.bank_transaction_id!).filter(Boolean));
}