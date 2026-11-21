import * as XLSX from 'xlsx';
import type { TransactionFormData, ImportColumnMapping, ImportRow, ImportPreview } from './types';

// Re-export types for convenience
export type { TransactionFormData, ImportColumnMapping, ImportRow, ImportPreview };

// ═══════════════════════════════════════════════════════════════
// SUPPORTED FIELDS FOR MAPPING
// ═══════════════════════════════════════════════════════════════
export const IMPORTABLE_FIELDS: { key: keyof TransactionFormData; label: string; required: boolean; example: string }[] = [
  { key: 'transaction_date', label: 'Дата операции', required: true, example: '2026-01-15' },
  { key: 'type', label: 'Тип (income/expense)', required: true, example: 'income' },
  { key: 'amount', label: 'Сумма', required: true, example: '10000.50' },
  { key: 'currency', label: 'Валюта', required: false, example: 'RUB' },
  { key: 'description', label: 'Описание/Назначение', required: false, example: 'Оплата аренды' },
  { key: 'category_id', label: 'ID категории', required: false, example: 'cat-123' },
  { key: 'sender_name', label: 'Имя отправителя', required: false, example: 'Иванов Иван' },
  { key: 'sender_bank', label: 'Банк отправителя', required: false, example: 'Сбербанк' },
  { key: 'sender_account_masked', label: 'Счёт отправителя (маскированный)', required: false, example: '****1234' },
  { key: 'recipient_name', label: 'Имя получателя', required: false, example: 'ООО Ромашка' },
  { key: 'recipient_bank', label: 'Банк получателя', required: false, example: 'Тинькофф' },
  { key: 'recipient_account_masked', label: 'Счёт получателя (маскированный)', required: false, example: '****5678' },
  { key: 'source_type', label: 'Источник (donation/grant/corporate/event/membership/other)', required: false, example: 'donation' },
  { key: 'comment', label: 'Комментарий', required: false, example: 'Внутренняя заметка' },
  { key: 'document_name', label: 'Название документа', required: false, example: 'Договор.pdf' },
  { key: 'document_status', label: 'Статус документа', required: false, example: 'attached' },
  { key: 'bank_transaction_id', label: 'ID банковской операции', required: false, example: 'BANK-2026-001' },
  { key: 'payment_method', label: 'Способ оплаты (bank_transfer/cash/card/online/crypto/other)', required: false, example: 'bank_transfer' },
];

export const SOURCE_TYPE_OPTIONS = [
  { value: 'donation', label: 'Пожертвование' },
  { value: 'grant', label: 'Грант' },
  { value: 'corporate', label: 'Корпоративный взнос' },
  { value: 'event', label: 'Мероприятие' },
  { value: 'membership', label: 'Членские взносы' },
  { value: 'other', label: 'Другое' },
];

export const PAYMENT_METHOD_OPTIONS = [
  { value: 'bank_transfer', label: 'Банковский перевод' },
  { value: 'cash', label: 'Наличные' },
  { value: 'card', label: 'Карта' },
  { value: 'online', label: 'Онлайн' },
  { value: 'crypto', label: 'Криптовалюта' },
  { value: 'other', label: 'Другое' },
];

// ═══════════════════════════════════════════════════════════════
// FILE PARSING
// ═══════════════════════════════════════════════════════════════
export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  if (json.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = (json[0] as string[]).map(h => String(h).trim());
  const rows = (json.slice(1) as string[][]).map(row => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = String(row[i] || '').trim();
    });
    return obj;
  });

  return { headers, rows };
}

export async function parseCsvText(text: string): Promise<ParsedFile> {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          q = !q;
        }
      } else if (c === ',' && !q) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const headers = parseLine(lines[0]).map((h, i) => h || `col${i + 1}`);
  const rows = lines.slice(1).map(l => {
    const cells = parseLine(l);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ''));
    return row;
  });

  return { headers, rows };
}

