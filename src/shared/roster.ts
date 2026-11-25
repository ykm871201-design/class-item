// 학생 명단: 붙여넣기 해석, 일괄 등록, 표시 이름, 결석/제외 판정
import type { Student } from './types';
import { newId } from './util';

export const MAX_STUDENTS = 30;
export const MIN_STUDENTS = 5;

export interface RosterEntry {
  number: number | null;
  name: string;
}

export interface ParseResult {
  entries: RosterEntry[];
  skipped: string[]; // 해석하지 못한 줄
}

const HEADER_WORDS = /^(번호|이름|성명|학생|no\.?|name|순번|출석번호)$/i;

/**
 * 엑셀에서 복사한 "번호<탭>이름" 목록 또는 줄바꿈으로 구분한 이름 목록을 해석한다.
 * 지원 예: "1\t김민준", "1 김민준", "1. 김민준", "1,김민준", "김민준"
 */
export function parseRosterText(text: string): ParseResult {
  const entries: RosterEntry[] = [];
  const skipped: string[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (const raw of lines) {
    const line = raw.replace(/ /g, ' ').trim();
    if (!line) continue;
    let cells: string[];
    if (line.includes('\t')) cells = line.split('\t');
    else if (line.includes(',')) cells = line.split(',');
    else {
      const m = line.match(/^(\d{1,3})\s*[.)번:-]?\s+(.+)$/) || line.match(/^(\d{1,3})[.)번:-]\s*(.+)$/);
      cells = m ? [m[1], m[2]] : [line];
    }
    cells = cells.map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length === 0) continue;
    if (cells.every((c) => HEADER_WORDS.test(c))) continue; // 머리글 줄
    let num: number | null = null;
    let name: string | null = null;
    for (const c of cells) {
      const cleaned = c.replace(/번$/, '');
      if (num === null && name === null && /^\d{1,3}$/.test(cleaned)) {
        num = parseInt(cleaned, 10);
        continue;
      }
      if (name === null && !/^\d+$/.test(c)) {
        name = c;
        break;
      }
    }
    if (!name) {
      skipped.push(raw);
      continue;
    }
    if (name.length > 20) name = name.slice(0, 20);
    entries.push({ number: num, name });
  }
  return { entries, skipped };
}

export interface MergeResult {
  students: Student[];
  added: number;
  errors: string[];
}

/**
 * 해석한 목록을 기존 명단에 반영한다.
 * - append: 기존 명단 뒤에 추가 (번호가 없으면 마지막 번호 다음부터 자동 부여)
 * - replace: 명단 교체. 번호와 이름이 모두 같은 학생은 기존 ID를 유지한다.
 */
export function mergeRoster(existing: Student[], entries: RosterEntry[], mode: 'append' | 'replace'): MergeResult {
  const errors: string[] = [];
  const base = mode === 'append' ? existing.slice() : [];
  const used = new Set(base.map((s) => s.number));
  let nextNum = base.reduce((m, s) => Math.max(m, s.number), 0) + 1;
  const reusable = mode === 'replace' ? existing.slice() : [];
  let added = 0;
  for (const e of entries) {
    if (base.length >= MAX_STUDENTS) {
      errors.push(`한 학급에는 최대 ${MAX_STUDENTS}명까지 등록할 수 있어 '${e.name}' 이후 학생은 추가하지 않았습니다.`);
      break;
    }
    let num = e.number;
    if (num === null) {
      while (used.has(nextNum)) nextNum++;
      num = nextNum++;
    } else if (used.has(num)) {
      errors.push(`${num}번이 이미 있어 '${e.name}' 학생은 추가하지 않았습니다.`);
      continue;
    }
    if (num < 1 || num > 999) {
      errors.push(`'${e.name}' 학생의 번호(${num})가 올바르지 않습니다.`);
      continue;
    }
    used.add(num);
    nextNum = Math.max(nextNum, num + 1);
    const idx = reusable.findIndex((s) => s.number === num && s.name === e.name);
    if (idx >= 0) {
      base.push(reusable[idx]);
      reusable.splice(idx, 1);
    } else {
      base.push({ id: newId('s_'), number: num, name: e.name, absentDate: null, excluded: false });
    }
    added++;
  }
  base.sort((a, b) => a.number - b.number);
  return { students: base, added, errors };
}

/** 동명이인은 번호를 붙여 구분한 표시 이름 */
export function displayNames(students: Student[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const s of students) count.set(s.name, (count.get(s.name) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const s of students) out.set(s.id, (count.get(s.name) ?? 0) > 1 ? `${s.name}(${s.number})` : s.name);
  return out;
}

/** 오늘 결석이거나 일시 제외인지 */
export function isAway(s: Student, today: string): boolean {
  return !!s.excluded || s.absentDate === today;
}

export function awayLabel(s: Student, today: string): string | null {
  if (s.absentDate === today) return '결석';
  if (s.excluded) return '일시 제외';
  return null;
}
