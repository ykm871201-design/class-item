import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import type { StudentView } from '../../shared/types';
import { StudentScreen } from '../common/StudentScreen';

declare global {
  interface Window {
    studentApi: { getView(): Promise<StudentView>; onView(cb: (v: StudentView) => void): () => void };
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

createRoot(document.getElementById('root')!).render(<App />);
