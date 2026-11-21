// Тест нормализации на ТОЧНОМ реальном ответе Sber Sandbox (копия JSON из /sber-test)
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { normalizeTransactions } = await import(
  'file://' + join(root, 'out', 'main', 'sber-api', 'index.js').replaceAll('\\', '/')
)

// Дословно из ответа Sandbox (statement/transactions)
const sandboxReal = [
  {
    "amount": { "amount": "6.00", "currencyName": "RUR" },
    "amountRub": { "amount": "6.00", "currencyName": "RUR" },
    "correspondingAccount": "40702810638000021209",
    "direction": "DEBIT",
    "documentDate": "2022-06-01",
    "number": "5554",
    "operationCode": "01",
    "operationDate": "2022-06-01T17:07:19",
    "paymentPurpose": "НДС не облагается. Тестовый",
    "priority": "5",
    "uuid": "703a6050-3ce6-4fae-ae73-8ca40689f9a9",
    "rurTransfer": {
      "deliveryKind": "электронно",
      "payeeAccount": "40702810638000021209",
      "payeeBankBic": "044525225",
      "payeeInn": "1096958844",
      "payeeName": "ООО Русская псовая борзая",
      "payerAccount": "40702810338000001464",
      "payerBankBic": "044525225",
      "payerInn": "3016007800",
      "payerName": "УГАНДАСТАИЛ",
      "receiptDate": "2022-06-01",
      "valueDate": "2022-06-01"
    },
    "hashAbc": "71009131619248373850fe4963f",
    "operationId": "0fe4963f-4d59-4099-9ad1-ceaf39d91e32"
  },
  {
    "amount": { "amount": "150000.00", "currencyName": "RUR" },
    "amountRub": { "amount": "150000.00", "currencyName": "RUR" },
    "correspondingAccount": "40817810000012345678",
    "direction": "CREDIT",
    "documentDate": "2022-06-02",
    "number": "5555",
    "operationDate": "2022-06-02T10:15:00",
    "paymentPurpose": "Благотворительное пожертвование",
    "uuid": "aa11bbbb-22cc-33dd-44ee-55ff66778899",
    "operationId": "aa11bbbb-22cc-33dd-44ee-55ff66778899",
    "rurTransfer": {
      "payeeAccount": "40702810338000001464",
      "payeeBankBic": "044525225",
      "payeeName": "ФОНД ИМЕНИ АБДУЛЛАХАЖИ УРАХИНСКОГО",
      "payerAccount": "40817810000012345678",
      "payerName": "Иванов Иван Иванович"
    }
  }
]

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '[OK] ' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!cond) failures++
}

const { private: priv, public: pub, rejected } = normalizeTransactions(sandboxReal, '40702810338000001464')

console.log(`private=${priv.length}, public=${pub.length}, rejected=${rejected}\n`)
for (const p of priv) {
  console.log(`  [${p.direction}] ${p.operationDate} | ${p.amountMinor / 100} ₽ | id=${p.bankId?.slice(0, 13)}… | ${p.counterpartyName?.slice(0, 30)}`)
}
console.log('')

const debit = priv.find(p => p.bankId === '0fe4963f-4d59-4099-9ad1-ceaf39d91e32')
const credit = priv.find(p => p.bankId === 'aa11bbbb-22cc-33dd-44ee-55ff66778899')

check('DEBIT → outgoing', debit?.direction === 'outgoing', debit?.direction)
check('CREDIT → incoming', credit?.direction === 'incoming', credit?.direction)

check('Сумма DEBIT = 6.00 ₽ (строка из Sandbox)', debit?.amountMinor === 600, `minor=${debit?.amountMinor}`)
check('Сумма CREDIT = 150000.00 ₽', credit?.amountMinor === 15000000, `minor=${credit?.amountMinor}`)
check('RUR → RUB', debit?.currency === 'RUB', debit?.currency)
check('operationDate → YYYY-MM-DD', debit?.operationDate === '2022-06-01', debit?.operationDate)
check('paymentPurpose прочитан', debit?.purpose === 'НДС не облагается. Тестовый', debit?.purpose)

// rurTransfer слился наверх: контрагенты по направлению
check('DEBIT: контрагент = payeeName (ООО…)', debit?.counterpartyName === 'ООО Русская псовая борзая', debit?.counterpartyName)
check('DEBIT: счёт контрагента = payeeAccount', debit?.counterpartyAccount === '40702810638000021209', debit?.counterpartyAccount)
check('DEBIT: ИНН контрагента из rurTransfer', debit?.counterpartyInn === '1096958844', debit?.counterpartyInn)
check('CREDIT: контрагент = payerName (физлицо)', credit?.counterpartyName === 'Иванов Иван Иванович', credit?.counterpartyName)

// Публикуем только входящие
check('public: только CREDIT', pub.length === 1, `len=${pub.length}`)
check('public: без ФИО/счетов', !JSON.stringify(pub).includes('Иванов') && !JSON.stringify(pub).includes('40817'))

console.log('')
console.log(failures === 0 ? 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `ПРОВАЛЕНО: ${failures}`)
process.exit(failures === 0 ? 0 : 1)
