import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  dispatch: (action: unknown) => ipcRenderer.invoke('dispatch', action),
  app: (action: unknown) => ipcRenderer.invoke('app', action),
  confirm: (opts: { message: string; detail?: string; ok?: string; cancel?: string }) => ipcRenderer.invoke('dialog:confirm', opts),
  onState: (cb: (s: unknown) => void) => {
    const h = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on('state', h);
    return () => ipcRenderer.removeListener('state', h);
  },
  onNav: (cb: (tab: string) => void) => {
    const h = (_e: unknown, t: string) => cb(t);
    ipcRenderer.on('nav', h);
    return () => ipcRenderer.removeListener('nav', h);
  },
  onSound: (cb: (p: unknown) => void) => {
    const h = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on('sound:play', h);
    return () => ipcRenderer.removeListener('sound:play', h);
  },
});
