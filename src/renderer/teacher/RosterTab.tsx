import { useEffect, useMemo, useState } from 'react';
import type { Student } from '../../shared/types';
import { MAX_STUDENTS, MIN_STUDENTS, parseRosterText } from '../../shared/roster';
import { localDateKey } from '../../shared/util';
import { act, api, toast, useAppState } from './api';

export function RosterTab() {
  const { data, runtime } = useAppState();
  const cls = data.classes.find((c) => c.id === data.currentClassId)!;
  const today = localDateKey(runtime.now);
  const [newClass, setNewClass] = useState('');
  const [rename, setRename] = useState<string | null>(null);
  const [bulk, setBulk] = useState('');
  const [num, setNum] = useState('');
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'' | 'M' | 'F'>('');
  const parsed = useMemo(() => parseRosterText(bulk), [bulk]);
  const dupNames = useMemo(() => {
    const m = new Map<string, number>();
    cls.students.forEach((s) => m.set(s.name, (m.get(s.name) ?? 0) + 1));
    return new Set([...m].filter(([, n]) => n > 1).map(([k]) => k));
  }, [cls.students]);

  const doImport = async (mode: 'append' | 'replace') => {
    if (mode === 'replace' && cls.students.length > 0) {
      const ok = await api().confirm({ message: `‘${cls.name}’ 명단을 붙여넣은 목록으로 바꿀까요?`, detail: '번호와 이름이 같은 학생은 기존 설정(고정 자리 등)이 유지되고, 목록에 없는 학생은 삭제됩니다.', ok: '명단 교체' });
      if (!ok) return;
    }
    const r = await act('students/import', { text: bulk, mode });
    if (r.ok) {
      setBulk('');
      toast(`${r.added}명을 등록했습니다.` + (r.errors?.length ? '\n' + r.errors.join('\n') : ''), r.errors?.length ? 'warn' : 'ok', 7000);
    }
  };

  return (
    <div>
      <h1 className="t-title">학급과 학생 명단</h1>
      <p className="t-sub">학생은 고유 ID로 관리되므로 이름이나 번호를 고쳐도 고정 자리 등 설정이 그대로 유지됩니다.</p>

      <div className="card">
        <h2>학급</h2>
        <div className="row">
          {data.classes.map((c) => (
            <button key={c.id} className={`btn big ${c.id === cls.id ? 'sel' : ''}`} onClick={() => act('class/select', { id: c.id })}>
              {c.name} <span className="muted small">({c.students.length}명)</span>
            </button>
          ))}
        </div>
        <div className="row">
          {rename !== null ? (
            <>
              <input type="text" value={rename} maxLength={30} onChange={(e) => setRename(e.target.value)} autoFocus />
              <button className="btn primary" onClick={async () => (await act('class/rename', { id: cls.id, name: rename })).ok && setRename(null)}>
                이름 저장
              </button>
              <button className="btn" onClick={() => setRename(null)}>
                취소
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => setRename(cls.name)}>
              ‘{cls.name}’ 이름 바꾸기
            </button>
          )}
          <button
            className="btn danger"
            disabled={data.classes.length <= 1}
            onClick={async () => {
              if (await api().confirm({ message: `‘${cls.name}’ 학급을 삭제할까요?`, detail: '학생 명단, 자리 배치, 발표 기록이 모두 삭제되며 되돌릴 수 없습니다.', ok: '삭제' })) act('class/delete', { id: cls.id }, '학급을 삭제했습니다.');
            }}
          >
            학급 삭제
          </button>
          <span style={{ flex: 1 }} />
          <input type="text" placeholder="새 학급 이름 (예: 5학년 2반)" value={newClass} maxLength={30} onChange={(e) => setNewClass(e.target.value)} />
          <button className="btn primary" onClick={async () => (await act('class/add', { name: newClass }, '학급을 추가했습니다.')).ok && setNewClass('')}>
            + 학급 추가
          </button>
        </div>
      </div>

      <div className="grid2 roster-grid">
        <div className="card">
          <h2>
            {cls.name} 학생 {cls.students.length}명 <span className="hint">최대 {MAX_STUDENTS}명</span>
          </h2>
          {cls.students.length > 0 && cls.students.length < MIN_STUDENTS && <div className="alert info">학급당 {MIN_STUDENTS}~{MAX_STUDENTS}명 사용을 기준으로 만들었습니다.</div>}
          {dupNames.size > 0 && <div className="alert info">동명이인({[...dupNames].join(', ')})은 학생 화면에 ‘이름(번호)’으로 구분해 표시합니다.</div>}
          <div className="row" style={{ marginBottom: 8 }}>
            <input type="number" placeholder="번호" value={num} onChange={(e) => setNum(e.target.value)} style={{ width: 70 }} />
            <input
              type="text"
              placeholder="이름"
              value={name}
              maxLength={20}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && (await act('student/add', { number: num, name, gender: gender || null })).ok) {
                  setName('');
                  setNum('');
                }
              }}
            />
            <select value={gender} onChange={(e) => setGender(e.target.value as '' | 'M' | 'F')} title="성별">
              <option value="">성별</option>
              <option value="M">남</option>
              <option value="F">여</option>
            </select>
            <button
              className="btn primary"
              disabled={cls.students.length >= MAX_STUDENTS}
              onClick={async () => {
                if ((await act('student/add', { number: num, name, gender: gender || null })).ok) {
                  setName('');
                  setNum('');
                }
              }}
            >
              + 학생 추가
            </button>
            <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => act('students/clearAbsent', {}, '결석·제외 표시를 모두 해제했습니다.')}>
              결석·제외 모두 해제
            </button>
          </div>
          <table className="list" data-testid="student-table">
            <thead>
              <tr>
                <th style={{ width: 66 }}>번호</th>
                <th style={{ minWidth: 120 }}>이름</th>
                <th style={{ width: 92 }}>성별</th>
                <th style={{ width: 48 }} title="오늘만 결석 (내일 자동 해제)">결석</th>
                <th style={{ width: 48 }} title="해제할 때까지 제외">제외</th>
                <th style={{ width: 56 }} />
              </tr>
            </thead>
            <tbody>
              {cls.students.map((s) => (
                <StudentRow key={s.id} s={s} today={today} dup={dupNames.has(s.name)} />
              ))}
              {cls.students.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    등록된 학생이 없습니다. 오른쪽에 명단을 붙여넣어 한 번에 등록하세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="small muted">‘결석’은 오늘만 적용되고 다음 날 자동으로 풀립니다. ‘제외’(일시 제외)는 직접 해제할 때까지 유지됩니다. 성별은 남자·여자 자리 배치에 쓰이며, 다시 누르면 지워집니다.</p>
        </div>

        <div className="card">
          <h2>명단 한 번에 등록</h2>
          <p className="small muted" style={{ marginTop: 0 }}>
            엑셀에서 <b>번호·이름(·성별) 열</b>을 복사해 붙여넣거나, 이름을 한 줄에 하나씩 입력하세요. 번호가 없으면 자동으로 매깁니다. 성별은 ‘남/여’로 적으면 함께 등록됩니다.
          </p>
          <textarea rows={12} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'1\t김민준\t남\n2\t이서연\t여\n3\t박지호\t남\n\n또는\n\n김민준\n이서연'} data-testid="bulk-input" />
          {bulk.trim() && (
            <div className="small" style={{ margin: '6px 0' }}>
              인식한 학생 {parsed.entries.length}명: {parsed.entries.slice(0, 12).map((e) => `${e.number ?? '?'}.${e.name}${e.gender ? `(${e.gender === 'M' ? '남' : '여'})` : ''}`).join(', ')}
              {parsed.entries.length > 12 && ' …'}
              {parsed.skipped.length > 0 && <div style={{ color: 'var(--warn)' }}>해석하지 못한 줄 {parsed.skipped.length}개</div>}
            </div>
          )}
          <div className="row">
            <button className="btn primary" disabled={!parsed.entries.length} onClick={() => doImport('append')} data-testid="bulk-append">
              기존 명단에 추가
            </button>
            <button className="btn" disabled={!parsed.entries.length} onClick={() => doImport('replace')}>
              명단 교체
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StudentRow({ s, today, dup }: { s: Student; today: string; dup: boolean }) {
  const [name, setName] = useState(s.name);
  const [num, setNum] = useState(String(s.number));
  const absent = s.absentDate === today;
  useEffect(() => setName(s.name), [s.name]);
  useEffect(() => setNum(String(s.number)), [s.number]);
  const commitName = async () => {
    if (name.trim() === s.name) return;
    if (!(await act('student/update', { id: s.id, name })).ok) setName(s.name);
  };
  const commitNum = async () => {
    if (Number(num) === s.number) return;
    if (!(await act('student/update', { id: s.id, number: Number(num) })).ok) setNum(String(s.number));
  };
  return (
    <tr className={absent || s.excluded ? 'away' : ''}>
      <td>
        <input type="number" value={num} onChange={(e) => setNum(e.target.value)} onBlur={commitNum} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} style={{ width: 60 }} />
      </td>
      <td>
        <input type="text" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} style={{ width: '100%' }} />
        {dup && <div className="small muted">동명이인 → ‘{s.name}({s.number})’</div>}
      </td>
      <td>
        <div className="seg gender-seg">
          {(['M', 'F'] as const).map((g) => (
            <button key={g} className={s.gender === g ? `on g-${g}` : ''} onClick={() => act('student/update', { id: s.id, gender: s.gender === g ? null : g })} title={s.gender === g ? '다시 누르면 성별 지우기' : ''}>
              {g === 'M' ? '남' : '여'}
            </button>
          ))}
        </div>
      </td>
      <td>
        <input type="checkbox" checked={absent} title="오늘 결석" aria-label="오늘 결석" onChange={(e) => act('student/update', { id: s.id, absent: e.target.checked })} />
      </td>
      <td>
        <input type="checkbox" checked={!!s.excluded} title="일시 제외" aria-label="일시 제외" onChange={(e) => act('student/update', { id: s.id, excluded: e.target.checked })} />
      </td>
      <td>
        <button
          className="btn sm danger"
          onClick={async () => {
            if (await api().confirm({ message: `${s.number}번 ${s.name} 학생을 삭제할까요?`, detail: '이 학생의 고정 자리와 추첨 정보도 함께 정리됩니다.', ok: '삭제' })) {
              const r = await act('student/delete', { id: s.id });
              if (r.messages?.length) toast(r.messages.join('\n'), 'info');
            }
          }}
        >
          삭제
        </button>
      </td>
    </tr>
  );
}
