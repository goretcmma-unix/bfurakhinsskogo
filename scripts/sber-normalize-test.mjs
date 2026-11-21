#!/usr/bin/env node
/**
 * Автотест нормализации транзакций — без обращения к банку.
 * Проверяет: определение входящих/исходящих, дедупликацию, маскирование ПДн,
 * расчёт суммы поступлений.
 *
 * Запуск: node scripts/sber-normalize-test.mjs
 */

import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { normalizeTransactions, sumIncomingByCurrency } = require(join(root, 'out', 'main', 'sber-api', 'index.js'))

const ops = [
  {
    id: 'OP-1',
    date: '2026-01-15',
    amount: 5000,
    currency: 'RUB',
    direction: 'credit',
    payerName: 'Иванов Иван Иванович',
    payerAccount: '40817810099910004312',
    purpose: 'Пожертвование'
  },
  {
    id: 'OP-2',
    date: '2026-01-16',
    amount: -1200,
    currency: 'RUB',
    direction: 'debit',
    counterpartyName: 'ООО Ромашка',
    purpose: 'Оплата услуг'
  },
  {
    id: 'OP-3',
    date: '17.01.2026',
    amount: '2 500,50',
    currency: 'rub',
    direction: 'incoming',
    counterpartyName: 'ООО Добро',
    inn: '7701234567'
  },
  // Дубль OP-1 — должен быть отброшен
  { id: 'OP-1', date: '2026-01-15', amount: 5000, currency: 'RUB', direction: 'credit' },
  // Мусор без даты — отброшен
  { id: 'OP-X', amount: 100, currency: 'RUB' }
]

const { private: priv, public: pub, rejected, duplicates } = normalizeTransactions(ops, '40817810099910004312')

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '[OK] ' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!cond) failures++
}

check('Всего приватных записей', priv.length === 3, `получено ${priv.length}`)
check('Отброшены некорректные', rejected === 1, `отброшено ${rejected}`)
check('Дубль отсечён при нормализации', duplicates === 1, `дублей ${duplicates}`)
check('Входящих публичных', pub.length === 2, `получено ${pub.length}`)
check('Исходящая не опубликована', !pub.some((p) => p.externalId.includes('OP-2')))
check('Переименовано входящее OP-2 → outgoing', priv.find((p) => p.bankId === 'OP-2')?.direction === 'outgoing')
check('Копейки корректны (2500.50)', pub.find((p) => p.externalId === 'sber:OP-3')?.amount === 2500.5)
check('Валюта приведена к RUB', pub.find((p) => p.externalId === 'sber:OP-3')?.currency === 'RUB')
check('Дата DD.MM.YYYY сконвертирована', pub.find((p) => p.externalId === 'sber:OP-3')?.date === '2026-01-17')

// ПДн: в публичном наборе НЕ должно быть имён/счетов
const publicJson = JSON.stringify(pub)
check('Нет ФИО в публичных данных', !publicJson.includes('Иванов'))
check('Нет ФИО в публичных данных (ООО)', !publicJson.includes('Добро'))
check('Нет номеров счетов в публичных', !publicJson.includes('40817810099910004312'))
check('Нет ИНН в публичных данных', !publicJson.includes('7701234567'))

const totals = sumIncomingByCurrency(pub)
check('Сумма поступлений RUB', totals.RUB === 7500.5, `получено ${JSON.stringify(totals)}`)

// Дедупликация по externalId
const ids = pub.map((p) => p.externalId)
check('Нет дублей в публичном наборе', new Set(ids).size === ids.length, `${ids.length} записей, ${new Set(ids).size} уникальных`)

console.log('')
console.log(`Публичная запись (пример): ${JSON.stringify(pub[0])}`)
console.log(failures === 0 ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `\nПРОВАЛЕНО ПРОВЕРОК: ${failures}`)
process.exit(failures === 0 ? 0 : 1)
