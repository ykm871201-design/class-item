import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import type { StudentView } from '../../shared/types';
import { StudentScreen } from '../common/StudentScreen';

declare global {
  interface Window {
    studentApi: { getView(): Promise<StudentView>; onView(cb: (v: StudentView) => void): () => void; escape(): Promise<boolean> };
  }
}

function App() {
  const [view, setView] = useState<StudentView | null>(null);
  useEffect(() => {
    window.studentApi.getView().then(setView);
    return window.studentApi.onView(setView);
  }, []);
  if (!view) return <div className="st-root" />;
  return <StudentScreen view={view} />;
}

// Esc: 교사용 화면과 같은 모니터일 때 학생 화면 숨기기 (판단은 메인 프로세스에서)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.studentApi.escape();
});

// 마우스를 2초 동안 움직이지 않으면 커서를 숨긴다 (TV에서는 보이지 않게, 모니터 1대일 때는 움직이면 다시 보이게)
let cursorTimer: number | undefined;
const hideCursorSoon = () => {
  document.body.classList.remove('hide-cursor');
  window.clearTimeout(cursorTimer);
  cursorTimer = window.setTimeout(() => document.body.classList.add('hide-cursor'), 2000);
};
window.addEventListener('mousemove', hideCursorSoon);
hideCursorSoon();

createRoot(document.getElementById('root')!).render(<App />);
