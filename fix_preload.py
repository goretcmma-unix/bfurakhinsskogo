// add sberSync to api
const api = {
  openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (defaultPath: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveFile', defaultPath),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  sberSync: (): Promise<any> => ipcRenderer.invoke('sber:sync', { accountNumber: '40702810338000001464', fromDate: '2022-06-01', toDate: '2022-06-01' }),
  platform: process.platform
}
