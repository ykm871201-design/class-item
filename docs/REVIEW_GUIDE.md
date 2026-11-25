# 교실 도구 — 외부 검토용 안내서

이 문서는 다른 AI나 개발자가 이 프로그램을 **비판적으로 검토**할 때 먼저 읽는 안내서입니다. 무엇을 만들었고, 어떻게 동작하며, 어디가 약한지(작성자가 아는 한)를 정리했습니다. 사용 설명은 `README.md`를 보세요.

- 저장소: https://github.com/ykm871201-design/class-item (공개)
- 버전: 1.4.4 (`package.json`) — v1.4.3에 대한 외부 검토 반영 결과는 `docs/REVIEW_RESPONSE.md`
- 규모: 약 1만 1천 줄 (소스 약 9,200줄 — CSS·HTML 포함, 테스트 약 1,900줄)
- 만든 방법: 초등 교사가 요구사항을 쓰고 AI 코딩 도구(Claude Code)가 구현했습니다. 교사는 실제 Windows 교실에서 써 보며 기능을 추가 요청했습니다.

---

## 1. 무엇을 하는 프로그램인가

초등학교 교사가 수업 중 교사용 모니터와 학생용 TV·프로젝터(듀얼 디스플레이)로 쓰는 **Windows 데스크톱 앱**입니다. 로그인·서버 없이 PC 한 대에서 동작합니다.

| 기능 | 요약 |
|---|---|
| 큰 글씨 칠판 | 입력한 문구를 학생 화면에 크게 표시. ‘학생 화면에 표시’를 눌러야 공개(또는 실시간 반영 모드) |
| 타이머 | 수동·예약 타이머, 종료 예고음(정한 시점부터 1초마다), ‘칠판+타이머 함께 보기’/전체 화면 |
| 예약 타이머 | 매주 요일 반복·한 번 실행. 앱이 알림 영역에 있어도 정시에 학생 화면을 띄우고 타이머 시작 |
| 랜덤 자리 배치 | 짝꿍형·개인형·분단별(분단마다 인원 1~4명), **교사만 아는 고정 자리**, 남자·여자 자리 지정 |
| 발표자 뽑기 | 중복 없이/매번 전체에서, 결석·제외 학생 빼기 |
| 학급·명단 | 여러 학급, 엑셀 붙여넣기(번호·이름·성별), 결석·일시 제외 |
| 바탕화면 위젯(교사용) | 달력(구글 캘린더 iCal 읽기 + 내 일정 + 공휴일), 일정 정리·할 일, 메모, 시계·교시, 날씨·미세먼지, 급식, 시간표, 수업 도구 |
| 학생용 위젯(학생 화면) | 큰 시계(타이머·칠판을 띄우면 그 자리에 표시), 달력(공휴일만), 날씨, 급식, 시간표, 알림장 |
| 업데이트 | GitHub Releases 최신 설치 파일을 받아 SHA-256 확인 후 조용히 설치 |

### 꼭 지켜야 하는 요구사항 (검토 시 기준)
1. **학생 화면에 교사용 정보가 새지 않을 것**: 고정 자리 여부, 남녀 자리 지정, 학생 ID, 결석 정보, 편집 중인 칠판 문구, 구글 캘린더·개인 일정·메모·캘린더 주소.
2. **예약 타이머가 정확히 한 번** 실행될 것. 오래전에 놓친 예약을 한꺼번에 실행하지 말 것(절전 복귀·앱 재시작).
3. **학생용 디스플레이가 없으면 교사 화면을 덮지 말 것.**
4. 예약 실행 때 **교사 모니터의 키보드 포커스를 빼앗지 말 것.**
5. 자리 배치는 **편향 없이 무작위**이고 **중복·누락이 없을 것.**
6. 데이터(명단·설정)는 앱을 꺼도 남고, 손상에 강할 것.

---

## 2. 구조

Electron(메인 프로세스 1개 + 창 3개) + TypeScript + React, esbuild로 묶고 electron-builder(NSIS)로 설치 파일을 만듭니다.

```
메인 프로세스 (src/main)
 ├─ Controller (controller.ts) : 앱 상태의 단일 원본. 모든 동작은 dispatch(action)로 처리
 ├─ Store (store.ts)           : %APPDATA%\ClassroomTools\classroom-data.json 원자적 저장 + 백업
 ├─ 예약 감시 루프              : 250ms마다 tick() → 타이머 종료·예고음·예약 판정
 ├─ StudentWindow (main.ts)    : 학생 창 표시·숨김·전체 화면·맨 위·디스플레이 연결/해제
 ├─ WidgetManager (widget.ts)  : 교사용 위젯 창 + iCal·날씨·급식 받아 오기
 └─ Updater (updater.ts)       : GitHub Releases 확인·다운로드·검증·설치

창 (src/renderer)
 ├─ 교사용 창  teacher/*  ← preload/teacher.ts (dispatch, app, confirm, onState …)
 ├─ 위젯 창    widget/*   ← 같은 preload/teacher.ts
 └─ 학생 창    student/*  ← preload/student.ts (표시용 데이터 구독만 가능)

공용 로직 (src/shared) — Electron에 의존하지 않는 순수 함수, 자동 테스트 대상
```

