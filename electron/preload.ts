import { contextBridge, ipcRenderer } from 'electron'

const api = {
  openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (defaultPath: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveFile', defaultPath),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  sberSync: (query?: { accountNumber?: string; fromDate?: string; toDate?: string }): Promise<any> =>
    ipcRenderer.invoke('sber:sync', query ?? {}),
  /** Перенос операций Sber API из стейджа в основную таблицу transactions (с защитой от дублей). */
  sberSyncToDb: (): Promise<any> => ipcRenderer.invoke('sber:sync-to-db'),
  /** Ручной запуск автосинхронизации Sber API → Supabase (курсор/окно/запись в БД). */
  sberSyncNow: (): Promise<any> => ipcRenderer.invoke('sber:sync-now'),
  /** Статус автосинхронизации: курсор, последний прогон, токен, интервал. */
  sberSyncStatus: (): Promise<any> => ipcRenderer.invoke('sber:sync-status'),
  /** Журнал последних прогонов синхронизации. */
  sberSyncJournal: (limit?: number): Promise<any> => ipcRenderer.invoke('sber:sync-journal', limit),
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)

export type AppApi = typeof api
