/**
 * Защищённое локальное хранение токенов и сертификата.
 *
 * Хранение: каталог userData приложения (НЕ в репозитории, НЕ в public-site).
 *   <userData>/sber-secrets/      — копия .p12 (права 0600) и tokens.json (0600)
 *
 * Шифрование токенов: AES-256-GCM. Ключ выводится (scrypt) из пароля хранилища —
 * он берётся из SBER_STORE_PASSPHRASE. Пароль НЕ хранится на диске.
 * Если пароль не задан, токены не сохраняются на диск вообще (только в памяти).
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { randomBytes, createCipheriv, createDecipheriv, scrypt } from 'crypto'
import { promisify } from 'util'
import { sberLog } from './logger'

const scryptAsync = promisify(scrypt)

export type TokenSource = 'oauth' | 'manual' | 'unknown'

export interface TokenPair {
  accessToken: string
  refreshToken: string
  /** UNIX-время в мс, когда истекает access token (если известно). */
  expiresAt: number | null
  /** UNIX-время в мс, когда истекает refresh token (если известно). */
  refreshExpiresAt: number | null
  /** Откуда получен срок действия: из ответа OAuth, из поля в ЛК или неизвестен. */
  expirySource: TokenSource
  /** Отпечаток токена — позволяет заметить «токен протух раньше срока». */
  accessTokenMarker: string | null
  /** Время последнего подтверждённого отказа (401) от банка. */
  lastRejectedAt: number | null
  scope: string
  savedAt: number
}

interface EncryptedEnvelope {
  v: 1
  alg: 'aes-256-gcm'
  salt: string
  iv: string
  tag: string
  data: string
}

const SALT_LEN = 16
const IV_LEN = 12

export class SecureStore {
  private readonly dir: string
  private memory: TokenPair | null = null

  constructor(userDataDir: string) {
    this.dir = join(userDataDir, 'sber-secrets')
  }

  private get tokensFile(): string {
    return join(this.dir, 'tokens.json')
  }

  private get passphrase(): string {
    return process.env.SBER_STORE_PASSPHRASE ?? ''
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 })
  }

  private async deriveKey(salt: Buffer): Promise<Buffer> {
    return (await scryptAsync(this.passphrase, salt, 32)) as Buffer
  }

  /**
   * Импорт клиентского сертификата из исходного файла в хранилище.
   * Возвращает путь к копии. Сам сертификат не логируется.
   */
  async importCertificate(sourcePath: string): Promise<string> {
    await this.ensureDir()
    const data = await fs.readFile(sourcePath)
    const target = join(this.dir, 'client.p12')
    await fs.writeFile(target, data, { mode: 0o600 })
    sberLog.info('Клиентский сертификат скопирован в защищённое хранилище', {
      bytes: data.length,
      target: 'client.p12'
    })
    return target
  }

  /** Сохранить пару токенов. Если пароль хранилища не задан — только в память. */
  async saveTokens(pair: TokenPair): Promise<{ persisted: boolean }> {
    this.memory = pair
    if (!this.passphrase) {
      sberLog.warn('SBER_STORE_PASSPHRASE не задан: токены сохранены только в памяти')
      return { persisted: false }
    }

    await this.ensureDir()
    const salt = randomBytes(SALT_LEN)
    const iv = randomBytes(IV_LEN)
    const key = await this.deriveKey(salt)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const plaintext = Buffer.from(JSON.stringify(pair), 'utf8')
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()

    const envelope: EncryptedEnvelope = {
      v: 1,
      alg: 'aes-256-gcm',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: ciphertext.toString('base64')
    }

    await fs.writeFile(this.tokensFile, JSON.stringify(envelope), { mode: 0o600 })
    sberLog.info('Пара токенов сохранена (зашифровано)')
    return { persisted: true }
  }

  /** Загрузить токены (из памяти, иначе с диска и расшифровать). */
  async loadTokens(): Promise<TokenPair | null> {
    if (this.memory) return this.memory
    if (!this.passphrase) return null

    let raw: string
    try {
      raw = await fs.readFile(this.tokensFile, 'utf8')
    } catch {
      return null
    }

    try {
      const env = JSON.parse(raw) as EncryptedEnvelope
      if (env.v !== 1 || env.alg !== 'aes-256-gcm') throw new Error('unsupported format')
      const salt = Buffer.from(env.salt, 'base64')
      const iv = Buffer.from(env.iv, 'base64')
      const tag = Buffer.from(env.tag, 'base64')
      const key = await this.deriveKey(salt)
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      const plain = Buffer.concat([
        decipher.update(Buffer.from(env.data, 'base64')),
        decipher.final()
      ])
      this.memory = JSON.parse(plain.toString('utf8')) as TokenPair
      return this.memory
    } catch (e) {
      // Неверный пароль или повреждённый файл — токены требуют обновления.
      sberLog.warn('Не удалось расшифровать сохранённые токены', {
        reason: e instanceof Error ? e.message : 'unknown'
      })
      return null
    }
  }

  async clearTokens(): Promise<void> {
    this.memory = null
    try {
      await fs.unlink(this.tokensFile)
      sberLog.info('Сохранённые токены удалены')
    } catch {
      /* файла нет — ничего делать не нужно */
    }
  }

  /** Безопасная сводка для UI: без самих токенов. */
  async describe(): Promise<Record<string, unknown>> {
    const pair = await this.loadTokens()
    if (!pair) return { hasTokens: false }
    return {
      hasTokens: true,
      hasRefreshToken: Boolean(pair.refreshToken),
      accessExpiresAt: pair.expiresAt ? new Date(pair.expiresAt).toISOString() : null,
      refreshExpiresAt: pair.refreshExpiresAt
        ? new Date(pair.refreshExpiresAt).toISOString()
        : null,
      scope: pair.scope,
      savedAt: new Date(pair.savedAt).toISOString()
    }
  }
}
