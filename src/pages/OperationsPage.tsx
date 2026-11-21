import { memo, useState, useMemo, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Search, Upload, FileSpreadsheet, Download, X, Check, AlertCircle, ChevronDown, Eye, FileText, Settings, ArrowLeft, ArrowRight, Copy, ExternalLink, CheckCircle, RefreshCw } from 'lucide-react'
import { useApp } from '@/lib/appStore'
import { formatCurrency, formatDate } from '@/lib/format'
import { Select } from '@/components/ui/Select'
import { Modal, Field, inputCls } from '@/components/ui/Modal'
import DocumentManager from '@/components/ui/DocumentManager'
import { parseFile, parseCsvText, autoMapHeaders, createImportPreview, downloadTemplate, mapRowToTransaction, type ParsedFile, type ImportColumnMapping, type ImportPreview, type ImportRow, IMPORTABLE_FIELDS, SOURCE_TYPE_OPTIONS, PAYMENT_METHOD_OPTIONS } from '@/lib/importUtils'
import { getTransactions, createTransaction, updateTransaction, deleteTransaction, deleteAllTransactions, bulkCreateTransactions, getCategories, checkDuplicateTransactions } from '@/lib/dataService'
import { supabase, getCurrentFundId } from '@/lib/supabase'
import type { Transaction, TransactionFormData, DocumentStatus, Category, TxType } from '@/lib/types'

type Tab = 'list' | 'add' | 'import'
type SortDir = 'asc' | 'desc'

const emptyForm = (): TransactionFormData => ({
  transaction_date: new Date().toLocaleString('sv-SE', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).slice(0, 16).replace(' ', 'T'),
  type: 'income',
  amount: 0,
  currency: 'RUB',
  description: '',
  category_id: null,
  sender_name: '',
  sender_bank: '',
  sender_account_masked: '',
  recipient_name: '',
  recipient_bank: '',
  recipient_account_masked: '',
  source_type: null,
  comment: '',
  document_name: '',
  document_path: '',
  document_status: 'missing',
  bank_transaction_id: '',
  payment_method: null,
  is_public: true,
})

function parseAmount(val: string): number {
  return Number(String(val).replace(/\s/g, '').replace(',', '.'))
}

interface AddTabProps {
  addForm: TransactionFormData
  setAddForm: React.Dispatch<React.SetStateAction<TransactionFormData>>
  addErrors: Record<string, boolean>
  setAddErrors: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  categories: Category[]
  handleAddSubmit: () => void
  handleAddAndAnother: () => void
  validateForm: () => boolean
  t: ReturnType<typeof import('@/lib/appStore').useApp>['t']
  saving?: boolean
  feedback?: { type: 'success' | 'error'; text: string } | null
}

