import * as XLSX from 'xlsx';
import type { TransactionFormData, ImportColumnMapping, ImportRow, ImportPreview } from './types';

export type { TransactionFormData, ImportColumnMapping, ImportRow, ImportPreview };

export const IMPORTABLE_FIELDS: { key: keyof TransactionFormData; label: string; required: boolean; example: string }[] = [
  { key: 'transaction_date', label: 'Дата операции', required: true, example: '15.01.2026' },
  { key: 'type', label: 'Тип (income/expense или Поступление/Расход)', required: true, example: 'income' },
  { key: 'amount', label: 'Сумма', required: true, example: '10000.50' },
  { key: 'currency', label: 'Валюта', required: false, example: 'RUB' },
  { key: 'description', label: 'Описание/Назначение', required: false, example: 'Оплата аренды' },
  { key: 'category_id', label: 'Категория (ID или название)', required: false, example: 'Пожертвования' },
  { key: 'sender_name', label: 'Отправитель', required: false, example: 'Иванов Иван' },
  { key: 'sender_bank', label: 'Банк отправителя', required: false, example: 'Сбербанк' },
  { key: 'sender_account_masked', label: 'Счёт отправителя', required: false, example: '****1234' },
  { key: 'recipient_name', label: 'Получатель', required: false, example: 'ООО Ромашка' },
  { key: 'recipient_bank', label: 'Банк получателя', required: false, example: 'Тинькофф' },
  { key: 'recipient_account_masked', label: 'Счёт получателя', required: false, example: '****5678' },
  { key: 'source_type', label: 'Источник (donation/grant/corporate/event/membership/other)', required: false, example: 'donation' },
  { key: 'comment', label: 'Комментарий', required: false, example: 'Внутренняя заметка' },
  { key: 'document_name', label: 'Название документа', required: false, example: 'Договор.pdf' },
  { key: 'document_status', label: 'Статус документа', required: false, example: 'attached' },
  { key: 'bank_transaction_id', label: 'ID банковской операции', required: false, example: 'BANK-2026-001' },
  { key: 'payment_method', label: 'Способ оплаты (transfer/cash)', required: false, example: 'transfer' },
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
  { value: 'transfer', label: 'Перевод' },
  { value: 'cash', label: 'Наличные' },
  { value: 'spisanie', label: 'Списание' },
];

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

function decodeBufferUtf8(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (/\uFFFD/.test(text) || (!/[\u0400-\u04FF]/.test(text) && /[ÐÑÃ]/.test(text))) {
    try { text = new TextDecoder('windows-1251').decode(bytes); } catch {}
  }
  return text;
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false });
  if (json.length === 0) return { headers: [], rows: [] };
  const headers = (json[0] as unknown[]).map(h => String(h ?? '').trim());
  const rows = (json.slice(1) as unknown[][]).map(row => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = String((row as any)?.[i] ?? '').trim(); });
    return obj;
  }).filter(r => Object.values(r).some(v => v !== ''));
  return { headers, rows };
}

export async function parseCsvText(text: string | ArrayBuffer): Promise<ParsedFile> {
  const raw = typeof text === 'string' ? (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) : decodeBufferUtf8(text);
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const first = lines[0];
  const comma = (first.match(/,/g) || []).length;
  const semi = (first.match(/;/g) || []).length;
  const delim = semi > comma ? ';' : ',';
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
      } else if (c === delim && !q) { out.push(cur.trim()); cur = ''; }
      else cur += c;
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
  }).filter(r => Object.values(r).some(v => v !== ''));
  return { headers, rows };
}

