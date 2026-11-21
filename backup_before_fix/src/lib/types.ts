export type TxType = 'income' | 'expense';
export type CategoryType = 'income' | 'expense';
export type DocumentStatus = 'attached' | 'missing' | 'expected';
export type SourceType = 'donation' | 'grant' | 'corporate' | 'event' | 'membership' | 'other';
export type PaymentMethod = 'bank_transfer' | 'cash' | 'card' | 'online' | 'crypto' | 'other';
export type DonorType = 'individual' | 'legal';
export type TransactionStatus = 'completed' | 'pending' | 'cancelled';
export type UserRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface Fund {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  fund_id: string;
  name: string;
  type: CategoryType;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BankAccount {
  id: string;
  fund_id: string;
  bank_name: string;
  account_name: string;
  account_number_masked: string;
  currency: string;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  fund_id: string;
  user_id: string | null;
  transaction_date: string;
  type: TxType;
  amount: number;
  currency: string;
  description: string;
  category_id: string | null;
  // Банковские данные отправителя
  sender_name: string | null;
  sender_bank: string | null;
  sender_account_masked: string | null;
  // Банковские данные получателя
  recipient_name: string | null;
  recipient_bank: string | null;
  recipient_account_masked: string | null;
  // Источник поступления
  source_type: SourceType | null;
  // Дополнительно
  comment: string | null;
  // Документы
  document_name: string | null;
  document_path: string | null;
  document_status: DocumentStatus;
  // Банковский ID операции
  bank_transaction_id: string | null;
  // Способ оплаты/поступления
  payment_method: PaymentMethod | null;
  // Публикация на публичной странице
  is_public: boolean;
  // Системные
  created_at: string;
  updated_at: string;
  // Связи (загружаются отдельно)
  category?: Category | null;
  documents?: Document[];
}

export interface Document {
  id: string;
  fund_id: string;
  transaction_id: string;
  name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
}

export interface Organization {
  id: number;
  fund_id: string;
  name: string;
  mission: string;
  inn: string;
  ogrn: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  donation_url: string;
  updated_at: string;
}

export interface UserFund {
  id: string;
  user_id: string;
  fund_id: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

// Для форм
export interface TransactionFormData {
  transaction_date: string;
  type: TxType;
  amount: number;
  currency: string;
  description: string;
  category_id: string | null;
  sender_name: string;
  sender_bank: string;
  sender_account_masked: string;
  recipient_name: string;
  recipient_bank: string;
  recipient_account_masked: string;
  source_type: SourceType | null;
  comment: string;
  document_name: string;
  document_path: string;
  document_status: DocumentStatus;
  bank_transaction_id: string;
  payment_method: PaymentMethod | null;
  is_public: boolean;
}

export interface CategoryFormData {
  name: string;
  type: CategoryType;
  description: string;
  is_active: boolean;
  sort_order: number;
}

export interface BankAccountFormData {
  bank_name: string;
  account_name: string;
  account_number_masked: string;
  currency: string;
  is_active: boolean;
  is_default: boolean;
}

export interface DocumentFormData {
  name: string;
  file: File;
}

// Для импорта
export interface ImportColumnMapping {
  sourceColumn: string;
  targetField: keyof TransactionFormData | 'ignore';
}

export interface ImportRow {
  raw: Record<string, string>;
  mapped: Partial<TransactionFormData>;
  validation: {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  };
  isDuplicate: boolean;
}

export interface ImportPreview {
  headers: string[];
  rows: ImportRow[];
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  errorRows: number;
}

// Для отчётов
export interface ReportPeriod {
  startDate: string;
  endDate: string;
  label: string;
}

export interface ReportSummary {
  totalIncome: number;
  totalExpense: number;
  balanceStart: number;
  balanceEnd: number;
  netChange: number;
}

export interface IncomeBySource {
  sourceType: SourceType | null;
  totalAmount: number;
  count: number;
}

export interface ExpenseByCategory {
  categoryId: string | null;
  categoryName: string;
  categoryType: CategoryType;
  totalAmount: number;
  count: number;
}

export interface MonthlyStat {
  month: string;
  income: number;
  expense: number;
  net: number;
  operations: number;
}

export interface FullReport {
  period: ReportPeriod;
  summary: ReportSummary;
  incomeBySource: IncomeBySource[];
  expensesByCategory: ExpenseByCategory[];
  monthlyStats: MonthlyStat[];
  transactions: Transaction[];
}