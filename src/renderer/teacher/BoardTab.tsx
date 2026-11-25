import { useEffect, useRef, useState } from 'react';
import type { BoardStyle, StudentView } from '../../shared/types';
import { BG_COLORS, BOARD_THEMES, TEXT_COLORS } from '../../shared/defaults';
import { ScaledStudentScreen } from '../common/StudentScreen';
import { act, api, useAppState } from './api';

export function BoardTab() {
  const { data, studentView } = useAppState();
  const d = data.boardDraft;
  const [text, setText] = useState(d.text);
  const textRef = useRef(d.text);
  const lastSent = useRef(d.text);
  const live = data.settings.boardLive;
  const timer = useRef<number | null>(null);
  const [phraseTitle, setPhraseTitle] = useState('');

  // 문구 불러오기·지우기 등 외부 변경 반영
  useEffect(() => {
    if (d.text !== lastSent.current) {
      lastSent.current = d.text;
      textRef.current = d.text;
      setText(d.text);
    }
  }, [d.text]);

  const flush = async (t = textRef.current) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (t !== lastSent.current) {
      lastSent.current = t;
      await act('board/updateDraft', { patch: { text: t } });
    }
  };
  const onText = (t: string) => {
    textRef.current = t;
    setText(t);
    if (timer.current) window.clearTimeout(timer.current);
    // 자동 저장 (실시간 반영 중에는 더 짧게 → 입력하는 대로 학생 화면에 보임)
    timer.current = window.setTimeout(() => flush(t), live ? 120 : 300);
  };
  useEffect(() => () => void flush(), []); // 탭을 떠날 때 저장

  const patch = (p: Partial<BoardStyle>) => act('board/updateDraft', { patch: p });
  const toggleLive = async () => {
    await flush();
    await act('board/setLive', { value: !live }, live ? '실시간 반영을 껐습니다. 이제 ‘학생 화면에 표시’를 눌러야 반영됩니다.' : '실시간 반영을 켰습니다. 입력하는 내용이 바로 학생 화면에 보입니다.');
  };
  const publish = async () => {
    await flush();
    await act('board/publish', {}, '학생 화면에 표시했습니다.');
  };
  const clear = async () => {
    if (!text.trim() || (await api().confirm({ message: '작성 중인 칠판 내용을 모두 지울까요?', detail: live ? '실시간 반영 중이라 학생 화면 칠판도 함께 지워집니다.' : '학생 화면에 이미 표시된 내용은 ‘학생 화면에 표시’를 누르기 전까지 그대로 유지됩니다.', ok: '지우기' }))) {
      lastSent.current = '';
      textRef.current = '';
      setText('');
      await act('board/clearDraft');
    }
  };

  const draftLive: BoardStyle = { ...d, text };
  const pub = data.boardPublished;
  const differs = JSON.stringify(draftLive) !== JSON.stringify(pub);
  const draftView: StudentView = { base: 'board', board: draftLive, seating: null, picker: null, timer: null };
  const fullTimer = studentView.timer?.mode === 'full';

  return (
    <div>
      <h1 className="t-title">큰 글씨 칠판</h1>
      <p className="t-sub">입력한 내용은 자동 저장됩니다. ‘학생 화면에 표시’를 누르거나, ‘실시간 반영’을 켜 두면 입력하는 즉시 학생에게 보입니다.</p>
      <div className="grid2">
        <div>
          <div className="card">
            <h2>
              문구 입력 <span className="hint">여러 줄 입력 가능</span>
            </h2>
            <textarea
              className="board-editor"
              rows={7}
              value={text}
              onChange={(e) => onText(e.target.value)}
              onBlur={() => flush()}
              placeholder="여기에 학생에게 보여 줄 문구를 입력하세요"
              style={{ fontWeight: d.bold ? 800 : 500, textAlign: d.align }}
              data-testid="board-input"
            />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn huge primary" onClick={publish} data-testid="board-publish" disabled={live}>
                학생 화면에 표시
              </button>
              <button className={`btn huge ${live ? 'ok' : ''}`} onClick={toggleLive} data-testid="board-live" title="켜 두면 입력하는 내용이 바로 학생 화면 칠판에 보입니다">
                {live ? '● 실시간 반영 중 (끄기)' : '실시간 반영 켜기'}
              </button>
              <button className="btn danger" onClick={clear}>
                내용 전체 지우기
              </button>
            </div>
            <div style={{ marginTop: 8 }}>
              {live ? (
                <div className="alert ok">실시간 반영 중입니다. 입력하는 내용과 글자·색 변경이 바로 학생 화면 칠판에 보입니다.</div>
              ) : differs ? (
                <div className="alert warn">작성 중인 내용이 학생 화면과 다릅니다. ‘학생 화면에 표시’를 누르거나 ‘실시간 반영’을 켜면 반영됩니다.</div>
              ) : (
                <div className="alert ok">학생 화면에 표시된 내용과 같습니다.</div>
              )}
              {fullTimer && <div className="alert info">지금은 전체 화면 타이머가 표시 중입니다. 표시한 칠판 문구는 타이머를 닫으면 바로 보입니다.</div>}
              {studentView.timer?.mode === 'split' && <div className="alert info">칠판 + 타이머 함께 보기 중입니다. 표시를 누르면 타이머는 그대로 두고 문구만 바뀝니다.</div>}
              {studentView.base === 'widget' && <div className="alert info">학생 화면에 학생용 위젯이 떠 있습니다. ‘학생 화면에 표시’를 누르면 위젯의 큰 시계 자리에 칠판이 뜹니다. 시계로 되돌리려면 오른쪽 ‘큰 칸: 시계’를 누르세요.</div>}
            </div>
          </div>

          <div className="card">
            <h2>글자와 색</h2>
            <div className="row">
              <label className="inline">
                <input type="checkbox" checked={d.autoFit} onChange={(e) => patch({ autoFit: e.target.checked })} />
                화면에 맞춰 자동 크기
              </label>
              <span className="field-label" style={{ marginLeft: 12 }}>
                글자 크기
              </span>
              <input type="range" min={3} max={40} value={d.fontSize} disabled={d.autoFit} onChange={(e) => patch({ fontSize: Number(e.target.value) })} />
              <span className="small muted">{d.autoFit ? '자동' : `화면 높이의 ${d.fontSize}%`}</span>
            </div>
            <div className="row">
              <div className="seg">
                <button className={d.align === 'left' ? 'on' : ''} onClick={() => patch({ align: 'left' })}>
                  왼쪽 정렬
                </button>
                <button className={d.align === 'center' ? 'on' : ''} onClick={() => patch({ align: 'center' })}>
                  가운데 정렬
                </button>
              </div>
              <button className={`btn ${d.bold ? 'sel' : ''}`} onClick={() => patch({ bold: !d.bold })} style={{ fontWeight: 900 }}>
                굵게 {d.bold ? '켜짐' : '꺼짐'}
              </button>
            </div>
            <div className="row">
              <span className="field-label">추천 색 조합</span>
              {BOARD_THEMES.map((t) => (
                <button key={t.name} className="theme-btn" title={t.name} style={{ background: t.bg, color: t.color, outline: d.bg === t.bg && d.color === t.color ? '3px solid #1f6feb' : undefined }} onClick={() => patch({ bg: t.bg, color: t.color })}>
                  가나다
                </button>
              ))}
            </div>
            <div className="row">
              <span className="field-label">글자색</span>
              <div className="swatches">
                {TEXT_COLORS.map((c) => (
                  <button key={c} className={`swatch ${d.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => patch({ color: c })} aria-label={c} />
                ))}
                <input type="color" value={d.color} onChange={(e) => patch({ color: e.target.value })} title="직접 고르기" />
              </div>
            </div>
            <div className="row">
              <span className="field-label">배경색</span>
              <div className="swatches">
                {BG_COLORS.map((c) => (
                  <button key={c} className={`swatch ${d.bg === c ? 'on' : ''}`} style={{ background: c }} onClick={() => patch({ bg: c })} aria-label={c} />
                ))}
                <input type="color" value={d.bg} onChange={(e) => patch({ bg: e.target.value })} title="직접 고르기" />
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <h2>
              편집 중 미리보기 <span className="hint">{live ? '실시간 반영 중 — 학생 화면과 같습니다' : '학생에게는 보이지 않습니다'}</span>
            </h2>
            <div className="draft-preview">
              <ScaledStudentScreen view={draftView} />
            </div>
          </div>
          <div className="card">
            <h2>자주 쓰는 문구</h2>
            <div className="row">
              <input type="text" placeholder="저장할 이름 (비우면 첫 줄)" value={phraseTitle} onChange={(e) => setPhraseTitle(e.target.value)} style={{ flex: 1 }} />
              <button
                className="btn"
                onClick={async () => {
                  await flush();
                  const r = await act('phrase/save', { title: phraseTitle, text }, '문구를 저장했습니다.');
                  if (r.ok) setPhraseTitle('');
                }}
              >
                지금 문구 저장
              </button>
            </div>
            <table className="list" style={{ marginTop: 10 }}>
              <tbody>
                {data.phrases.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.title}</b>
                      <div className="small muted" style={{ whiteSpace: 'pre-line', maxHeight: 40, overflow: 'hidden' }}>
                        {p.text}
                      </div>
                    </td>
                    <td style={{ width: 150, textAlign: 'right' }}>
                      <button className="btn sm" onClick={() => act('phrase/load', { id: p.id })}>
                        불러오기
                      </button>{' '}
                      <button
                        className="btn sm danger"
                        onClick={async () => {
                          if (await api().confirm({ message: `‘${p.title}’ 문구를 삭제할까요?`, ok: '삭제' })) act('phrase/delete', { id: p.id });
                        }}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
                {data.phrases.length === 0 && (
                  <tr>
                    <td className="muted">저장된 문구가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
