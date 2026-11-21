/**
 * HTTP-клиент Sber API с mTLS (клиентский PKCS#12 сертификат).
 *
 * Без внешних зависимостей: только встроенный модуль node:https.
 * Секреты (пароль сертификата) не логируются и не возвращаются наружу.
 */

import https from 'https'
import { promises as fs } from 'fs'
import { sberLog } from './logger'

export interface TlsOptions {
  p12Path: string
  p12Password: string
  caPath?: string
  allowInvalidServerCert?: boolean
}

export interface HttpResult {
  status: number
  ok: boolean
  headers: Record<string, string | string[] | undefined>
  /** Разобранный JSON, если ответ — JSON. */
  json: unknown
  /** Текст ответа (уже усечён). */
  text: string
}

export interface HttpRequest {
  method: 'GET' | 'POST'
  url: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export class SberHttpError extends Error {
  readonly code: string
  readonly status?: number

  constructor(code: string, message: string, status?: number) {
    super(message)
    this.name = 'SberHttpError'
    this.code = code
    this.status = status
  }
}

let cachedAgent: https.Agent | null = null
let cachedAgentKey = ''

async function buildAgent(tls: TlsOptions): Promise<https.Agent> {
  const key = `${tls.p12Path}|${tls.p12Password.length}|${tls.caPath ?? ''}|${Boolean(tls.allowInvalidServerCert)}`
  if (cachedAgent && cachedAgentKey === key) return cachedAgent

  let pfx: Buffer
  try {
    pfx = await fs.readFile(tls.p12Path)
  } catch {
    throw new SberHttpError(
      'TLS_P12_MISSING',
      `Не найден клиентский сертификат (.p12) по пути из SBER_P12_PATH.`
    )
  }

   const rootCAs: Buffer[] = []
  let extraCAs: (Buffer | string)[] = []
  if (tls.caPath) {
    try {
      const raw = await fs.readFile(tls.caPath, 'utf8')
      const blocks = raw.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || []
      extraCAs = blocks.map((b) => Buffer.from(b))
      if (!extraCAs.length) {
        extraCAs = [Buffer.from(raw)]
      }
    } catch {
      sberLog.warn('CA-���������� �� SBER_CA_PATH �� ������ � ������������ �����')
    }
  }
  const caList = [...rootCAs, ...extraCAs]

  const agent = new https.Agent({
    pfx,
    passphrase: tls.p12Password,
    ca: caList,
    rejectUnauthorized: !tls.allowInvalidServerCert,
    keepAlive: true,
    maxSockets: 4
  })

  cachedAgent = agent
  cachedAgentKey = key
  sberLog.info('TLS-агент создан с клиентским сертификатом')
  return agent
}

export async function sberRequest(tls: TlsOptions, req: HttpRequest): Promise<HttpResult> {
  const url = new URL(req.url)
  if (url.protocol !== 'https:') {
    throw new SberHttpError('BAD_URL', 'Разрешены только https-адреса Sber API.')
  }

  const agent = await buildAgent(tls)
  const timeoutMs = req.timeoutMs ?? 20_000

  return new Promise<HttpResult>((resolve, reject) => {
    const request = https.request(
      {
        method: req.method,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        agent,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'DashboardCharity-SberModule/0.1',
          ...(req.body ? { 'Content-Type': 'application/json' } : {}),
          ...req.headers
        },
        timeout: timeoutMs
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (c: Buffer) => chunks.push(c))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json: unknown = null
          try {
            json = text ? JSON.parse(text) : null
          } catch {
            json = null
          }
          const status = response.statusCode ?? 0
          resolve({
            status,
            ok: status >= 200 && status < 300,
            headers: response.headers,
            json,
            text: text.slice(0, 4000)
          })
        })
      }
    )

    request.on('timeout', () => {
      request.destroy(new SberHttpError('TIMEOUT', `Превышено время ожидания ${timeoutMs} мс.`))
    })

     request.on('error', (err: NodeJS.ErrnoException) => {
       // ��������� TLS-������ Node ������ �������� � ��������� ������ ����.
       const code = err.code ?? 'NETWORK_ERROR'
       let message = '�� ������� ��������� ������ � Sber API.'
       if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
         message = '����� Sber API ���������� (DNS). ��������� SBER_*_BASE_URL.'
       } else if (code === 'ECONNREFUSED') {
         message = '���������� ���������. ��������� ����� � ���� Sber API.'
       } else if (code.includes('CERT') || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
         message =
           '������ TLS-�����������. ��������� SBER_P12_PATH/SBER_P12_PASSWORD � SBER_CA_PATH; ' +
           '��� ������� ����� �������� �������� SBER_ALLOW_INVALID_SERVER_CERT.'
       } else if (err instanceof SberHttpError) {
         message = err.message
       }
       // ���������� ���������� ���������� ����� ������ ������
       const detail = err.message ? ` [${code}] ${err.message}` : ` [${code}]`
       reject(new SberHttpError(code, message + detail))
    })

    if (req.body) request.write(req.body)
    request.end()
  })
}

/** Единый вид ошибки Bank API: понятный код + текст без секретов. */
export function describeHttpFailure(result: HttpResult): { code: string; message: string } {
  const body = (result.json ?? {}) as Record<string, unknown>
  const bankCode =
    (body.error as string) ??
    (body.error_code as string) ??
    (body.code as string) ??
    undefined
  const bankMessage =
    (body.error_description as string) ??
    (body.message as string) ??
    (typeof body.errors === 'object' ? JSON.stringify(body.errors).slice(0, 300) : undefined)

  const map: Record<number, string> = {
    400: 'Некорректный запрос: проверьте параметры и scope.',
    401: 'Не авторизован: access token отсутствует, истёк или недействителен.',
    403: 'Доступ запрещён: у токена нет нужного scope либо сертификат не принят.',
    404: 'Метод не найден: проверьте адрес endpoint в настройках.',
    429: 'Слишком много запросов: повторите позже.',
    500: 'Внутренняя ошибка на стороне банка.',
    502: 'Банк временно недоступен (bad gateway).',
    503: 'Сервис банка временно недоступен.'
  }

  const code = bankCode ?? `HTTP_${result.status}`
  const message = map[result.status] ?? 'Запрос завершился ошибкой.'
  return {
    code,
    message: bankMessage ? `${message} Детали банка: ${String(bankMessage).slice(0, 300)}` : message
  }
}
