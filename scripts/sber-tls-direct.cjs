// Прямая TLS-проверка клиента с сертификатом (без модуля приложения)
const fs = require('fs')
const tls = require('tls')

// .env в UTF-8 без BOM
const envText = fs.readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8').replace(/^\uFEFF/, '')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_]+)=(.*)$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim()
}

const pfxPath = process.env.SBER_P12_PATH
console.log('Сертификат:', pfxPath, '| существует:', fs.existsSync(pfxPath))

const sock = tls.connect({
  host: 'fintech-test.sberbank.ru',
  port: 9443,
  pfx: fs.readFileSync(pfxPath),
  passphrase: process.env.SBER_P12_PASSWORD,
  rejectUnauthorized: false
}, () => {
  console.log('TLS OK, протокол:', sock.getProtocol())
  const cert = sock.getPeerCertificate()
  console.log('Сервер (subject CN):', cert.subject && cert.subject.CN)
  console.log('Клиентский сертификат отправлен: да (pfx без ошибок)')
  console.log('\n=== ВЫВОД: TLS-рукопожатие с вашим .p12 ПРОШЛО ===')
  sock.end()
})

sock.on('error', (e) => {
  console.log('TLS ERR:', e.message)
  if (/unknown p12/i.test(e.message)) {
    console.log('\nВЫВОД: пароль от .p12 НЕ ПОДХОДИТ — файл не расшифровывается.')
    console.log('Проверьте SBER_P12_PASSWORD в .env (из письма Сбера).')
  }
})
