// Точечная починка .env: путь к сертификату с пробелами — только через Node
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env')
let txt = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '')

const certPath = 'C:\\Users\\goret\\OneDrive\\Рабочий стол\\Dashboard Charity\\certificates\\SBBAPI_98893_9e8c3b8c-8c7f-4469-96a5-60e709255785.p12'
const caPath = 'C:\\Users\\goret\\OneDrive\\Рабочий стол\\Dashboard Charity\\certificates\\prom-certs\\russian_trusted_root_ca_pem.crt'

const lines = txt.split(/\r?\n/)
let sawP12 = false, sawCa = false
const out = lines.map(line => {
  if (line.startsWith('SBER_P12_PATH=')) { sawP12 = true; return 'SBER_P12_PATH=' + certPath }
  if (line.startsWith('SBER_CA_PATH=')) { sawCa = true; return 'SBER_CA_PATH=' + caPath }
  return line
})

fs.writeFileSync(envPath, out.join('\n'), 'utf8')

// Контроль
const check = fs.readFileSync(envPath, 'utf8')
const p12 = check.split(/\r?\n/).find(l => l.startsWith('SBER_P12_PATH='))
const ca = check.split(/\r?\n/).find(l => l.startsWith('SBER_CA_PATH='))
console.log('P12 строка:', JSON.stringify(p12))
console.log('CA строка:', JSON.stringify(ca ? ca.slice(0, 60) + '...' : 'ОТСУТСТВУЕТ'))
console.log('P12 существует:', fs.existsSync(p12.split('=').slice(1).join('=')))
console.log('CA существует:', fs.existsSync(ca.split('=').slice(1).join('=')))
