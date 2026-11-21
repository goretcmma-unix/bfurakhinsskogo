/// <reference types="vite/client" />

export {}
declare global {
  interface Window {
    api?: {
      openFile: () => Promise<string | null>
      saveFile: (defaultPath: string) => Promise<string | null>
      openExternal: (url: string) => Promise<void>
      sberSync: () => Promise<any>
      sberSyncToDb: () => Promise<any>
      platform: string
    }
  }
}