const FIELD_ALIASES: Record<string, keyof TransactionFormData> = {
  'date': 'transaction_date', 'дата': 'transaction_date', 'transaction date': 'transaction_date', 'transaction_date': 'transaction_date', 'operation date': 'transaction_date', 'дата операции': 'transaction_date',
  'type': 'type', 'тип': 'type', 'operation type': 'type', 'тип операции': 'type', 'вид': 'type', 'приход/расход': 'type',
  'amount': 'amount', 'сумма': 'amount', 'sum': 'amount', 'value': 'amount', 'сумма (rub)': 'amount', 'сумма(rub)': 'amount',
  'currency': 'currency', 'валюта': 'currency', 'curr': 'currency',
  'description': 'description', 'описание': 'description', 'назначение': 'description', 'purpose': 'description', 'memo': 'description', 'наименование': 'description',
  'category': 'category_id', 'категория': 'category_id', 'category_id': 'category_id', 'category id': 'category_id',
  'sender_name': 'sender_name', 'sender name': 'sender_name', 'от кого': 'sender_name', 'отправитель': 'sender_name', 'плательщик': 'sender_name', 'donor': 'sender_name', 'донор': 'sender_name', 'контрагент': 'sender_name',
  'sender_bank': 'sender_bank', 'sender bank': 'sender_bank', 'банк отправителя': 'sender_bank',
  'sender_account': 'sender_account_masked', 'sender account': 'sender_account_masked', 'sender_account_masked': 'sender_account_masked', 'счёт отправителя': 'sender_account_masked', 'счет отправителя': 'sender_account_masked',
  'recipient_name': 'recipient_name', 'recipient name': 'recipient_name', 'кому': 'recipient_name', 'получатель': 'recipient_name',
  'recipient_bank': 'recipient_bank', 'recipient bank': 'recipient_bank', 'банк получателя': 'recipient_bank',
  'recipient_account': 'recipient_account_masked', 'recipient account': 'recipient_account_masked', 'recipient_account_masked': 'recipient_account_masked', 'счёт получателя': 'recipient_account_masked', 'счет получателя': 'recipient_account_masked',
  'source_type': 'source_type', 'source': 'source_type', 'источник': 'source_type', 'source type': 'source_type',
  'bank_transaction_id': 'bank_transaction_id', 'bank id': 'bank_transaction_id', 'id операции': 'bank_transaction_id', 'transaction id': 'bank_transaction_id', 'reference': 'bank_transaction_id', 'ref': 'bank_transaction_id',
  'payment_method': 'payment_method', 'payment method': 'payment_method', 'способ оплаты': 'payment_method', 'method': 'payment_method', 'источник поступления': 'payment_method',
  'comment': 'comment', 'комментарий': 'comment', 'note': 'comment', 'notes': 'comment',
  'document_name': 'document_name', 'document': 'document_name', 'документ': 'document_name', 'document_status': 'document_status', 'статус документа': 'document_status',
};

function normalizeHeaderKey(h: string): string {
  return h.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function autoMapHeaders(headers: string[]): ImportColumnMapping[] {
  return headers.map(h => {
    const n = normalizeHeaderKey(h);
    const nNoParen = n.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const target = FIELD_ALIASES[n] || FIELD_ALIASES[nNoParen] || FIELD_ALIASES[n.replace(/[()]/g, '').trim()] || 'ignore';
    return { sourceColumn: h, targetField: target };
  });
}

function normalizeDate(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = (XLSX.SSF as any)?.parse_date_code ? (XLSX.SSF as any).parse_date_code(value) : null;
    if (d && d.y && d.m && d.d) {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
    }
  }
  const s = String(value).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (dmy) {
    const pad = (n: string) => n.padStart(2, '0');
    let year = dmy[3];
    if (year.length === 2) {
      const yy = Number(year);
      year = String(yy >= 70 ? 1900 + yy : 2000 + yy);
    }
    const date = `${year}-${pad(dmy[2])}-${pad(dmy[1])}`;
    if (dmy[4] != null && dmy[5] != null) return `${date}T${pad(dmy[4])}:${dmy[5]}`;
    return date;
  }
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  }
  return s;
}

function normalizeType(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim().toLowerCase();
  if (!s) return null;
  if (s === 'income' || s === 'expense') return s;
  if (['приход', 'поступление', 'поступления', 'получение', 'доход', 'доходы', 'приходы', 'зачисление'].includes(s)) return 'income';
  if (['расход', 'расходы', 'списание', 'списания', 'трата', 'траты', 'выплата', 'оплата'].includes(s)) return 'expense';
  return s;
}

function normalizePaymentMethod(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim().toLowerCase();
  if (!s) return undefined;
  if (s === 'transfer' || s === 'cash' || s === 'spisanie') return s;
  if (['перевод', 'безнал', 'безналичный', 'безналичный перевод', 'банковский перевод', 'банк', 'карта', 'по карте', 'эквайринг', 'онлайн'].includes(s)) return 'transfer';
  if (['наличные', 'наличка', 'кэш', 'cash', 'в руки', 'нал', 'наличными'].includes(s)) return 'cash';
  if (['списание', 'списания', 'spisanie'].includes(s)) return 'spisanie';
  return String(value).trim();
}

function normalizeSourceType(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim().toLowerCase();
  if (!s) return undefined;
  const direct = SOURCE_TYPE_OPTIONS.find(o => o.value === s);
  if (direct) return direct.value;
  const byLabel = SOURCE_TYPE_OPTIONS.find(o => o.label.toLowerCase() === s);
  if (byLabel) return byLabel.value;
  if (['пожертвование', 'пожертвования', 'донат', 'частное пожертвование'].includes(s)) return 'donation';
  if (['грант', 'гранты'].includes(s)) return 'grant';
  if (['корпоративный', 'корпоративный взнос', 'корпоративные взносы'].includes(s)) return 'corporate';
  if (['мероприятие', 'мероприятия', 'ивент'].includes(s)) return 'event';
  if (['членский', 'членские взносы', 'членство'].includes(s)) return 'membership';
  if (['прочее', 'другое', 'иное'].includes(s)) return 'other';
  return String(value).trim();
}

