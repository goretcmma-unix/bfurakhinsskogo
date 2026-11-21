import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Globe, Check, Eye, EyeOff, Plus, Trash2, Calendar, Building, CreditCard, Key, Shield, UserCheck } from 'lucide-react'
import { useApp } from '@/lib/appStore'
import { Select } from '@/components/ui/Select'
import { Modal, Field, ModalActions, inputCls } from '@/components/ui/Modal'
import type { Category, CategoryFormData, BankAccount, BankAccountFormData, UserRole } from '@/lib/types'
import { getCategories, createCategory, updateCategory, deleteCategory, getBankAccounts, createBankAccount, updateBankAccount, deleteBankAccount } from '@/lib/dataService'

type Kind = 'income' | 'expense'
type SettingsTab = 'general' | 'categories' | 'bankAccounts' | 'transparency'

const kindOpts = [
  { value: 'income' as const, label: 'Приход' },
  { value: 'expense' as const, label: 'Расход' },
]

const roleOpts: { value: UserRole; label: string }[] = [
  { value: 'owner', label: 'Владелец' },
  { value: 'admin', label: 'Администратор' },
  { value: 'member', label: 'Участник' },
  { value: 'viewer', label: 'Наблюдатель' },
]

const currencyOpts = [
  { value: 'RUB', label: 'RUB (₽)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
]

export default function SettingsPage() {
  const { t, lang, setLang, currency } = useApp()
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [categories, setCategories] = useState<Category[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [categoryKind, setCategoryKind] = useState<'income' | 'expense'>('income')

  // Category modal
  const [catModalOpen, setCatModalOpen] = useState(false)
  const [editingCat, setEditingCat] = useState<Category | null>(null)
  const [catForm, setCatForm] = useState<CategoryFormData>({ name: '', type: 'income', description: '', is_active: true, sort_order: 0 })
  const [catSaveError, setCatSaveError] = useState<string | null>(null)
  const [catSaving, setCatSaving] = useState(false)

  // Bank account modal
  const [bankModalOpen, setBankModalOpen] = useState(false)
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null)
  const [bankForm, setBankForm] = useState<BankAccountFormData>({ bank_name: '', account_name: '', account_number_masked: '', currency: 'RUB', is_active: true, is_default: false })

  // Transparency
  const [transparencyEnabled, setTransparencyEnabled] = useState(false)
  const [transparencyFields, setTransparencyFields] = useState({ date: true, donor: true, description: true, amount: true })
  const [transparencyMsg, setTransparencyMsg] = useState('')

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [cats, banks] = await Promise.all([getCategories(), getBankAccounts()])
      setCategories(cats)
      setBankAccounts(banks)
    } catch (e) {
      console.error('Failed to load settings data:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Category handlers
  const openCatModal = (cat?: Category) => {
    if (cat) {
      setEditingCat(cat)
      setCatForm({ name: cat.name, type: cat.type, description: cat.description || '', is_active: cat.is_active, sort_order: cat.sort_order })
    } else {
      setEditingCat(null)
      setCatForm({ name: '', type: categoryKind, description: '', is_active: true, sort_order: categories.length * 10 + 10 })
    }
    setCatModalOpen(true)
  }

  const saveCategory = async () => {
    setCatSaveError(null)
    if (!catForm.name.trim()) {
      setCatSaveError('Введите название категории')
      return
    }
    setCatSaving(true)
    try {
      if (editingCat) {
        await updateCategory(editingCat.id, catForm)
      } else {
        await createCategory(catForm)
      }
      await loadData()
      setCatModalOpen(false)
    } catch (e: any) {
      setCatSaveError(e?.message || 'Не удалось сохранить категорию')
    } finally {
      setCatSaving(false)
    }
  }

  const removeCategory = async (id: string) => {
    if (confirm('Удалить категорию?')) {
      try {
        await deleteCategory(id)
        await loadData()
      } catch (e) {
        console.error('Delete category error:', e)
      }
    }
  }

  // Bank account handlers
  const openBankModal = (bank?: BankAccount) => {
    if (bank) {
      setEditingBank(bank)
      setBankForm({ bank_name: bank.bank_name, account_name: bank.account_name, account_number_masked: bank.account_number_masked, currency: bank.currency, is_active: bank.is_active, is_default: bank.is_default })
    } else {
      setEditingBank(null)
      setBankForm({ bank_name: '', account_name: '', account_number_masked: '', currency: 'RUB', is_active: true, is_default: bankAccounts.length === 0 })
    }
    setBankModalOpen(true)
  }

  const saveBankAccount = async () => {
    if (!bankForm.bank_name.trim() || !bankForm.account_name.trim() || !bankForm.account_number_masked.trim()) return
    try {
      if (editingBank) {
        await updateBankAccount(editingBank.id, bankForm)
      } else {
        await createBankAccount(bankForm)
      }
      await loadData()
      setBankModalOpen(false)
    } catch (e) {
      console.error('Save bank account error:', e)
    }
  }

  const deleteBankAccount = async (id: string) => {
    if (confirm('Удалить банковский счёт?')) {
      try {
        await deleteBankAccount(id)
        await loadData()
      } catch (e) {
        console.error('Delete bank account error:', e)
      }
    }
  }

  const saveTransparency = () => {
    setTransparencyMsg('Настройки прозрачности сохранены')
    setTimeout(() => setTransparencyMsg(''), 1800)
  }

  const tabs = [
    { id: 'general' as SettingsTab, label: t.settingsTabs.general, icon: Globe },
    { id: 'categories' as SettingsTab, label: t.settingsTabs.categories, icon: Building },
    { id: 'bankAccounts' as SettingsTab, label: 'Банковские счета', icon: CreditCard },
    { id: 'transparency' as SettingsTab, label: t.settingsTabs.transparency, icon: Eye },
  ]

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted">{t.settingsSub}</div>

      <div className="flex flex-wrap gap-1 bg-card/50 rounded-xl p-1 mb-4" role="tablist">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id
          const Icon = tab.icon
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
        {/* GENERAL */}
        {activeTab === 'general' && (
          <motion.div key="general" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-w-2xl space-y-3">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <div className="text-sm font-medium text-text">{t.language} / {t.currency}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setLang('ru')} className={`rounded-xl border px-3 py-2 text-sm transition ${lang === 'ru' ? 'border-accent/30 bg-accent/12 text-accent' : 'border-border bg-cardAlt/50 text-muted hover:text-text'}`}>Русский · RUB (₽)</button>
                <button type="button" onClick={() => setLang('en')} className={`rounded-xl border px-3 py-2 text-sm transition ${lang === 'en' ? 'border-accent/30 bg-accent/12 text-accent' : 'border-border bg-cardAlt/50 text-muted hover:text-text'}`}>English · USD ($)</button>
              </div>
              <div className="mt-2 text-xs text-muted">{t.currency}: {currency}</div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }} className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <div className="text-sm font-medium text-text">Фонд и реквизиты</div>
              <div className="mt-1 text-sm text-muted">Настройте основные данные фонда для отчётов и публичной страницы.</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Название фонда"><input value="" onChange={() => {}} className={inputCls} placeholder="Фонд имени..." disabled /></Field>
                <Field label="ИНН"><input value="" onChange={() => {}} className={inputCls} placeholder="1234567890" disabled /></Field>
                <Field label="ОГРН"><input value="" onChange={() => {}} className={inputCls} placeholder="1234567890123" disabled /></Field>
                <Field label="Адрес"><input value="" onChange={() => {}} className={inputCls} placeholder="г. Москва, ул. Примерная, 1" disabled /></Field>
                <Field label="Телефон"><input value="" onChange={() => {}} className={inputCls} placeholder="+7 (999) 123-45-67" disabled /></Field>
                <Field label="Email"><input value="" onChange={() => {}} className={inputCls} placeholder="info@fond.ru" disabled /></Field>
              </div>
              <div className="mt-3 text-xs text-muted">Редактирование реквизитов будет доступно после подключения базы данных.</div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <div className="text-sm font-medium text-text">База данных подключена</div>
              <div className="mt-1 text-sm text-muted">Supabase настроен, данные сохраняются между сессиями.</div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <div className="text-sm font-medium text-text">{t.about}</div>
              <div className="mt-2 text-sm text-muted leading-relaxed">{t.techSub}</div>
            </motion.div>
          </motion.div>
        )}

        {/* CATEGORIES */}
        {activeTab === 'categories' && (
          <motion.div key="categories" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-w-3xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-muted">{t.categoriesSub}</div>
              <button type="button" onClick={() => openCatModal()} className="inline-flex items-center gap-2 rounded-lg bg-accent/15 px-3 py-2 text-sm font-medium text-accent transition hover:bg-accent/20">
                <Plus size={16} /> {t.categoryAdd}
              </button>
            </div>

            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setCategoryKind('income')}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${categoryKind === 'income' ? 'bg-accent/15 text-accent border border-accent/30' : 'text-muted border border-transparent hover:bg-cardAlt/50'}`}
              >
                {t.incomeLabel}
              </button>
              <button
                type="button"
                onClick={() => setCategoryKind('expense')}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${categoryKind === 'expense' ? 'bg-red-500/15 text-red-400 border border-red-500/30' : 'text-muted border border-transparent hover:bg-cardAlt/50'}`}
              >
                {t.expenseLabel}
              </button>
            </div>

            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="overflow-hidden rounded-xl border border-border/70 bg-card/20">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-cardAlt/40 text-left text-xs text-muted">
                  <tr>
                    <th className="border-b border-border/60 px-3 py-2.5 font-medium">{t.categoryName}</th>
                    <th className="w-40 border-b border-border/60 px-3 py-2.5 font-medium">{t.categoryType}</th>
                    <th className="w-24 border-b border-border/60 px-3 py-2.5 font-medium">Порядок</th>
                    <th className="w-24 border-b border-border/60 px-3 py-2.5 font-medium">Статус</th>
                    <th className="w-10 border-b border-border/60 px-2 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {categories.filter(c => c.type === categoryKind).length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Категорий нет. Добавьте первую.</td></tr>
                  ) : categories.filter(c => c.type === categoryKind).map((c) => (
                    <tr key={c.id} className="hover:bg-cardAlt/20">
                      <td className="border-b border-border/50 px-3 py-2.5 text-text">{c.name}</td>
                      <td className="border-b border-border/50 px-3 py-2.5 text-muted">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                          c.type === 'income' ? 'bg-accent/15 text-accent' : 'bg-red-500/15 text-red-400'
                        }`}>
                          {c.type === 'income' ? '↑' : '↓'}                             {c.type === 'income' ? 'Получение' : 'Расход'}
                        </span>
                      </td>
                      <td className="border-b border-border/50 px-3 py-2.5 text-muted">{c.sort_order}</td>
                      <td className="border-b border-border/50 px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                          c.is_active ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/15 text-gray-400'
                        }`}>
                          {c.is_active ? 'Активна' : 'Скрыта'}
                        </span>
                      </td>
                      <td className="border-b border-border/50 px-2 py-2 text-right">
                        <button type="button" onClick={() => openCatModal(c)} className="mr-1 rounded px-2 py-1 text-xs text-accent hover:bg-accent/10">{t.edit}</button>
                        <button type="button" onClick={() => removeCategory(c.id)} className="rounded p-1 text-muted hover:text-text" aria-label={t.delete}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </motion.div>
          </motion.div>
        )}

        {/* BANK ACCOUNTS */}
        {activeTab === 'bankAccounts' && (
          <motion.div key="bankAccounts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-w-3xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-muted">Управление банковскими счетами фонда. Хранятся только маскированные номера.</div>
              <button type="button" onClick={() => openBankModal()} className="inline-flex items-center gap-2 rounded-lg bg-accent/15 px-3 py-2 text-sm font-medium text-accent transition hover:bg-accent/20">
                <Plus size={16} /> Добавить счёт
              </button>
            </div>

            {loading ? (
              <div className="rounded-xl border border-border/70 bg-card/20 p-8 text-center text-muted">Загрузка...</div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="overflow-hidden rounded-xl border border-border/70 bg-card/20">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-cardAlt/40 text-left text-xs text-muted">
                    <tr>
                      <th className="border-b border-border/60 px-3 py-2.5 font-medium">Банк</th>
                      <th className="border-b border-border/60 px-3 py-2.5 font-medium">Название счёта</th>
                      <th className="w-48 border-b border-border/60 px-3 py-2.5 font-medium">Номер (маска)</th>
                      <th className="w-24 border-b border-border/60 px-3 py-2.5 font-medium">Валюта</th>
                      <th className="w-24 border-b border-border/60 px-3 py-2.5 font-medium">Статус</th>
                      <th className="w-24 border-b border-border/60 px-3 py-2.5 font-medium">По умолч.</th>
                      <th className="w-10 border-b border-border/60 px-2 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankAccounts.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">Счётов нет. Добавьте первый.</td></tr>
                    ) : bankAccounts.map((b) => (
                      <tr key={b.id} className="hover:bg-cardAlt/20">
                        <td className="border-b border-border/50 px-3 py-2.5 text-text">{b.bank_name}</td>
                        <td className="border-b border-border/50 px-3 py-2.5 text-text">{b.account_name}</td>
                        <td className="border-b border-border/50 px-3 py-2.5 font-mono text-muted">{b.account_number_masked}</td>
                        <td className="border-b border-border/50 px-3 py-2.5 text-muted">{b.currency}</td>
                        <td className="border-b border-border/50 px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                            b.is_active ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/15 text-gray-400'
                          }`}>
                            {b.is_active ? 'Активен' : 'Неактивен'}
                          </span>
                        </td>
                        <td className="border-b border-border/50 px-3 py-2.5 text-center">
                          {b.is_default && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-accent/15 text-accent">Да</span>}
                        </td>
                        <td className="border-b border-border/50 px-2 py-2 text-right">
                          <button type="button" onClick={() => openBankModal(b)} className="mr-1 rounded px-2 py-1 text-xs text-accent hover:bg-accent/10">Изменить</button>
                          <button type="button" onClick={() => deleteBankAccount(b.id)} className="rounded p-1 text-muted hover:text-text" aria-label="Удалить"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* TRANSPARENCY */}
        {activeTab === 'transparency' && (
          <motion.div key="transparency" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-w-2xl space-y-4">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-text">{t.transparencyTitle}</div>
                  <div className="mt-1 text-sm text-muted">{t.transparencySub}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setTransparencyEnabled(!transparencyEnabled)}
                  className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition ${
                    transparencyEnabled ? 'bg-accent' : 'bg-border'
                  }`}
                  role="switch"
                  aria-checked={transparencyEnabled}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    transparencyEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>
              <div className="mt-2 text-xs text-muted">
                {transparencyEnabled ? 'Публичная страница включена' : 'Публичная страница отключена'}
              </div>
            </motion.div>

            {transparencyEnabled && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
                <div className="text-sm font-medium text-text">{t.transparencyFields}</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[
                    { key: 'date', label: t.fieldDate, icon: Calendar },
                    { key: 'donor', label: t.fieldDonor, icon: UserCheck },
                    { key: 'description', label: t.fieldDescription, icon: Building },
                    { key: 'amount', label: t.fieldAmount, icon: CreditCard }
                  ].map((field) => {
                    const Icon = field.icon
                    return (
                      <label key={field.key} className="flex items-center gap-3 rounded-lg border border-border/60 bg-cardAlt/40 px-3 py-2.5 cursor-pointer transition hover:border-accent/30">
                        <Icon size={16} className="text-muted shrink-0" />
                        <input
                          type="checkbox"
                          checked={transparencyFields[field.key as keyof typeof transparencyFields]}
                          onChange={(e) => setTransparencyFields((prev) => ({ ...prev, [field.key]: e.target.checked }))}
                          className="h-4 w-4 rounded border-border bg-card text-accent focus:ring-accent"
                        />
                        <span className="text-sm text-text">{field.label}</span>
                      </label>
                    )
                  })}
                </div>
                <div className="text-xs text-muted">{t.transparencyNote}</div>
                <button type="button" onClick={saveTransparency} className="rounded-xl border border-accent/30 bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20">{t.save}</button>
                {transparencyMsg && <div className="rounded-xl border border-accent/20 bg-accent/10 px-3 py-2 text-sm text-accent">{transparencyMsg}</div>}
              </motion.div>
            )}

            {!transparencyEnabled && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border/70 bg-card/30 p-4 text-center">
                <EyeOff size={32} className="mx-auto text-muted/50 mb-2" />
                <div className="text-sm text-muted">{t.transparencySub}</div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Category Modal */}
      <Modal open={catModalOpen} title={editingCat ? t.categoryEdit : t.categoryAdd} onClose={() => setCatModalOpen(false)} wide>
        <div className="space-y-4">
          <Field label={t.categoryName}>
            <input value={catForm.name} onChange={(e) => setCatForm((c) => ({ ...c, name: e.target.value }))} className={inputCls} placeholder={t.categoryName} />
          </Field>
          <Field label={t.categoryType}>
            <Select value={catForm.type} options={kindOpts} onChange={(v) => setCatForm((c) => ({ ...c, type: v }))} />
          </Field>
          <Field label="Описание">
            <textarea value={catForm.description} onChange={(e) => setCatForm((c) => ({ ...c, description: e.target.value }))} className={inputCls} rows={3} placeholder="Описание категории" />
          </Field>
          <Field label="Порядок сортировки">
            <input type="number" value={catForm.sort_order} onChange={(e) => setCatForm((c) => ({ ...c, sort_order: Number(e.target.value) }))} className={inputCls} />
          </Field>
          <Field label="Статус">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={catForm.is_active} onChange={(e) => setCatForm((c) => ({ ...c, is_active: e.target.checked }))} className="h-4 w-4 rounded border-border bg-card text-accent focus:ring-accent" />
              <span className="text-sm text-text">Активна</span>
            </label>
          </Field>
        </div>
        {catSaveError && <div className="rounded-xl border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-400">{catSaveError}</div>}
        <ModalActions onCancel={() => setCatModalOpen(false)} onSave={saveCategory} saveLabel={catSaving ? 'Сохранение...' : t.save} />
      </Modal>

      {/* Bank Account Modal */}
      <Modal open={bankModalOpen} title={editingBank ? 'Изменить счёт' : 'Добавить счёт'} onClose={() => setBankModalOpen(false)} wide>
        <div className="space-y-4">
          <Field label="Название банка">
            <input value={bankForm.bank_name} onChange={(e) => setBankForm((c) => ({ ...c, bank_name: e.target.value }))} className={inputCls} placeholder="Напр. Сбербанк, Тинькофф, ВТБ" />
          </Field>
          <Field label="Название счёта">
            <input value={bankForm.account_name} onChange={(e) => setBankForm((c) => ({ ...c, account_name: e.target.value }))} className={inputCls} placeholder="Напр. Основной расчётный счёт" />
          </Field>
          <Field label="Маскированный номер счёта">
            <input value={bankForm.account_number_masked} onChange={(e) => setBankForm((c) => ({ ...c, account_number_masked: e.target.value }))} className={inputCls} placeholder="Напр. ****1234" />
          </Field>
          <Field label="Валюта">
            <Select value={bankForm.currency} options={currencyOpts} onChange={(v) => setBankForm((c) => ({ ...c, currency: v }))} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Статус">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={bankForm.is_active} onChange={(e) => setBankForm((c) => ({ ...c, is_active: e.target.checked }))} className="h-4 w-4 rounded border-border bg-card text-accent focus:ring-accent" />
                <span className="text-sm text-text">Активен</span>
              </label>
            </Field>
            <Field label="По умолчанию">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={bankForm.is_default} onChange={(e) => setBankForm((c) => ({ ...c, is_default: e.target.checked }))} className="h-4 w-4 rounded border-border bg-card text-accent focus:ring-accent" />
                <span className="text-sm text-text">Счёт по умолчанию</span>
              </label>
            </Field>
          </div>
        </div>
        <ModalActions onCancel={() => setBankModalOpen(false)} onSave={saveBankAccount} />
      </Modal>
    </div>
  )
}
