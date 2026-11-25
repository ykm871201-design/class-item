// 학생 화면은 표시용 데이터 구독만 가능 (교사용 동작·설정에 접근 불가)
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('studentApi', {
  getView: () => ipcRenderer.invoke('student:getView'),
  escape: () => ipcRenderer.invoke('student:escape'),
  onView: (cb: (v: unknown) => void) => {
    const h = (_e: unknown, v: unknown) => cb(v);
    ipcRenderer.on('student:view', h);
    return () => ipcRenderer.removeListener('student:view', h);
  },
});
