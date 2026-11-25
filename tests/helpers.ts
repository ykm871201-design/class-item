import type { Student } from '../src/shared/types';
export function makeStudents(n: number, names?: string[]): Student[] {
  return Array.from({ length: n }, (_, i) => ({ id: `id${i + 1}`, number: i + 1, name: names?.[i] ?? `학생${i + 1}`, absentDate: null, excluded: false }));
}
export const TODAY = '2026-11-25';
