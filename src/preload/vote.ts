// 투표 전용 창: 후보·투표 기회 받기, 제출, 교사 메뉴(PIN)만 가능 (교사용 동작·집계에 접근 불가)
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('voteApi', {
  getView: () => ipcRenderer.invoke('vote:getView'),
  submit: (p: { token: string; choices: string[]; abstain: boolean }) => ipcRenderer.invoke('vote:submit', p),
  unlock: (pin: string) => ipcRenderer.invoke('vote:unlock', pin),
  admin: (action: string) => ipcRenderer.invoke('vote:admin', action),
  onView: (cb: (v: unknown) => void) => {
    const h = (_e: unknown, v: unknown) => cb(v);
    ipcRenderer.on('vote:view', h);
    return () => ipcRenderer.removeListener('vote:view', h);
  },
  onTeacherKey: (cb: () => void) => {
    const h = () => cb();
    ipcRenderer.on('vote:teacherKey', h);
    return () => ipcRenderer.removeListener('vote:teacherKey', h);
  },
});