// ═══════════════════════════════════════════════════════════════
// AUTO-MAPPING HELPERS
// ═══════════════════════════════════════════════════════════════
const FIELD_ALIASES: Record<string, keyof TransactionFormData> = {
  // Дата
  'date': 'transaction_date',
  'дата': 'transaction_date',
  'transaction date': 'transaction_date',
  'operation date': 'transaction_date',

  // Тип
  'type': 'type',
  'тип': 'type',
  'operation type': 'type',

  // Сумма
  'amount': 'amount',
  'сумма': 'amount',
  'sum': 'amount',
  'value': 'amount',

  // Валюта
  'currency': 'currency',
  'валюта': 'currency',
  'curr': 'currency',

  // Описание
  'description': 'description',
  'описание': 'description',
  'назначение': 'description',
  'purpose': 'description',
  'memo': 'description',

  // Категория
  'category': 'category_id',
  'категория': 'category_id',
  'category id': 'category_id',

  // Отправитель
  'sender_name': 'sender_name',
  'sender name': 'sender_name',
  'от кого': 'sender_name',
  'плательщик': 'sender_name',
  'donor': 'sender_name',
  'подарок от': 'sender_name',
  'sender_bank': 'sender_bank',
  'sender bank': 'sender_bank',
  'банк отправителя': 'sender_bank',
  'sender_account': 'sender_account_masked',
  'sender account': 'sender_account_masked',
  'счёт отправителя': 'sender_account_masked',
  'account sender': 'sender_account_masked',

  // Получатель
  'recipient_name': 'recipient_name',
  'recipient name': 'recipient_name',
  'кому': 'recipient_name',
  'получатель': 'recipient_name',
  'recipient_bank': 'recipient_bank',
  'recipient bank': 'recipient_bank',
  'банк получателя': 'recipient_bank',
  'recipient_account': 'recipient_account_masked',
  'recipient account': 'recipient_account_masked',
  'счёт получателя': 'recipient_account_masked',

  // Источник
  'source_type': 'source_type',
  'source': 'source_type',
  'источник': 'source_type',
  'source type': 'source_type',

  // Банковский ID
  'bank_transaction_id': 'bank_transaction_id',
  'bank id': 'bank_transaction_id',
  'id операции': 'bank_transaction_id',
  'transaction id': 'bank_transaction_id',
  'reference': 'bank_transaction_id',
  'ref': 'bank_transaction_id',

  // Способ оплаты
  'payment_method': 'payment_method',
  'payment method': 'payment_method',
  'способ оплаты': 'payment_method',
  'method': 'payment_method',

  // Комментарий
  'comment': 'comment',
  'комментарий': 'comment',
  'note': 'comment',
  'notes': 'comment',

  // Документ
  'document_name': 'document_name',
  'document': 'document_name',
  'документ': 'document_name',
};

export function autoMapHeaders(headers: string[]): ImportColumnMapping[] {
  return headers.map(h => {
    const normalized = h.toLowerCase().trim();
    const target = FIELD_ALIASES[normalized] || 'ignore';
    return { sourceColumn: h, targetField: target };
  });
}