### 데이터 흐름
- 교사 창·위젯 창 → `ipcRenderer.invoke('dispatch', action)` → `Controller.dispatch` → 상태 변경 → 저장(400ms 묶음) → `broadcast(fullState)`.
- 교사 창·위젯 창은 `fullState`(전체 데이터. 단 캘린더 주소는 가림)를 받습니다.
- 학생 창은 `buildStudentView()`(src/shared/studentView.ts)가 만든 **표시용 데이터만** 받습니다. 학생 창 preload는 구독 외의 기능이 없습니다.
- 네트워크(iCal·날씨·급식·업데이트)는 **메인 프로세스에서만** `net.fetch`로 합니다.

### 주요 파일
| 파일 | 역할 | 줄 |
|---|---|---|
| src/main/controller.ts | 모든 동작(학급·명단·칠판·타이머·예약·자리·뽑기·위젯) 처리 | 794 |
| src/main/main.ts | 창·알림 영역·IPC·디스플레이·진단 기록·단일 인스턴스 | 644 |
| src/main/widget.ts | 위젯 창, iCal·날씨·급식, safeStorage 암호화 | 301 |
| src/main/updater.ts | 업데이트 확인·다운로드·SHA-256 검증·조용한 설치 | 121 |
| src/main/store.ts | JSON 저장(임시 파일 → rename, 백업) | 68 |
| src/shared/seating.ts | 좌석 생성, 고정 자리 검증, 남녀 자리, 배치 알고리즘 | 543 |
| src/shared/schedule.ts | 다음 실행 시각, 실행/놓침 판정, 충돌 검사 | 186 |
| src/shared/timer.ts | 종료 시각 기반 타이머, 종료 예고음 판정 | 129 |
| src/shared/ical.ts | iCal 해석(RRULE·EXDATE·RECURRENCE-ID·TZID) | 316 |
| src/shared/studentView.ts | 학생 화면으로 보낼 데이터만 고름 | 75 |
| src/shared/defaults.ts | 기본값, 저장 데이터 정규화(손상·옛 버전 대비), 가져오기 검증 | 375 |
| src/shared/widget.ts | 교시 계산, 일정 합치기, 날씨 지역, 급식 정리, 시간표 붙여넣기 | 244 |
| src/shared/holidays.ts | 대한민국 공휴일·대체공휴일 (2025~2030 음력 표) | 89 |
| src/renderer/common/StudentScreen.tsx | 학생 화면 그리기(칠판 맞춤, 함께 보기, 자리, 뽑기, 학생용 위젯) | 458 |
| src/renderer/teacher/*.tsx | 교사용 탭별 화면 | — |
| src/renderer/widget/index.tsx | 교사용 바탕화면 위젯 | 629 |

---

## 3. 핵심 설계 결정 (왜 이렇게 했나)

- **타이머**는 종료 시각(`endAt`)만 저장하고 남은 시간 = `endAt - now`. 창 최소화·지연과 무관.
- **예약 감시**는 창과 분리된 메인 프로세스 루프. 예약마다 마지막으로 처리한 발생 키(`scheduleFired`)를 저장해 중복 실행을 막고, 2분보다 늦게 감지된 발생은 실행하지 않고 ‘놓침’으로 기록. `powerSaveBlocker('prevent-app-suspension')` 사용.
- **자리 배치**: 고정 → (남녀 자리가 있으면) 남학생→남자 자리, 여학생→여자 자리 → 나머지 → 검증. 난수는 `crypto.getRandomValues` + 거부 샘플링, Fisher–Yates.
- **학생 창 표시**는 항상 `showInactive`(포커스 유지). 최소화 상태면 `restore`.
- **맨 위 표시**: 설정 ‘학생 화면을 항상 위’(기본 켜짐) 또는 타이머 표시 중이면 `setAlwaysOnTop(true, 'screen-saver')`.
- **구글 캘린더**: OAuth 대신 ‘iCal 비공개 주소’(읽기 전용). 주소는 `safeStorage`(Windows DPAPI)로 암호화해 저장하고 렌더러로 보내지 않음. 일정 추가는 구글 캘린더 ‘일정 만들기’ 화면을 브라우저로 엶.
- **업데이트**: GitHub Actions가 Windows에서 빌드해 Releases에 올림. 앱은 GitHub API의 `digest`(sha256)와 크기를 비교한 뒤 NSIS 설치 파일을 `/S --force-run`으로 실행.

---

## 4. 작성자가 알고 있는 약점·검증하지 못한 것 (솔직한 목록)

### 실제 Windows에서 직접 확인하지 못한 것
개발·자동 테스트는 Linux(Xvfb 가상 화면)에서 했고, 듀얼 모니터는 Electron `screen` API를 가짜 디스플레이로 바꿔 흉내 냈습니다. 그래서 아래는 **코드상 의도일 뿐 실측이 아닙니다**.
- 학생 창 전체 화면이 작업 표시줄 위를 덮는지, `showInactive`가 정말 포커스를 안 뺏는지, 최소화된 창 복원
- `alwaysOnTop 'screen-saver'`가 다른 전체 화면 프로그램(파워포인트 쇼 등) 위에 뜨는지
- 실제 HDMI 분리·재연결, Windows 배율(125%·150%), 절전 복귀
- NSIS 조용한 설치 `/S --force-run` 후 앱 재실행(업데이트), 자동 실행(로그인 항목)
- 실제 구글 iCal·Open-Meteo·나이스 서버 응답(테스트는 가짜 서버)

### 알려진 한계·의심 지점
- **보안**: 코드 서명 없음(SmartScreen 경고). 업데이트 무결성은 같은 GitHub 릴리스의 `digest`(필수)에 의존하며 별도 서명은 없음. 교사 preload의 `dispatch`/`app`은 어떤 동작 이름이든 넘길 수 있음(메인에서 보낸 창은 확인함).
- **개인정보**: 학생 이름·성별·결석 정보는 `%APPDATA%` JSON에 **평문** 저장(캘린더 주소만 암호화). 데이터 내보내기 파일도 평문.
- **성능**: 상태가 바뀔 때마다 **전체 상태**를 교사 창·위젯 창으로 보냄(구글 일정이 많으면 커짐). 250ms마다 tick.
- **코드 구조**: `controller.ts`가 큰 switch 하나로 모든 동작 처리, 동작 이름·인자가 타입으로 묶여 있지 않음(`any`).
- **iCal 해석**: BYSETPOS, WKST, 사용자 정의 VTIMEZONE(이름만 믿고 Intl 시간대 사용), 일부 RRULE 조합은 지원하지 않음.
- **공휴일**: 음력 명절·부처님오신날은 2025~2030년 표만 있음. 선거일·임시공휴일 없음.
- **예약**: 2분 유예 안에 감지되면 실행. 같은 시각 예약은 저장 시 막지만 실행 중 겹치면 나중 것으로 교체.
- **자리 배치 ‘뒤쪽부터 비우기’**: 남는 자리를 앞자리부터 채우는 규칙이라 빈자리가 항상 뒤쪽 오른쪽에 몰림(의도).
- **진행 중 타이머**는 앱을 완전히 종료하면 이어지지 않음.
- **예약 실행 기록**은 학생 화면 표시 전에 저장하므로, 그 사이 비정상 종료되면 그 회차는 실행되지 않은 채 남음(중복보다 누락을 택함).

---

## 5. 테스트 현황

- `npm test` (Vitest): **136개 통과** (외부 검토 회귀 테스트 `tests/review-fixes.test.ts` 포함). 자리 배치(인원별·고정·남녀·분단별·편향 카이제곱), 뽑기, 예약 계산(다음 실행·중복·놓침·충돌), 타이머·예고음, iCal, 공휴일, 교시, 학생 화면 데이터 누출 방지, 저장·복원.
- `npm run e2e` (Playwright + Electron, Linux Xvfb): **37개 통과**. 실제 앱을 띄워 명단 붙여넣기, 칠판, 고정 자리 공개 시 학생 DOM에 흔적 없음, 예약 실행(교사 창 알림 영역 숨김 상태), 종료 화면·알림음 1회, 디스플레이 해제·재연결(가짜), 재시작 복원, 위젯·학생 위젯, 업데이트(가짜 서버) 등.
- 한계: E2E는 창 관리자가 없는 가상 화면이라 최소화·포커스·전체 화면 동작은 ‘어떤 API를 불렀는지’로만 확인했습니다.

---

## 6. 실행 방법

```bash
npm install
npm test          # 단위 테스트
npm run dev       # 개발 모드 실행
npm run e2e       # E2E (화면 필요, Linux는 xvfb-run)
npm run dist:win  # Windows 설치 파일 (Windows에서)
```