function normalizeAmount(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value);
  const raw = String(value).trim();
  if (!raw) return null;
  let cleaned = raw.replace(/[\s\u00A0]/g, '').replace(/[^\d,.\-+]/g, '');
  if (!cleaned) return null;
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  if (hasComma && hasDot) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = cleaned.split(',');
    if (parts.length === 2) cleaned = parts[0] + '.' + parts[1];
    else cleaned = cleaned.replace(/,/g, '');
  }
  const num = parseFloat(cleaned);
  if (!Number.isFinite(num) || num === 0) return null;
  return Math.abs(num);
}

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
    if (value !== undefined && value !== '') (mapped as any)[m.targetField] = value;
  });

  if (!mapped.transaction_date) errors.push('Отсутствует дата операции');
  else {
    const nd = normalizeDate(mapped.transaction_date);
    if (!nd || !/^\d{4}-\d{2}-\d{2}/.test(nd)) errors.push('Формат даты должен быть YYYY-MM-DD или ДД.ММ.ГГГГ');
    else mapped.transaction_date = nd;
  }

  if (!mapped.type) {
    errors.push('Отсутствует тип операции');
  } else {
    const nt = normalizeType(mapped.type);
    if (!nt || !['income', 'expense'].includes(nt)) {
      errors.push('Тип должен быть income/expense (или Поступление/Расход/Получение)');
    } else {
      mapped.type = nt as any;
    }
  }

  if (mapped.amount == null || mapped.amount === ('' as any)) {
    errors.push('Отсутствует сумма');
  } else {
    const num = normalizeAmount(mapped.amount);
    if (num == null) {
      errors.push('Некорректная сумма');
    } else {
      mapped.amount = num;
    }
  }

  if (mapped.currency) {
    const cur = String(mapped.currency).trim().toUpperCase().replace(/[^A-Z]/g, '');
    mapped.currency = cur || 'RUB';
  } else {
    (mapped as any).currency = 'RUB';
  }

  if (mapped.category_id) {
    const rawCat = String(mapped.category_id).trim();
    const cat = categories.find(c => c.id === rawCat || c.name.toLowerCase() === rawCat.toLowerCase());
    if (cat) mapped.category_id = cat.id;
    else {
      warnings.push(`Категория «${rawCat}» не найдена — будет без категории`);
      mapped.category_id = null as any;
    }
  }

  if (mapped.source_type) {
    const rawSrc = String(mapped.source_type).trim();
    const ns = normalizeSourceType(rawSrc);
    if (ns && SOURCE_TYPE_OPTIONS.some(o => o.value === ns)) {
      mapped.source_type = ns as any;
    } else {
      const pm = normalizePaymentMethod(rawSrc);
      if (pm && PAYMENT_METHOD_OPTIONS.some(o => o.value === pm)) {
        if (!mapped.payment_method) mapped.payment_method = pm as any;
        mapped.source_type = null as any;
      } else {
        mapped.source_type = null as any;
      }
    }
  }

  if (mapped.payment_method) {
    const np = normalizePaymentMethod(mapped.payment_method);
    if (np && PAYMENT_METHOD_OPTIONS.some(o => o.value === np)) mapped.payment_method = np as any;
    else mapped.payment_method = null as any;
  }

  if (mapped.document_status) {
    const ds = String(mapped.document_status).trim().toLowerCase();
    if (['attached', 'missing', 'expected'].includes(ds)) mapped.document_status = ds as any;
    else if (['есть', 'приложен', 'да'].includes(ds)) mapped.document_status = 'attached' as any;
    else if (['ожидается', 'ожидается документ'].includes(ds)) mapped.document_status = 'expected' as any;
    else mapped.document_status = 'missing' as any;
  }

  if (!mapped.description) mapped.description = '';

  return { raw: row, mapped: mapped as TransactionFormData, validation: { isValid: errors.length === 0, errors, warnings }, isDuplicate: false };
}

export function detectDuplicates(rows: ImportRow[], existingBankIds: Set<string>): ImportRow[] {
  return rows.map(row => {
    const bankId = row.mapped.bank_transaction_id;
    if (bankId && existingBankIds.has(String(bankId))) {
      return { ...row, isDuplicate: true, validation: { ...row.validation, warnings: [...row.validation.warnings, 'Возможный дубликат (bank_transaction_id уже существует)'] } };
    }
    return row;
  });
}

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

export const CSV_TEMPLATE = `transaction_date,type,amount,currency,description,category_id,sender_name,sender_bank,sender_account_masked,recipient_name,recipient_bank,recipient_account_masked,source_type,comment,bank_transaction_id,payment_method
15.01.2026,income,10000,RUB,Пожертвование,,Иванов Иван,Сбербанк,****1234,,,,donation,,BANK-001,transfer
16.01.2026,expense,5000,RUB,Оплата аренды,,,,,ООО Ромашка,Тинькофф,****5678,other,,BANK-002,transfer
17.01.2026,Поступление,25000,RUB,Грант,,Фонд Помощи,ВТБ,****9999,,,,grant,,BANK-003,transfer`;

export function downloadTemplate(filename = 'import-template.csv') {
  const blob = new Blob(['\uFEFF' + CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
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
  const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