// ═══════════════════════════════════════════════════════════════
// ROW VALIDATION & MAPPING
// ═══════════════════════════════════════════════════════════════
export function mapRowToTransaction(
  row: Record<string, string>,
  mapping: ImportColumnMapping[],
  categories: { id: string; name: string }[]
): ImportRow {
  const mapped: Partial<TransactionFormData> = {};
  const errors: string[] = [];
  const warnings: string[] = [];

  mapping.forEach(m => {
    if (m.targetField === 'ignore') return;
    const value = row[m.sourceColumn];
    if (value !== undefined && value !== '') {
      (mapped as any)[m.targetField] = value;
    }
  });

  // Валидация обязательных полей
  if (!mapped.transaction_date) errors.push('Отсутствует дата операции');
  else if (!/^\d{4}-\d{2}-\d{2}/.test(mapped.transaction_date)) {
    warnings.push('Формат даты должен быть YYYY-MM-DD');
  }

  if (!mapped.type) errors.push('Отсутствует тип операции');
  else if (!['income', 'expense'].includes(mapped.type)) {
    errors.push('Тип должен быть income или expense');
  }

  if (!mapped.amount) errors.push('Отсутствует сумма');
  else {
    const num = parseFloat(String(mapped.amount).replace(/\s/g, '').replace(',', '.'));
    if (isNaN(num) || num <= 0) errors.push('Некорректная сумма');
    else mapped.amount = num;
  }

  if (mapped.currency && !/^[A-Z]{3}$/.test(mapped.currency)) {
    warnings.push('Валюта должна быть 3-буквенным кодом (RUB, USD, EUR)');
  }

  if (mapped.category_id) {
    const cat = categories.find(c => c.id === mapped.category_id || c.name === mapped.category_id);
    if (!cat) warnings.push('Категория не найдена, будет использована без категории');
    else mapped.category_id = cat.id;
  }

  if (mapped.source_type && !SOURCE_TYPE_OPTIONS.some(o => o.value === mapped.source_type)) {
    warnings.push(`Неизвестный источник: ${mapped.source_type}`);
  }

  if (mapped.payment_method && !PAYMENT_METHOD_OPTIONS.some(o => o.value === mapped.payment_method)) {
    warnings.push(`Неизвестный способ оплаты: ${mapped.payment_method}`);
  }

  if (mapped.document_status && !['attached', 'missing', 'expected'].includes(mapped.document_status)) {
    warnings.push('Статус документа должен быть: attached, missing или expected');
  }

  return {
    raw: row,
    mapped: mapped as TransactionFormData,
    validation: {
      isValid: errors.length === 0,
      errors,
      warnings,
    },
    isDuplicate: false,
  };
}

export function detectDuplicates(
  rows: ImportRow[],
  existingBankIds: Set<string>
): ImportRow[] {
  return rows.map(row => {
    const bankId = row.mapped.bank_transaction_id;
    if (bankId && existingBankIds.has(bankId)) {
      return { ...row, isDuplicate: true, validation: { ...row.validation, warnings: [...row.validation.warnings, 'Возможный дубликат (bank_transaction_id уже существует)'] } };
    }
    return row;
  });
}

// ═══════════════════════════════════════════════════════════════
// CREATE IMPORT PREVIEW
// ═══════════════════════════════════════════════════════════════
export function createImportPreview(
  parsed: ParsedFile,
  mapping: ImportColumnMapping[],
  categories: { id: string; name: string }[],
  existingBankIds: Set<string>
): ImportPreview {
  const rows = parsed.rows.map(r => mapRowToTransaction(r, mapping, categories));
  const rowsWithDupes = detectDuplicates(rows, existingBankIds);

  return {
    headers: parsed.headers,
    rows: rowsWithDupes,
    totalRows: rowsWithDupes.length,
    validRows: rowsWithDupes.filter(r => r.validation.isValid && !r.isDuplicate).length,
    duplicateRows: rowsWithDupes.filter(r => r.isDuplicate).length,
    errorRows: rowsWithDupes.filter(r => !r.validation.isValid).length,
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORT TEMPLATE
// ═══════════════════════════════════════════════════════════════
export const CSV_TEMPLATE = `date,type,amount,currency,description,category_id,sender_name,sender_bank,sender_account_masked,recipient_name,recipient_bank,recipient_account_masked,source_type,comment,bank_transaction_id,payment_method
2026-01-15,income,10000,RUB,Пожертвование,cat-donation,Иванов Иван,Сбербанк,****1234,,,
2026-01-16,expense,5000,RUB,Оплата аренды,cat-office,,,,ООО Ромашка,Тинькофф,****5678,,,BANK-001,bank_transfer
2026-01-17,income,25000,RUB,Грант,cat-grant,Фонд Помощи,ВТБ,****9999,,,,grant,,BANK-002,bank_transfer`;

export function downloadTemplate(filename = 'import-template.csv') {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportToCsv(transactions: TransactionFormData[], filename = 'transactions-export.csv') {
  const headers = IMPORTABLE_FIELDS.map(f => f.key);
  const rows = transactions.map(t => headers.map(h => {
    const val = (t as any)[h];
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  }));

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}