function AddTab({
  addForm,
  setAddForm,
  addErrors,
  setAddErrors,
  categories,
  handleAddSubmit,
  handleAddAndAnother,
  validateForm,
  t,
  saving = false,
  feedback = null,
}: AddTabProps) {
  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="text-center py-4">
        <div className="text-sm font-medium text-text">{t.addTab}</div>
        <div className="mt-1 text-sm text-muted">{t.operationsSub}</div>
      </div>

      {feedback && feedback.type === 'success' && (
        <div className="rounded-xl border border-accent/30 bg-accent/10 p-8 text-center space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="mx-auto flex items-center justify-center w-16 h-16 rounded-full bg-accent/20 text-accent">
            <CheckCircle size={32} />
          </div>
          <div className="text-lg font-medium text-text">{feedback.text}</div>
          <div className="text-sm text-muted">Запись добавлена в таблицу операций</div>
        </div>
      )}

      {(!feedback || feedback.type !== 'success') && (
        <div className="rounded-xl border border-border/70 bg-card/30 p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAddForm((f) => ({ ...f, type: 'income' }))}
              className={`rounded-xl border p-3 text-sm font-medium transition ${
                addForm.type === 'income'
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border bg-cardAlt/50 text-muted hover:text-text hover:border-border/80'
              }`}
            >
              <div className="flex items-center justify-center gap-2"><span className="text-xl">+</span> {t.incomeLabel}</div>
            </button>
            <button
              type="button"
              onClick={() => setAddForm((f) => ({ ...f, type: 'expense' }))}
              className={`rounded-xl border p-3 text-sm font-medium transition ${
                addForm.type === 'expense'
                  ? 'border-red-500/40 bg-red-500/10 text-red-400'
                  : 'border-border bg-cardAlt/50 text-muted hover:text-text hover:border-border/80'
              }`}
            >
              <div className="flex items-center justify-center gap-2"><span className="text-xl">−</span> {t.expenseLabel}</div>
            </button>
          </div>

          {/* Category (purpose) */}
          <Field label={t.category}>
            <Select
              value={addForm.category_id || ''}
              options={[{ value: '', label: 'Не выбрана категория' }, ...categories
                .filter(c => c.type === addForm.type && c.is_active)
                .filter((c, i, arr) => arr.findIndex(x => x.name === c.name && x.type === c.type) === i)
                .map(c => ({ value: c.id, label: c.name }))]}
              onChange={(v) => setAddForm((f) => ({ ...f, category_id: v || null }))}
              ariaLabel={t.category}
              className={addErrors.category_id ? 'border-red-500/50' : ''}
            />
            {categories.filter(c => c.type === addForm.type && c.is_active).length === 0 && (
              <div className="mt-1 text-xs text-muted">
Категория не выбрана — создайте первую в разделе <span className="text-accent">Настройки</span>
              </div>
            )}
            {addErrors.category_id && <div className="mt-1 text-xs text-red-400">{t.categoryRequired}</div>}
            <div className="mt-1 text-xs text-muted">
              {addForm.type === 'expense'
                ? 'Категория расхода выбрана. Ниже укажите, кому перечислить деньги.'
                : 'Категория прихода выбрана. Ниже укажите, от кого поступили деньги.'}
            </div>
          </Field>

          {/* Recipient / Donor */}
          <Field label={addForm.type === 'income' ? 'От кого' : 'Кому'}>
            <input
              value={addForm.type === 'income' ? addForm.sender_name : addForm.recipient_name}
              onChange={(e) => setAddForm((f) => ({
                ...f,
                [addForm.type === 'income' ? 'sender_name' : 'recipient_name']: e.target.value
              }))}
              className={inputCls}
              placeholder={addForm.type === 'income' ? 'ФИО или организация (можно оставить пустым)' : 'ФИО или организация (можно оставить пустым)'}
            />
            <div className="mt-1 text-xs text-muted">Необязательно — можно не указывать конкретное имя</div>
          </Field>

          {/* Amount & Currency */}
          <div className="grid grid-cols-2 gap-2">
            <Field label={t.amount}>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={addForm.amount || ''}
                onChange={(e) => setAddForm((f) => ({ ...f, amount: parseAmount(e.target.value) }))}
                className={`${inputCls} ${addErrors.amount ? 'border-red-500/50' : ''}`}
                placeholder="0.00"
              />
              {addErrors.amount && <div className="mt-1 text-xs text-red-400">{t.amountRequired}</div>}
            </Field>
            <Field label={t.currency}>
              <Select value={addForm.currency} options={[
                { value: 'RUB', label: 'RUB (₽)' },
                { value: 'USD', label: 'USD ($)' },
                { value: 'EUR', label: 'EUR (€)' },
              ]} onChange={(v) => setAddForm((f) => ({ ...f, currency: v }))} />
            </Field>
          </div>

          {/* Date */}
          <Field label={t.date}>
            <input
              type="datetime-local"
              value={addForm.transaction_date}
              onChange={(e) => setAddForm((f) => ({ ...f, transaction_date: e.target.value }))}
              className={inputCls}
            />
          </Field>

          {/* Description - purpose */}
          <Field label={t.description}>
            <textarea
              value={addForm.description}
              onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
              className={inputCls}
              rows={2}
placeholder={addForm.type === 'income' ? 'Назначение прихода (например, «Пожертвование»)' : 'Назначение расхода (например, «Оплата аренды»)'}
            />
          </Field>

          {/* Payment method */}
          <Field label="Способ оплаты">
            <Select
              value={addForm.payment_method || ''}
              options={[{ value: '', label: 'Не указан' }, ...PAYMENT_METHOD_OPTIONS]}
              onChange={(v) => setAddForm((f) => ({ ...f, payment_method: (v || null) as any }))}
            />
          </Field>

          {feedback && (
            <div
              className={`rounded-xl border px-3 py-2 text-sm ${
                feedback.type === 'success'
                  ? 'border-accent/30 bg-accent/10 text-accent'
                  : 'border-red-500/30 bg-red-500/10 text-red-400'
              }`}
            >
              {feedback.text}
            </div>
          )}

          {Object.keys(addErrors).length > 0 && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
Заполните обязательные поля: категория, сумма и дата.
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2 justify-end">
            <button
              type="button"
              onClick={handleAddAndAnother}
              disabled={saving}
              className="rounded-xl border border-border bg-cardAlt/60 px-4 py-2.5 text-sm font-medium text-muted transition hover:text-text hover:border-border/80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
{saving ? 'Сохранение...' : t.saveAndAddAnother}
            </button>
            <button
              type="button"
              onClick={handleAddSubmit}
              disabled={saving}
              className="rounded-xl border border-accent/30 bg-accent/15 px-4 py-2.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
{saving ? 'Сохранение...' : t.save}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

type VirtualOpsTableProps = {
  filtered: Transaction[]
  allCount: number
  loading: boolean
  t: any
  locale: string
  currency: string
  sortCol: keyof Transaction
  sortDir: SortDir
  onSort: (col: keyof Transaction) => void
  categoryMap: Map<string, string>
  sourceLabelMap: Map<string, string>
  paymentLabelMap: Map<string, string>
  onSelectRow: (r: Transaction) => void
  onTogglePublic: (id: string, current: boolean) => void
  onDelete: (id: string) => void
  filteredBalance: number
  activeTab: Tab
  page: number
  pageSize: number
  onPageChange: (p: number) => void
  onPageSizeChange: (s: number) => void
}

const VirtualOpsTable = memo(function VirtualOpsTable({
  filtered, allCount, loading, t, locale, currency, sortCol, sortDir, onSort,
  categoryMap, sourceLabelMap, paymentLabelMap, onSelectRow, onTogglePublic, onDelete, filteredBalance, activeTab,
  page, pageSize, onPageChange, onPageSizeChange,
}: VirtualOpsTableProps) {
  const totalItems = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const startIndex = (safePage - 1) * pageSize
  const pageRows = useMemo(() => filtered.slice(startIndex, startIndex + pageSize), [filtered, startIndex, pageSize])

  // Пагинация номеров страниц как на публичном сайте (до 7 кнопок с центрированием вокруг текущей)
  const paginationPages = useMemo(() => {
    const maxButtons = 7
    let startP = Math.max(1, safePage - 3)
    let endP = Math.min(totalPages, startP + maxButtons - 1)
    startP = Math.max(1, endP - maxButtons + 1)
    const list: number[] = []
    for (let p = startP; p <= endP; p++) list.push(p)
    return list
  }, [safePage, totalPages])

  return (
    <>
      <div className="rounded-xl border border-border/70 bg-card/20 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] border-collapse text-[13px] leading-5">
            <thead className="bg-card/95 text-left text-xs text-muted shadow-[0_1px_0_0_rgba(255,255,255,0.06)]">
              <tr>
                {([
                  { key: 'transaction_date', label: t.date },
                  { key: 'type', label: t.type },
                  { key: 'category_id', label: t.category },
                  { key: 'description', label: t.description },
                  { key: 'sender_name', label: 'Отправитель' },
                  { key: 'source_type', label: 'Источник поступления' },
                  { key: 'amount', label: `${t.amount} (${currency})` },
                  { key: 'payment_method', label: 'Способ оплаты' },
                ] as const).map((col) => (
                  <th key={col.key} className="border-b border-border/60 px-3 py-2.5 font-medium cursor-pointer hover:text-text select-none" onClick={() => onSort(col.key as keyof Transaction)}>
                    <div className="flex items-center gap-1">
                      {col.label}
                      {sortCol === col.key && (<ChevronDown size={12} className={sortDir === 'asc' ? 'rotate-180' : ''} />)}
                    </div>
                  </th>
                ))}
                <th className="w-16 border-b border-border/60 px-2 py-2.5 text-center"><Eye size={14} className="text-muted mx-auto" /></th>
                <th className="w-12 border-b border-border/60 px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-muted">{t.empty}</td></tr>
              ) : (
                pageRows.map((r, i) => {
                  const catName = categoryMap.get(r.category_id || '') || r.category_id || '—'
                  const sourceLabel = r.source_type ? (sourceLabelMap.get(r.source_type) || r.source_type) : ''
                  const paymentLabel = r.payment_method ? (paymentLabelMap.get(r.payment_method) || r.payment_method) : ''
                  return (
                    <tr key={r.id} className={`group cursor-pointer hover:bg-white/[0.04] ${i % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]'}`} onClick={() => onSelectRow(r)}>
                      <td className="border-b border-border/40 px-3 py-3 text-text/90 tabular-nums">{formatDate(r.transaction_date, locale)}{r.transaction_date.includes('T') ? `, ${r.transaction_date.slice(11, 16)}` : ''}</td>
                      <td className="border-b border-border/40 px-3 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${r.type === 'income' ? 'bg-accent/12 text-accent/95' : 'bg-red-500/12 text-red-400/95'}`}>
                          {r.type === 'income' ? '▲' : '▼'} {r.type === 'income' ? t.incomeLabel : t.expenseLabel}
                        </span>
                      </td>
                      <td className="border-b border-border/40 px-3 py-3 text-muted">{catName || '—'}</td>
                      <td className="border-b border-border/40 px-3 py-3 text-text/85 truncate max-w-xs" title={r.description || ''}>{r.description || '—'}</td>
                      <td className="border-b border-border/40 px-3 py-3 text-muted truncate max-w-xs" title={(r.sender_name || r.recipient_name || '') as string}>{r.sender_name || r.recipient_name || '—'}</td>
                      <td className="border-b border-border/40 px-3 py-3 text-muted">
                        {sourceLabel && (<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-500/10 text-blue-400/90">{sourceLabel}</span>)}
                      </td>
                      <td className="border-b border-border/40 px-3 py-3 text-right font-medium tabular-nums text-text/90">{r.type === 'income' ? '+' : '-'}{formatCurrency(r.amount, currency, locale)}</td>
                      <td className="border-b border-border/40 px-3 py-3 text-center text-muted">
                        {paymentLabel && (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${r.payment_method === 'spisanie' ? 'bg-red-500/12 text-red-400/95' : 'bg-blue-500/10 text-blue-400/90'}`}>{paymentLabel}</span>
                        )}
                      </td>
                      <td className="border-b border-border/40 px-2 py-3 text-center">
                          <button type="button" onClick={(e) => { e.stopPropagation(); onTogglePublic(r.id, r.is_public) }} className={`relative inline-flex h-5 w-9 items-center rounded-full ${r.is_public ? 'bg-accent' : 'bg-border'}`} aria-checked={r.is_public} role="switch" aria-label="Показывать на публичной странице">
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white ${r.is_public ? 'translate-x-5' : 'translate-x-1'}`} />
                        </button>
                      </td>
                      <td className="border-b border-border/40 px-2 py-3 text-center">
                        <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(r.id) }} className="rounded p-1.5 text-muted/70 hover:bg-cardAlt hover:text-text" aria-label={t.delete}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Панель сводки + пагинация (как на публичном сайте) */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted pt-1">
        <div className="flex flex-wrap items-center gap-3">
          <div>{t.balancePeriod}: <span className="font-medium text-text tabular-nums">{formatCurrency(filteredBalance, currency, locale)}</span></div>
          <span className="text-border">•</span>
          <div>
            Показано {totalItems === 0 ? 0 : `${startIndex + 1}–${Math.min(startIndex + pageSize, totalItems)}`} из {totalItems}
            {totalItems !== allCount ? ` (всего в базе ${allCount})` : ''}
            {loading ? ' · загрузка…' : ''}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Выбор количества строк на страницу */}
          <div className="flex items-center gap-1.5 mr-2">
            <span className="text-[11px] text-muted">Строк:</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value) || 25)}
              className="rounded-lg border border-border bg-cardAlt/60 px-2 py-1 text-xs text-text outline-none focus:border-accent/50 cursor-pointer"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          {/* Кнопки переключения страниц как на сайте */}
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onPageChange(Math.max(1, safePage - 1))}
                disabled={safePage <= 1}
                className="rounded-lg border border-border bg-cardAlt/60 px-2.5 py-1 text-xs text-text transition hover:bg-cardAlt hover:border-border/80 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Назад"
              >
                ‹ Назад
              </button>

              <div className="flex items-center gap-1">
                {paginationPages.map((p) => {
                  const isActive = p === safePage
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => onPageChange(p)}
                      className={`min-w-[28px] h-7 rounded-lg text-xs font-medium transition ${
                        isActive
                          ? 'border border-accent/40 bg-accent/20 text-accent font-semibold'
                          : 'border border-transparent bg-transparent text-text hover:bg-cardAlt hover:border-border/60'
                      }`}
                    >
                      {p}
                    </button>
                  )
                })}
              </div>

              <button
                type="button"
                onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
                disabled={safePage >= totalPages}
                className="rounded-lg border border-border bg-cardAlt/60 px-2.5 py-1 text-xs text-text transition hover:bg-cardAlt hover:border-border/80 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Вперёд"
              >
                Вперёд ›
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
})


export default function OperationsPage({ initialTxType, setInitialTxType }: { initialTxType?: TxType | null; setInitialTxType?: (t: TxType) => void }) {
  const { t, currency, locale } = useApp()
  const [activeTab, setActiveTab] = useState<Tab>('list')
  const [rows, setRows] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<'all' | TxType>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [debouncedTypeFilter, setDebouncedTypeFilter] = useState<'all' | TxType>('all')
  const [debouncedCategoryFilter, setDebouncedCategoryFilter] = useState<string>('all')
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const [sortCol, setSortCol] = useState<keyof Transaction>('transaction_date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedRow, setSelectedRow] = useState<Transaction | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTypeFilter(typeFilter)
      setDebouncedCategoryFilter(categoryFilter)
    }, 120)
    return () => clearTimeout(timer)
  }, [typeFilter, categoryFilter])

  const handleSearchInput = useCallback((value: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => setDebouncedQ(value), 220)
  }, [])

  useEffect(() => {
    setPage(1)
  }, [debouncedQ, debouncedTypeFilter, debouncedCategoryFilter, sortCol, sortDir])

  // Add modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState<TransactionFormData>(emptyForm())
  const [addErrors, setAddErrors] = useState<Record<string, boolean>>({})
  const [addSaving, setAddSaving] = useState(false)
  const [addFeedback, setAddFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null)
  const [parsedFile, setParsedFile] = useState<ParsedFile | null>(null)
  const [importMapping, setImportMapping] = useState<ImportColumnMapping[]>([])
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importStage, setImportStage] = useState<'upload' | 'mapping' | 'preview' | 'confirm'>('upload')
  const [importMsg, setImportMsg] = useState('')
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [deletingAll, setDeletingAll] = useState(false)
  const [deleteProgress, setDeleteProgress] = useState<number | null>(null)
  const [importSavedCount, setImportSavedCount] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const PREVIEW_ROW_LIMIT = 200
  const [totalCount, setTotalCount] = useState(0)

  const categoryMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories) m.set(c.id, c.name)
    return m
  }, [categories])
  const sourceLabelMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of SOURCE_TYPE_OPTIONS) m.set(o.value, o.label)
    return m
  }, [])
  const paymentLabelMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of PAYMENT_METHOD_OPTIONS) m.set(o.value, o.label)
    return m
  }, [])
  const typeFilterOptions = useMemo(() => [
    { value: 'all' as const, label: t.filterAll },
    { value: 'income' as const, label: t.filterIncome },
    { value: 'expense' as const, label: t.filterExpense },
  ], [t.filterAll, t.filterIncome, t.filterExpense])
  const categoryFilterOptions = useMemo(() => [
    { value: 'all', label: 'Все категории' },
    ...categories.filter((c, i, arr) => arr.findIndex(x => x.name === c.name) === i).map(c => ({ value: c.id, label: c.name })),
  ], [categories])

  // Open add modal with pre-selected type from dashboard quick actions
  useEffect(() => {
    if (initialTxType) {
      openAddModal(initialTxType)
      setInitialTxType?.(null as any)
    }
  }, [initialTxType])

  // Load all data so search/filter works across all operations
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const catsPromise = getCategories().catch((e) => { console.error('Failed to load categories:', e); return null })
      const all: Transaction[] = []
      let offset = 0
      let total = 0
      const BATCH = 500
      while (true) {
        const res = await getTransactions(undefined, { limit: BATCH, offset })
        all.push(...res.data)
        total = res.count || total || all.length
        if (res.data.length === 0 || all.length >= total) break
        offset += res.data.length
      }
      setRows(all)
      setTotalCount(total || all.length)
      const catsRes = await catsPromise
      if (catsRes) setCategories(catsRes as any)
    } catch (e) {
      console.error('Failed to load transactions:', e)
      setRows([])
      setTotalCount(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const loadDataRef = useRef(loadData)
  useEffect(() => { loadDataRef.current = loadData }, [loadData])

  // Автообновление при новых операциях (синхронизация Sber → Supabase), без ручного переключения разделов
  useEffect(() => {
    let active = true
    let debounce: ReturnType<typeof setTimeout> | null = null
    let channel: any = null
    let poll: ReturnType<typeof setInterval> | null = null
    ;(async () => {
      try {
        const fundId = await getCurrentFundId().catch(() => null)
        if (!active || !fundId) return
        channel = supabase
          .channel('operations-transactions')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `fund_id=eq.${fundId}` } as any, () => {
            if (debounce) clearTimeout(debounce)
            debounce = setTimeout(() => { void loadDataRef.current() }, 400)
          })
          .subscribe()
      } catch {
        /* ignore */
      }
    })()

    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadDataRef.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    poll = setInterval(() => { void loadDataRef.current() }, 15000)

    return () => {
      active = false
      if (debounce) clearTimeout(debounce)
      document.removeEventListener('visibilitychange', onVisible)
      if (poll) clearInterval(poll)
      if (channel) {
        try { supabase.removeChannel(channel) } catch { /* ignore */ }
      }
    }
  }, [])

  // Filter & sort
  const filtered = useMemo(() => {
    const qq = debouncedQ.trim().toLowerCase()
    const result = rows.filter((r) => {
      if (debouncedTypeFilter !== 'all' && r.type !== debouncedTypeFilter) return false
      if (debouncedCategoryFilter !== 'all' && r.category_id !== debouncedCategoryFilter) return false
      if (qq) {
        const hay = `${r.description || ''} ${r.sender_name || ''} ${r.recipient_name || ''} ${r.bank_transaction_id || ''} ${categoryMap.get(r.category_id || '') || ''}`.toLowerCase()
        if (!hay.includes(qq)) return false
      }
      return true
    })
    result.sort((a, b) => {
      const av = a[sortCol] ?? ''
      const bv = b[sortCol] ?? ''
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return result
  }, [rows, debouncedQ, debouncedTypeFilter, debouncedCategoryFilter, sortCol, sortDir, categoryMap])

  const filteredBalance = useMemo(() => filtered.reduce((s, r) => s + (r.type === 'income' ? r.amount : -r.amount), 0), [filtered])

  useEffect(() => () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }, [])

  const handleSort = useCallback((col: keyof Transaction) => {
    setSortCol((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortDir('desc')
      return col
    })
  }, [])

  const updateRow = (id: string, patch: Partial<Transaction>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm(t.confirmDelete)) return
    try {
      await deleteTransaction(id)
      setRows((prev) => prev.filter((r) => r.id !== id))
      setTotalCount(c => Math.max(0, c - 1))
    } catch (e) {
      console.error('Delete error:', e)
      const errorMessage = e instanceof Error ? e.message : 'Ошибка при удалении'
      alert(errorMessage)
    }
  }, [t.confirmDelete])

  const handleDeleteAll = async () => {
    if (deletingAll) return
    const ok = confirm('Удалить все операции?\n\nЭто действие необратимо: все операции и отчёты будут очищены. После удаления можно загрузить новые данные через импорт.')
    if (!ok) return
    setDeletingAll(true)
    setDeleteProgress(0)
    let deleted = 0
    try {
      deleted = await deleteAllTransactions(undefined, (done) => { if (done >= 0) { deleted = done; setDeleteProgress(done) } })
      setRows([])
      setTotalCount(0)
      setPage(1)
      setSelectedRow(null)
      const suffix = typeof deleted === 'number' && deleted > 0 ? ` (${deleted.toLocaleString('ru-RU')})` : ''
      alert(`Все операции удалены${suffix}. Теперь можно загрузить новые данные во вкладке «Импорт».`)
    } catch (e) {
      console.error('Delete all error:', e)
      const done = (e as any)?.done ?? deleted
      const errorMessage = e instanceof Error ? e.message : 'Ошибка при удалении всех операций'
      alert(done ? `${errorMessage}` : errorMessage)
      // refresh to reflect partial deletion
      try { await loadData() } catch {}
    } finally {
      setDeletingAll(false)
      setDeleteProgress(null)
    }
  }

  const handleTogglePublic = useCallback(async (id: string, current: boolean) => {
    try {
      await updateTransaction(id, { is_public: !current } as any)
      setRows((prev) => prev.map((r) => r.id === id ? { ...r, is_public: !current } : r))
    } catch (e) {
      console.error('Toggle public error:', e)
      const errorMessage = e instanceof Error ? e.message : 'Ошибка при изменении'
      alert(errorMessage)
    }
  }, [])

  // --- ADD MODAL ---
  // --- ADD MODAL ---
  const openAddModal = (type?: TxType) => {
    const newForm = emptyForm()
    if (type) newForm.type = type
    setAddForm(newForm)
    setAddErrors({})
    setAddFeedback(null)
    setShowAddModal(true)
  }

  const validateForm = (): boolean => {
    const errors: Record<string, boolean> = {}
    if (!addForm.category_id) errors.category_id = true
    if (!addForm.amount || Number.isNaN(addForm.amount)) errors.amount = true
    if (!addForm.transaction_date) errors.transaction_date = true
    setAddErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleAddSubmit = async () => {
    if (addSaving) return
    if (!validateForm()) {
      setAddFeedback({ type: 'error', text: 'Заполните обязательные поля: категория, сумма и дата.' })
      return
    }
    setAddSaving(true)
    setAddFeedback(null)
    try {
      const newTx = await createTransaction(addForm)
      setRows((prev) => [newTx, ...prev])
      setTotalCount(c => c + 1)
      setAddForm(emptyForm())
      setAddErrors({})
      setAddFeedback({ type: 'success', text: 'Операция сохранена' })
      setTimeout(() => setShowAddModal(false), 1500)
    } catch (e) {
      console.error('Create error:', e)
      const errorMessage = e instanceof Error ? e.message : 'Ошибка при сохранении'
      setAddFeedback({ type: 'error', text: errorMessage })
    } finally {
      setAddSaving(false)
    }
  }

  const handleAddAndAnother = async () => {
    if (addSaving) return
    if (!validateForm()) {
      setAddFeedback({ type: 'error', text: 'Заполните обязательные поля: категория, сумма и дата.' })
      return
    }
    setAddSaving(true)
    setAddFeedback(null)
    try {
      const newTx = await createTransaction(addForm)
      setRows((prev) => [newTx, ...prev])
      setTotalCount(c => c + 1)
      setAddForm({ ...emptyForm(), type: addForm.type })
      setAddErrors({})
      setAddFeedback({ type: 'success', text: 'Операция сохранена. Можно добавить следующую' })
    } catch (e) {
      console.error('Create error:', e)
      const errorMessage = e instanceof Error ? e.message : 'Ошибка при сохранении'
      setAddFeedback({ type: 'error', text: errorMessage })
    } finally {
      setAddSaving(false)
    }
  }

  // --- IMPORT ---
  const pickFile = () => fileInputRef.current?.click()

  const handleFileSelect = async (file: File) => {
    setImportFile(file)
    setImportMsg('')
    setImportStage('mapping')
    try {
      const parsed = file.name.toLowerCase().endsWith('.csv') ? await parseCsvText(await file.arrayBuffer()) : await parseFile(file)
      setParsedFile(parsed)
      setImportMapping(autoMapHeaders(parsed.headers))
    } catch (e) {
      console.error('Parse error:', e)
setImportMsg('Ошибка при чтении файла')
      setImportStage('upload')
    }
  }

  const updateMapping = (sourceColumn: string, targetField: ImportColumnMapping['targetField']) => {
    setImportMapping(prev => prev.map(m => m.sourceColumn === sourceColumn ? { ...m, targetField } : m))
    updatePreview()
  }

  const formatDuration = (seconds: number) => {
    const sec = Math.max(0, Math.round(seconds))
    if (sec < 60) return `~${sec} сек`
    const m = Math.floor(sec / 60)
    const s = sec % 60
    if (m < 60) return s ? `~${m} мин ${s} сек` : `~${m} мин`
    const h = Math.floor(m / 60)
    const mm = m % 60
    return mm ? `~${h} ч ${mm} мин` : `~${h} ч`
  }

  const formatEtaRange = (lowSec: number, highSec: number) => {
    if (Math.abs(highSec - lowSec) < 15) return formatDuration((lowSec + highSec) / 2)
    return `~${formatDuration(lowSec).replace(/^~?/, '')}–${formatDuration(highSec).replace(/^~?/, '')}`
  }

  const updatePreview = async () => {
    if (!parsedFile) return
    try {
      setImportMsg(`Подготовка ${parsedFile.rows.length.toLocaleString('ru-RU')} строк...`)
      const cats = categories.map(c => ({ id: c.id, name: c.name }))
      const previewBase = createImportPreview(parsedFile, importMapping, cats, new Set())
      const bankIds = previewBase.rows
        .map(r => String(r.mapped.bank_transaction_id || '').trim())
        .filter((id): id is string => !!id)
      const uniqueIds = new Set(bankIds).size
      const dupStart = performance.now()
      const existingBankIds = bankIds.length
        ? await checkDuplicateTransactions(previewBase.rows.map(r => r.mapped as any), undefined, (done, total) => {
            const elapsed = (performance.now() - dupStart) / 1000
            const rate = elapsed > 0 ? done / elapsed : 0
            const remaining = rate > 0 ? (total - done) / rate : 0
            const eta = done > 0 ? `, осталось ${formatEtaRange(remaining * 0.8, remaining * 1.2)}` : ''
            setImportMsg(`Проверка дублей: ${done.toLocaleString('ru-RU')} / ${total.toLocaleString('ru-RU')} (${total ? Math.round(done / total * 100) : 100}%)${eta}`)
          })
        : new Set<string>()
      const rows = previewBase.rows.map(r => {
        const bankId = String(r.mapped.bank_transaction_id || '').trim()
        if (bankId && existingBankIds.has(bankId)) {
          return { ...r, isDuplicate: true, validation: { ...r.validation, warnings: [...r.validation.warnings, 'Возможный дубликат (bank_transaction_id уже существует)'] } }
        }
        return r
      })
      const validCount = rows.filter(r => r.validation.isValid && !r.isDuplicate).length
      setImportSavedCount(0)
      setImportPreview({
        headers: parsedFile.headers,
        rows,
        totalRows: rows.length,
        validRows: validCount,
        duplicateRows: rows.filter(r => r.isDuplicate).length,
        errorRows: rows.filter(r => !r.validation.isValid).length,
      })
      if (validCount) {
        setImportMsg(`Готово к импорту: ${validCount.toLocaleString('ru-RU')} строк. Оценка времени сохранения: ${formatEtaRange(validCount / 4000, validCount / 1500)} (зависит от сети/БД).`)
      } else {
        setImportMsg(uniqueIds ? 'Готово: подходящих строк для импорта нет.' : 'Готово: подходящих строк для импорта нет.')
      }
      setImportStage('preview')
    } catch (e) {
      console.error('Preview error:', e)
      setImportMsg('Ошибка при подготовке предпросмотра')
    }
  }

  const confirmImport = async (resume = false) => {
    if (!importPreview) return
    const allValidRows = importPreview.rows
      .filter(r => r.validation.isValid && !r.isDuplicate)
      .map(r => r.mapped)
    const overallTotal = allValidRows.length
    if (!overallTotal) { setImportMsg('Нет строк, подходящих для импорта'); return }

    const baseDone = resume ? Math.min(importSavedCount, overallTotal) : 0
    if (!resume) setImportSavedCount(0)
    let remainingRows = allValidRows.slice(baseDone)

    setImportError(null)
    setImportStage('confirm')

    let skippedExisting = 0
    if (resume && remainingRows.length) {
      const ids = Array.from(new Set(remainingRows.map(r => String((r as any).bank_transaction_id || '').trim()).filter(Boolean)))
      if (ids.length) {
        try {
          setImportMsg(`Проверка уже сохранённых строк перед продолжением: 0 / ${ids.length.toLocaleString('ru-RU')}...`)
          const existing = await checkDuplicateTransactions(remainingRows as any, undefined, (done, total) => {
            setImportMsg(`Проверка уже сохранённых строк: ${done.toLocaleString('ru-RU')} / ${total.toLocaleString('ru-RU')}...`)
          })
          if (existing.size) {
            const before = remainingRows.length
            remainingRows = remainingRows.filter(r => {
              const id = String((r as any).bank_transaction_id || '').trim()
              return !(id && existing.has(id))
            })
            skippedExisting = before - remainingRows.length
          }
        } catch (e) {
          console.warn('Resume duplicate check failed, continuing by saved offset:', e)
        }
      }
    }

    if (!remainingRows.length) {
      setImportSavedCount(overallTotal)
      setImportProgress({ done: overallTotal, total: overallTotal })
      setImportMsg(skippedExisting
        ? `Все оставшиеся строки уже сохранены (пропущено дублей: ${skippedExisting.toLocaleString('ru-RU')}).`
        : 'Все оставшиеся строки уже сохранены.')
      return
    }

    const runTotal = remainingRows.length
    setImportProgress({ done: baseDone, total: overallTotal })
    const t0 = performance.now()
    const estMsg = formatEtaRange(runTotal / 2500, runTotal / 700)
    const skippedMsg = skippedExisting ? ` Пропущено уже сохранённых: ${skippedExisting.toLocaleString('ru-RU')}.` : ''
    setImportMsg(`Сохранено ${baseDone.toLocaleString('ru-RU')} из ${overallTotal.toLocaleString('ru-RU')}. Отправка ${runTotal.toLocaleString('ru-RU')} строк... Оценка: ${estMsg}.${skippedMsg}`)

    try {
      await bulkCreateTransactions(remainingRows as TransactionFormData[], undefined, {
        chunkSize: 500,
        concurrency: 1,
        returnRows: false,
        onProgress: (done, total) => {
          const overallDone = Math.min(baseDone + done, overallTotal)
          setImportSavedCount(overallDone)
          setImportProgress({ done: overallDone, total: overallTotal })
          const elapsed = (performance.now() - t0) / 1000
          const rate = elapsed > 0 ? done / elapsed : 0
          const remaining = rate > 0 ? (total - done) / rate : 0
          const eta = done > 0 ? `, осталось ${formatEtaRange(remaining * 0.85, remaining * 1.3)}` : ''
          setImportMsg(`Импортирование: ${overallDone.toLocaleString('ru-RU')} / ${overallTotal.toLocaleString('ru-RU')} (${overallTotal ? Math.round(overallDone / overallTotal * 100) : 100}%)${eta}`)
        },
      })
      const totalSec = (performance.now() - t0) / 1000
      const finalSaved = Math.min(baseDone + runTotal, overallTotal)
      setImportSavedCount(finalSaved)
      setImportProgress({ done: finalSaved, total: overallTotal })
      setImportMsg(`Успешно сохранено ${finalSaved.toLocaleString('ru-RU')} из ${overallTotal.toLocaleString('ru-RU')} операций за ${formatDuration(totalSec)}.${skippedMsg} Список обновится при следующей загрузке.`)
      setRows([])
      setTotalCount(c => c + runTotal)
    } catch (e) {
      console.error('Import error:', e)
      const doneInRun = Number((e as any)?.done ?? 0)
      const savedOverall = Math.min(baseDone + doneInRun, overallTotal)
      const left = Math.max(0, overallTotal - savedOverall)
      setImportSavedCount(savedOverall)
      setImportProgress({ done: savedOverall, total: overallTotal })
      const errorMessage = e instanceof Error ? e.message : 'Ошибка при импорте'
      const timeoutHint = /statement timeout|57014/i.test(errorMessage)
        ? ' БД вернула statement timeout (57014) — размер отправляемых частей автоматически уменьшается, можно продолжить.'
        : ''
      setImportError(`${errorMessage}.${timeoutHint}`)
      setImportMsg(`Импорт остановлен. Успешно сохранено: ${savedOverall.toLocaleString('ru-RU')} из ${overallTotal.toLocaleString('ru-RU')} (${overallTotal ? Math.round(savedOverall / overallTotal * 100) : 0}%). Осталось: ${left.toLocaleString('ru-RU')}. Нажмите «Продолжить импорт» — продолжение начнётся с оставшихся строк; перед отправкой выполняется проверка дублей по bank_transaction_id, поэтому уже сохранённые строки не будут добавлены повторно.`)
    }
  }

  const resetImport = () => {
    setImportFile(null)
    setParsedFile(null)
    setImportMapping([])
    setImportPreview(null)
    setImportProgress(null)
    setImportError(null)
    setImportSavedCount(0)
    setImportStage('upload')
    setImportMsg('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // --- TABS ---
  const tabs = [
    { id: 'list' as Tab, label: t.tabs.list, icon: (props: any) => <FileText {...props} /> },
    { id: 'add' as Tab, label: t.tabs.add, icon: Plus },
    { id: 'import' as Tab, label: t.tabs.import, icon: Upload },
  ]

  // --- RENDER FUNCTIONS ---



  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 bg-card/50 rounded-xl p-1" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                isActive ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text/90 hover:bg-cardAlt/50'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          )
        })}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'list' && (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted">{t.operationsSub}</div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/30 px-3 py-2 text-sm text-muted">
            <Search size={15} />
            <input ref={searchInputRef} defaultValue="" onChange={(e) => handleSearchInput(e.target.value)} placeholder={t.search} className="w-48 bg-transparent text-text outline-none placeholder:text-muted/70" />
          </div>
          <Select value={typeFilter} options={typeFilterOptions} onChange={(v) => setTypeFilter(v)} ariaLabel={t.type} className="w-40" />
          <Select value={categoryFilter} options={categoryFilterOptions} onChange={(v) => setCategoryFilter(v)} ariaLabel={t.category} className="w-48" />
                    <button
            type="button"
            onClick={handleDeleteAll}
            disabled={deletingAll}
            className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
          >
            <Trash2 size={15} /> {deletingAll ? `Удаление...${deleteProgress != null ? ` ${deleteProgress.toLocaleString('ru-RU')}` : ''}` : 'Удалить все операции'}
          </button>
        </div>
      </div>

      <VirtualOpsTable
        filtered={filtered}
        allCount={rows.length}
        loading={loading}
        t={t}
        locale={locale}
        currency={currency}
        sortCol={sortCol}
        sortDir={sortDir}
        onSort={handleSort}
        categoryMap={categoryMap}
        sourceLabelMap={sourceLabelMap}
        paymentLabelMap={paymentLabelMap}
        onSelectRow={setSelectedRow}
        onTogglePublic={handleTogglePublic}
        onDelete={handleDelete}
        filteredBalance={filteredBalance}
        activeTab={activeTab}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
      />
          </motion.div>
        )}
        {activeTab === 'add' && (
          <motion.div key="add" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            <AddTab
              addForm={addForm}
              setAddForm={setAddForm}
              addErrors={addErrors}
              setAddErrors={setAddErrors}
              categories={categories}
              handleAddSubmit={handleAddSubmit}
              handleAddAndAnother={handleAddAndAnother}
              validateForm={validateForm}
              t={t}
              saving={addSaving}
              feedback={addFeedback}
            />
          </motion.div>
        )}
        {activeTab === 'import' && (
          <motion.div key="import" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
    <div className="space-y-4">
      {importStage === 'upload' && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="text-base font-semibold text-text">{t.importFile}</div>
          <div className="mt-1 text-sm text-muted">{t.operationsSub}</div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={pickFile} className="inline-flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/15 px-4 py-2.5 text-sm font-medium text-accent transition hover:bg-accent/20">
              <Upload size={16} /> {t.importFile}
            </button>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} className="hidden" />
            <button type="button" onClick={() => downloadTemplate()} className="inline-flex items-center gap-2 rounded-xl border border-border bg-cardAlt/60 px-4 py-2.5 text-sm text-muted transition hover:text-text">
              <Download size={16} /> {t.downloadTemplate}
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted"><FileSpreadsheet size={14} /> {importFile ? `${t.fileLoaded}: ${importFile.name}` : t.noFile}</div>
          {importMsg && <div className="mt-3 rounded-xl border border-accent/20 bg-accent/10 px-3 py-2 text-sm text-accent">{importMsg}</div>}
        </div>
      )}

      {/* Stage 2: Column Mapping */}
      {importStage === 'mapping' && parsedFile && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
<div className="text-sm font-medium text-text">Сопоставление столбцов файла</div>
              <div className="text-xs text-muted">Убедитесь, что столбцы файла соответствуют полям системы импорта</div>
            </div>
<button type="button" onClick={updatePreview} className="rounded-xl border border-accent/30 bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20">Предпросмотр</button>
          </div>

        <div className="overflow-x-auto ops-scroll">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-cardAlt/40 text-left text-xs text-muted">
                <tr>
<th className="px-3 py-2 font-medium">Столбец файла импорта</th>
                  <th className="px-3 py-2 font-medium">Пример значения</th>
                  <th className="px-3 py-2 font-medium">Поле системы</th>
                </tr>
              </thead>
              <tbody>
                {parsedFile.headers.map((h) => (
                  <tr key={h} className="border-t border-border/70">
                    <td className="px-3 py-2 font-medium">{h}</td>
                    <td className="px-3 py-2 text-muted">{parsedFile.rows[0]?.[h] || '—'}</td>
                    <td className="px-3 py-2">
                      <Select
                        value={importMapping.find(m => m.sourceColumn === h)?.targetField || 'ignore'}
                        options={[
{ value: 'ignore', label: '— Пропустить столбец —' },
                          ...IMPORTABLE_FIELDS.map(f => ({ value: f.key, label: `${f.label} ${f.required ? '*' : ''}` }))
                        ]}
                        onChange={(v) => updateMapping(h, v as any)}
                        className="w-full"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => { setImportStage('upload'); resetImport() }} className="rounded-xl border border-border bg-cardAlt/60 px-4 py-2.5 text-sm text-muted transition hover:text-text">{t.back}</button>
          </div>
        </div>
      )}

      {/* Stage 3: Preview */}
      {importStage === 'preview' && importPreview && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <div className="text-sm font-medium text-text">{t.preview}</div>
                <div className="text-xs text-muted">{t.previewHint}</div>
              </div>
              <div className="flex gap-2">
<span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-accent/15 text-accent">{importPreview.validRows} строк готово</span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-yellow-500/15 text-yellow-400">{importPreview.duplicateRows} дубликатов</span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-500/15 text-red-400">{importPreview.errorRows} строк с ошибками</span>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="sticky top-0 bg-cardAlt/50 text-left text-xs text-muted">
                  <tr>
                    {parsedFile?.headers.map(h => (
                      <th key={h} className="px-2 py-2 font-medium">{h}</th>
                    ))}
<th className="px-3 py-2 font-medium">Статус</th>
                    <th className="px-3 py-2 font-medium">Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.rows.slice(0, PREVIEW_ROW_LIMIT).map((r, i) => {
                    const statusColor = r.isDuplicate ? 'bg-yellow-500/15 text-yellow-400' :
                      r.validation.isValid ? 'bg-accent/15 text-accent' : 'bg-red-500/15 text-red-400'
                    const statusText = r.isDuplicate ? 'Дубликат' : r.validation.isValid ? 'Готово' : 'Ошибка'
                    return (
                      <tr key={i} className="border-t border-border/70">
                        {parsedFile?.headers.map(h => (
                          <td key={h} className="px-2 py-2">
                            <input
                              value={r.raw[h] ?? ''}
                              onChange={(e) => {
                                const newRaw = { ...r.raw, [h]: e.target.value }
                                setImportPreview(prev => prev ? {
                                  ...prev,
                                  rows: prev.rows.map((row, idx) => idx === i ? { ...row, raw: newRaw } : row)
                                } : null)
                              }}
                              className="w-full min-w-[90px] rounded-lg border border-border bg-cardAlt/40 px-2 py-1.5 text-sm text-text outline-none focus:border-accent/40"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2">
                          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${statusColor}`}>{statusText}</span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {!r.validation.isValid && (
                            <button
                              type="button"
                              onClick={() => {
                                const fixed = mapRowToTransaction(r.raw, importMapping, categories.map(c => ({ id: c.id, name: c.name })))
                                setImportPreview(prev => prev ? {
                                  ...prev,
                                  rows: prev.rows.map((row, idx) => idx === i ? fixed : row)
                                } : null)
                              }}
                              className="text-xs text-accent hover:underline"
                            >
Исправить строку
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {importPreview.rows.length > PREVIEW_ROW_LIMIT && (
              <div className="mt-2 text-xs text-muted">Показаны первые {PREVIEW_ROW_LIMIT} из {importPreview.rows.length} строк (для экономии памяти). Импортируются все валидные строки.</div>
            )}
          </div>

          {importMsg && <div className="rounded-xl border border-accent/20 bg-accent/10 px-3 py-2 text-sm text-accent whitespace-pre-wrap">{importMsg}</div>}
          {importPreview.validRows > 0 && importSavedCount > 0 && importSavedCount < importPreview.validRows && <div className="rounded-xl border border-border bg-cardAlt/40 px-3 py-2 text-sm text-muted">Сохранено ранее: {importSavedCount.toLocaleString('ru-RU')} из {importPreview.validRows.toLocaleString('ru-RU')}. Нажмите «Подтвердить импорт», чтобы продолжить с оставшихся строк (с проверкой дублей).</div>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setImportStage('mapping')} className="rounded-xl border border-border bg-cardAlt/60 px-4 py-2.5 text-sm text-muted transition hover:text-text">{t.back}</button>
            <button type="button" onClick={() => void confirmImport(false)} disabled={importPreview.validRows === 0} className="rounded-xl border border-accent/30 bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-40">{t.confirmImport}</button>
          </div>
        </div>
      )}

      {/* Stage 4: Confirm / Progress */}
      {importStage === 'confirm' && (() => {
        const total = importProgress?.total ?? importPreview?.validRows ?? 0
        const done = importProgress?.done ?? importSavedCount
        const inProgress = importProgress != null && done < total
        const finished = !importError && total > 0 && done >= total
        return (
          <div className={`rounded-xl border p-5 text-center ${importError ? 'border-red-500/30 bg-red-500/10' : 'border-accent/20 bg-accent/10'}`}>
            {importError ? <AlertCircle size={48} className="mx-auto text-red-400 mb-3" /> : <CheckCircle size={48} className="mx-auto text-accent mb-3" />}
            <div className="text-lg font-medium text-text">{importError ? 'Импорт остановлен' : (inProgress ? 'Импорт выполняется' : 'Импорт завершён')}</div>
            <div className="mt-1 text-sm text-muted whitespace-pre-wrap">{importMsg || importError || ''}</div>
            {total > 0 && (
              <>
                <div className="mt-3 h-2 w-full max-w-md mx-auto rounded bg-border overflow-hidden">
                  <div className="h-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
                </div>
                <div className="mt-2 text-xs text-muted">Сохранено: {done.toLocaleString('ru-RU')} из {total.toLocaleString('ru-RU')} · Осталось: {Math.max(0, total - done).toLocaleString('ru-RU')}</div>
              </>
            )}
            {importError && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <button type="button" onClick={() => void confirmImport(true)} disabled={inProgress} className="inline-flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/15 px-4 py-2.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50">
                  <RefreshCw size={16} /> Продолжить импорт
                </button>
                <button type="button" onClick={() => setImportStage('preview')} className="inline-flex items-center gap-2 rounded-xl border border-border bg-cardAlt/60 px-4 py-2.5 text-sm text-text transition hover:bg-cardAlt">
                  <ArrowLeft size={16} /> К предпросмотру
                </button>
                <button type="button" onClick={() => { resetImport(); setImportMsg('') }} className="inline-flex items-center gap-2 rounded-xl border border-border bg-cardAlt/60 px-4 py-2.5 text-sm text-text transition hover:bg-cardAlt">
                  <Upload size={16} /> Загрузить другой файл
                </button>
              </div>
            )}
            {finished && (
              <button type="button" onClick={() => { resetImport(); setImportMsg('') }} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/15 px-4 py-2.5 text-sm font-medium text-accent transition hover:bg-accent/20">
                <Upload size={16} /> Загрузить другой файл
              </button>
            )}
          </div>
        )
      })()}
    </div>
          </motion.div>
        )}
      </AnimatePresence>

      {showAddModal && (
        <Modal open={true} title="Добавить операцию" onClose={() => !addSaving && setShowAddModal(false)} wide>
          <AddTab
            addForm={addForm}
            setAddForm={setAddForm}
            addErrors={addErrors}
            setAddErrors={setAddErrors}
            categories={categories}
            handleAddSubmit={handleAddSubmit}
            handleAddAndAnother={handleAddAndAnother}
            validateForm={validateForm}
            t={t}
            saving={addSaving}
            feedback={addFeedback}
          />
        </Modal>
      )}

      {selectedRow && (
    <motion.div
      key="detail"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedRow(null)} />
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        style={{ willChange: 'transform, opacity' }}
        className="flex-shrink-0 w-full max-w-2xl max-h-[calc(100vh-48px)] overflow-y-auto rounded-xl border border-l border-border bg-card shadow-xl"
      >
        {selectedRow && (
          <>
            <div className="flex items-center justify-between border-b border-border p-4">
              <div>
                <div className="text-sm font-medium text-text">Детали операции</div>
                <div className="text-xs text-muted">ID: {selectedRow.id.slice(0, 8)}...</div>
              </div>
              <button onClick={() => setSelectedRow(null)} className="rounded-lg p-1.5 text-muted hover:bg-cardAlt hover:text-text"><X size={20} /></button>
            </div>
            <div className="p-4 space-y-4 max-h-[calc(100vh-120px)] overflow-y-auto">
              <DocumentManager transaction={selectedRow} onDocumentChange={() => loadData()} />
              <div className="border-t border-border pt-4 space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-muted">Тип:</span> <span className="ml-2 font-medium">{selectedRow.type === 'income' ? 'Приход' : 'Расход'}</span></div>
                  <div><span className="text-muted">Сумма:</span> <span className="ml-2 font-medium">{selectedRow.type === 'income' ? '+' : '-'}{formatCurrency(selectedRow.amount, currency, locale)}</span></div>
                  <div><span className="text-muted">Категория:</span> <span className="ml-2">{categoryMap.get(selectedRow.category_id || '') || selectedRow.category_id || '—'}</span></div>
                  <div><span className="text-muted">Дата:</span> <span className="ml-2">{formatDate(selectedRow.transaction_date, locale)}</span></div>
                  <div><span className="text-muted">Отправитель:</span> <span className="ml-2">{selectedRow.sender_name || '—'}</span></div>
                  <div><span className="text-muted">Банк отправителя:</span> <span className="ml-2">{selectedRow.sender_bank || '—'}</span></div>
                  <div><span className="text-muted">Счёт отправителя:</span> <span className="ml-2 font-mono">{selectedRow.sender_account_masked || '—'}</span></div>
                  <div><span className="text-muted">Получатель:</span> <span className="ml-2">{selectedRow.recipient_name || '—'}</span></div>
                  <div><span className="text-muted">Банк получателя:</span> <span className="ml-2">{selectedRow.recipient_bank || '—'}</span></div>
                  <div><span className="text-muted">Счёт получателя:</span> <span className="ml-2 font-mono">{selectedRow.recipient_account_masked || '—'}</span></div>
                  <div><span className="text-muted">Источник поступления:</span> <span className="ml-2">{selectedRow.source_type ? (sourceLabelMap.get(selectedRow.source_type) || selectedRow.source_type) : '—'}</span></div>
                  <div><span className="text-muted">Способ оплаты:</span> <span className="ml-2">{selectedRow.payment_method ? (paymentLabelMap.get(selectedRow.payment_method) || selectedRow.payment_method) : '—'}</span></div>
                  <div><span className="text-muted">ID банковской операции:</span> <span className="ml-2 font-mono">{selectedRow.bank_transaction_id || '—'}</span></div>
                  <div><span className="text-muted">Комментарий:</span> <span className="ml-2">{selectedRow.comment || '—'}</span></div>
                  <div className="col-span-2"><span className="text-muted">Описание:</span> <div className="mt-1">{selectedRow.description || '—'}</div></div>
                </div>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
      )}
    </div>
  )
}

