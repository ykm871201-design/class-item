import { displayName, resolveStudentDisplay } from '../../shared/displays';
import { act, api, toast, useAppState } from './api';

export function SettingsTab() {
  const { data, runtime } = useAppState();
  const st = data.settings;
  const sw = runtime.studentWindow;
  const resolved = resolveStudentDisplay(runtime.displays, st.studentDisplay);
  const call = async (a: { type: string; [k: string]: any }, okText?: string) => {
    const r = await api().app(a);
    if (!r.ok && r.error) toast(r.error, 'err');
    else if (r.ok && okText) toast(okText, 'ok');
    return r;
  };

  return (
    <div>
      <h1 className="t-title">설정</h1>
      <div className="card">
        <h2>학생용 화면 출력</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          연결된 디스플레이를 감지했습니다. 학생용 TV·프로젝터를 골라 주세요. 고른 화면은 기억해 두었다가 다시 연결되면 자동으로 사용합니다.
        </p>
        <table className="list" data-testid="display-list">
          <tbody>
            {runtime.displays.map((d, i) => {
              const selected = resolved.display?.id === d.id;
              return (
                <tr key={d.id}>
                  <td>
                    <label className="inline">
                      <input type="radio" name="disp" checked={selected} onChange={() => call({ type: 'selectDisplay', id: d.id }, '학생용 디스플레이를 바꿨습니다.')} />
                      <b>{displayName(d, i)}</b>
                    </label>
                    <div className="small muted">
                      위치 ({d.x}, {d.y}) · 배율 {Math.round(d.scaleFactor * 100)}%{selected && !resolved.matchedSaved ? ' · 자동 선택됨' : ''}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!resolved.display && (
          <div className="alert warn">
            주 모니터 외에 연결된 디스플레이가 없습니다. 학생 화면을 교사용 화면에 전체 화면으로 띄우지 않습니다.
            {'\n'}TV·프로젝터를 연결하고 Windows 디스플레이 설정이 ‘확장’인지 확인하세요. 한 화면에서 시험할 때는 아래 ‘미리보기 창’을 사용하세요.
          </div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <span className="field-label">표시 형태</span>
          <div className="seg">
            <button className={st.studentFullscreen ? 'on' : ''} onClick={() => call({ type: 'setFullscreen', value: true })}>
              전체 화면
            </button>
            <button className={!st.studentFullscreen ? 'on' : ''} onClick={() => call({ type: 'setFullscreen', value: false })}>
              창 모드
            </button>
          </div>
          {sw.visible ? (
            <button className="btn" onClick={() => act('student/hide')}>
              학생 화면 숨기기
            </button>
          ) : (
            <button className="btn primary" onClick={() => act('student/show')} disabled={!resolved.display && sw.mode !== 'preview'}>
              학생 화면 보이기
            </button>
          )}
        </div>
        <div className="row">
          <label className="inline">
            <input type="checkbox" checked={st.studentAlwaysOnTop} onChange={(e) => call({ type: 'setAlwaysOnTop', value: e.target.checked })} data-testid="always-on-top" />
            학생 화면을 다른 창보다 항상 위에 표시 (‘학생 화면 숨기기’를 누르면 내려가서 다른 창이 보입니다 · 학생용 위젯은 위젯 탭에서 따로 정합니다)
          </label>
        </div>
        <div className="row">
          <label className="inline">
            <input type="checkbox" checked={st.showStudentOnStartup} onChange={(e) => act('settings/update', { patch: { showStudentOnStartup: e.target.checked } })} />
            앱을 시작하면 학생 화면 자동 표시 (학생용 디스플레이가 있을 때)
          </label>
        </div>
        <div className="row">
          <button className="btn" onClick={() => call({ type: 'preview', open: !(sw.mode === 'preview' && sw.visible) })} data-testid="preview-toggle">
            {sw.mode === 'preview' && sw.visible ? '미리보기 창 닫기' : '미리보기 창 열기 (모니터 하나로 시험)'}
          </button>
          <span className="small muted">학생 화면을 교사용 모니터에 작은 별도 창으로 띄웁니다. 예약 타이머도 이 창에서 확인할 수 있습니다.</span>
        </div>
        <div className="alert info">
          모니터가 하나뿐이거나 학생 화면이 교사용 모니터에 떠 있을 때는, 학생 화면을 누른 상태에서 <b>Esc</b> 키를 누르면 학생 화면이 숨겨지고 교사용 창으로 돌아옵니다. (학생용 TV에 따로 떠 있을 때는 실수로 꺼지지 않도록 Esc가 동작하지 않습니다.)
        </div>
      </div>

      <div className="card">
        <h2>실행</h2>
        <div className="alert info" style={{ marginTop: 0 }}>
          창의 ✕(닫기)를 누르면 앱이 꺼지지 않고 화면 오른쪽 아래 <b>알림 영역</b>으로 이동해 예약 타이머를 계속 감시합니다.
          {'\n'}완전히 끄려면 알림 영역 아이콘을 오른쪽 클릭 → ‘앱 완전 종료’ 또는 아래 버튼을 누르세요. 완전히 종료하면 예약이 실행되지 않습니다.
        </div>
        <div className="row">
          <label className="inline">
            <input type="checkbox" checked={st.autoLaunch} onChange={async (e) => { const r = await call({ type: 'autoLaunch', value: e.target.checked }); if (r.ok && !r.packaged) toast('개발 모드에서는 자동 실행이 설치된 앱처럼 동작하지 않을 수 있습니다.', 'info'); }} />
            Windows 시작 시 자동 실행 (알림 영역에서 조용히 시작)
          </label>
        </div>
        <div className="row">
          <button className="btn" onClick={() => call({ type: 'hideToTray' })}>
            알림 영역으로 숨기기
          </button>
          <button
            className="btn danger"
            onClick={async () => {
              if (await api().confirm({ message: '앱을 완전히 종료할까요?', detail: '종료하면 예약 타이머가 실행되지 않습니다.', ok: '완전 종료' })) call({ type: 'quit' });
            }}
          >
            앱 완전 종료
          </button>
        </div>
      </div>

      <div className="card">
        <h2>데이터</h2>
        <p className="small" style={{ marginTop: 0 }}>
          모든 데이터는 이 PC에만 저장됩니다 (인터넷·서버 사용 안 함). 저장 위치: <code>{runtime.userDataPath}</code>
        </p>
        <div className="row">
          <button className="btn" onClick={() => call({ type: 'openDataFolder' })}>
            저장 폴더 열기
          </button>
          <button className="btn primary" onClick={async () => { const r = await call({ type: 'export' }); if (r.ok) toast(`내보냈습니다: ${r.path}`, 'ok', 6000); }}>
            데이터 내보내기 (백업)
          </button>
          <button className="btn" onClick={async () => { const r = await call({ type: 'import' }); if (r.ok) toast(`가져왔습니다: ${r.summary}`, 'ok', 6000); }}>
            데이터 가져오기
          </button>
        </div>
        <p className="small muted">가져오기를 하면 현재 데이터를 덮어쓰기 전에 확인을 묻고, 기존 데이터는 저장 폴더에 백업 파일로 남깁니다.</p>
      </div>
      <UpdateCard />
      <p className="small muted">교실 도구 v{runtime.appVersion}</p>
    </div>
  );
}

function UpdateCard() {
  const { runtime } = useAppState();
  const u = runtime.update;
  const pct = Math.round((u.progress ?? 0) * 100);
  const busy = u.status === 'checking' || u.status === 'downloading' || u.status === 'installing';
  const install = async () => {
    const ok = await api().confirm({
      message: `새 버전 v${u.latest}으로 업데이트할까요?`,
      detail: '설치 파일을 내려받아 설치합니다. 설치하는 동안 앱이 잠시 꺼졌다가 다시 켜집니다. 진행 중인 타이머는 멈춥니다.\n학급·명단·예약 등 데이터는 그대로 유지됩니다.',
      ok: '업데이트',
    });
    if (!ok) return;
    const r = await api().app({ type: 'updateInstall' });
    if (!r.ok && r.error) toast(r.error, 'err');
  };
  return (
    <div className="card" data-testid="update-card">
      <h2>
        업데이트 <span className="hint">현재 버전 v{u.current}</span>
      </h2>
      <div className="row">
        <button className="btn" onClick={() => api().app({ type: 'updateCheck' })} disabled={busy} data-testid="update-check">
          {u.status === 'checking' ? '확인 중…' : '업데이트 확인'}
        </button>
        {u.status === 'latest' && <span className="pill" data-testid="update-status">최신 버전입니다 (v{u.latest})</span>}
        {u.status === 'available' && (
          <>
            <span className="pill g-m" data-testid="update-status">새 버전 v{u.latest} 있음</span>
            <button className="btn primary big" onClick={install} data-testid="update-install">
              업데이트 설치
            </button>
          </>
        )}
        {u.status === 'downloading' && <span data-testid="update-status">내려받는 중… {pct}%</span>}
        {u.status === 'installing' && <span data-testid="update-status">설치 중입니다. 잠시 후 앱이 다시 켜집니다…</span>}
      </div>
      {u.status === 'downloading' && (
        <div className="progress" style={{ marginTop: 8 }}>
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
      {u.error && <div className="alert err">{u.error}</div>}
      {u.status === 'available' && u.notes && (
        <details style={{ marginTop: 8 }}>
          <summary className="small">바뀐 내용 보기</summary>
          <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{u.notes}</div>
        </details>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>
        GitHub에 올라온 최신 버전을 확인합니다 (인터넷 필요). 앱을 켤 때도 한 번 확인해서, 새 버전이 있으면 왼쪽 ‘설정’에 표시합니다. 업데이트해도 데이터는 그대로입니다.
      </p>
    </div>
  );
}
