# PLAN.md — 기술 설계 & 개발 계획

> SPEC.md의 기획을 구현 가능한 형태로 확정하는 문서.
> 비주얼 스타일의 원천은 Design.md — 적용 방식은 §6.5 참조.
> SPEC의 절대 원칙과 충돌하면 SPEC이 이긴다.

---

## 1. 시스템 아키텍처

```
┌──────────────────────────────────┐
│  iOS 앱 (Expo / React Native+TS) │
│  ├─ 메인 앱 (피드/어젠다/입력/상세)
│  └─ expo-share-intent (공유 → 앱 열림 → 자동 저장)
└──────────────┬───────────────────┘
               │ supabase-js
               ▼
┌─────────────────────────────┐      ┌──────────────────────┐
│  Supabase (무료 티어)         │ ◀────│  웹 입력 페이지        │
│  ├─ Postgres: fragments,    │      │  (index.html 단일 파일 │
│  │            projects      │      │   + supabase-js CDN) │
│  ├─ Auth: 계정 1개           │      └──────────────────────┘
│  └─ Storage: images 버킷     │
└─────────────────────────────┘
```

- 서버 코드 없음. 모든 클라이언트가 Supabase REST에 직접 붙는다.
- 동기화 개념 없음 — Supabase가 유일한 진실. 클라이언트는 캐시 없이 조회한다 (MVP).
- 앱과 웹 페이지가 같은 언어(TS/JS) — 타입 판별 로직을 그대로 공유한다.

## 2. Supabase 설계

### 2.1 스키마 (`supabase/schema.sql`)

```sql
create table projects (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null,
  status     text not null default 'before'
             check (status in ('before','active','paused','done'))
);

create table fragments (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  content            text not null default '',
  type               text not null default 'text'
                     check (type in ('text','link','image','quote')),
  link_title         text,
  link_thumbnail_url text,
  image_path         text,
  last_touched_at    timestamptz not null default now(),
  tier               text not null default 'normal'
                     check (tier in ('normal','important','pinned')),
  project_id         uuid references projects(id) on delete set null,
  archived           boolean not null default false
);

create index fragments_created_at_idx on fragments (created_at desc);
```

- `user_id` 컬럼 없음 — 사용자는 한 명 (절대 원칙 5).
- 프로젝트 삭제 시 파편은 살아남고 Inbox로 돌아간다 (`on delete set null`).
- SPEC §4 외 필드 추가 없음.

### 2.2 Auth & RLS

- **Supabase Auth 이메일+비밀번호 계정 1개.** 회원가입 흐름 없음 — 대시보드에서 수동 생성.
- RLS: 두 테이블 모두 `authenticated` 롤에만 select/insert/update/delete 허용. anon은 전부 차단.
  (anon key는 웹 페이지 소스에 노출되므로, 로그인 없이는 아무것도 못 하게 하는 것이 방어선)
- 앱과 웹 페이지 모두 같은 계정으로 로그인. 앱 세션은 supabase-js + AsyncStorage,
  웹은 localStorage — 공유 저장도 앱 본체가 처리하므로 별도 세션 공유 장치가 필요 없다.

### 2.3 Storage

- `images` 버킷, **private**. 읽기/쓰기 모두 authenticated만.
- 표시할 때는 SDK의 signed URL(만료 1주) 사용.
- 경로 규칙: `{uuid}.jpg` (평면 구조, 폴더 없음).

## 3. 앱 설계 (Expo / React Native + TypeScript)

### 3.1 프로젝트 구조

Expo 앱이 저장소 루트에 그대로 산다 (별도 하위 폴더 없음 — 1인용 단일 앱이므로 모노레포 구조 불필요).

```
mind/                         # = 저장소 루트 = Expo 앱 루트
├─ SPEC.md · PLAN.md · Design.md · CLAUDE.md · AGENTS.md
├─ app.json · package.json · tsconfig.json
├─ src/
│  ├─ app/                    # expo-router 화면
│  │  ├─ _layout.tsx          # 루트 스택 + 폰트 로드 + 공유 수신 처리
│  │  ├─ (drawer)/_layout.tsx # 사이드바 드로어
│  │  ├─ (drawer)/index.tsx   # 화면 1·2: 타임라인/어젠다 + 칩 + 스와이프 액션
│  │  ├─ input.tsx            # 화면 3: 빠른 입력 / 수정 (모달)
│  │  ├─ search.tsx           # 검색 (모달)
│  │  └─ fragment/[id].tsx    # 화면 4: 파편 상세
│  ├─ components/             # FragmentCard, ProjectChips, Sidebar
│  └─ lib/
│     ├─ types.ts             # Fragment/Project/Tier/FragmentType (스키마 1:1)
│     ├─ supabase.ts          # 클라이언트 + CRUD + 검색
│     ├─ fixtures.ts          # 백엔드 없이 UI 검증용 하드코딩 데이터
│     ├─ typeDetector.ts      # 타입 자동 판별 (순수 함수)
│     ├─ vividness.ts         # 선명도 계산 (순수 함수)
│     ├─ dates.ts · confirm.ts
│     └─ theme.ts             # 디자인 토큰 단일 파일 (§6.5)
├─ __tests__/                 # typeDetector, vividness (jest-expo)
├─ supabase/schema.sql
└─ web/index.html             # (마일스톤 7)
```

- 아키텍처 패턴: **없음이 패턴.** 전역 상태 라이브러리·컨텍스트 스토어 없음 — 각 화면이
  `lib/supabase.ts`의 async 함수를 직접 호출하고 로컬 state로 들고 있는다.
  1인용 앱에 Redux/Zustand/리포지토리 계층은 과잉 (절대 원칙 5). 아파지면 그때 도입.
- 오프라인 캐시 없음 (MVP). 네트워크 없으면 피드는 에러 + 재시도 버튼.
- **픽스처 모드**: Supabase 키가 비어 있으면(`isConfigured=false`) `lib/fixtures.ts`의
  하드코딩 데이터로 전 화면이 동작 — 백엔드 없이 UI 개발/검증용. 키가 채워지면 자동으로 실서버.
- Expo Go로는 공유 기능 테스트 불가 → `expo-dev-client` 빌드로 개발 (마일스톤 4부터 실기기).

### 3.2 데이터 흐름

- **조회**: `fragments`를 `created_at desc`로 페이지당 100개 range 페이징.
  필터: All(전체) / Inbox(`project_id is null`) / 프로젝트(`project_id = X`).
  기본 조회는 `archived = false`만. 감쇠로 바닥(25%)에 도달한 파편은 archived가 아니므로
  리스트에 계속 남는다 (SPEC §5) — 감쇠와 무덤은 무관하다.
- **무덤(archived)**: 자동으로 묻히는 일은 없다. 사용자가 상세 화면에서 수동으로 "묻기" →
  모든 기본 뷰에서 사라지고, 타임라인 필터 칩 맨 끝의 **무덤** 칩으로만 열람.
  무덤 뷰는 opacity 25% 고정, 파편을 열면 "파내기"(unarchive) 가능. 삭제와는 별개.
- **던지기(저장)**: 로컬에서 타입 판별 → insert → 성공 시 목록 맨 위에 낙관적 반영.
- **touch**: 상세 화면 mount 시 `last_touched_at = now()` patch — 유일한 갱신 시점.
  리스트에서 스쳐 지나가는 것은 touch가 아니다.
- **어젠다 뷰**: 피드와 동일 데이터를 기기 로컬 타임존 기준 날짜로 그룹핑만 다르게.

### 3.3 타입 자동 판별 (확정 규칙, `typeDetector.ts` 단일 구현)

trim 후 위에서부터 첫 매치:

| 순서 | 조건 | 타입 |
|---|---|---|
| 1 | 이미지 첨부 있음 | image |
| 2 | 전체가 URL 하나 (`http://`·`https://`·`www.` 시작, 내부 공백/줄바꿈 없음) | link |
| 3 | 인용부호 쌍으로 감쌈 (`"…"` `“…”` `'…'` `「…」` `『…』`) **또는** 마지막 줄이 `— 출처`/`- 출처` 형태(2~30자) | quote |
| 4 | 그 외 전부 | text |

- 오판별은 허용한다. 타입은 표시 방식만 바꾸므로 치명적이지 않고, 수동 수정 기능은 만들지 않는다 (입력 마찰 0 유지, 필요해지면 v2).
- 웹 입력 페이지는 같은 언어이므로 `typeDetector.ts`의 함수를 그대로 복사해 쓴다 (규칙 2~4만, 이미지 없음). 빌드 공유 인프라는 만들지 않는다 — 복붙이 더 싸다.

### 3.4 선명도 계산 (`vividness.ts`, 순수 함수 + 유닛 테스트)

```
opacity(lastTouchedAt, tier, now):
  pinned                        → 1.0
  d = (now - lastTouchedAt) 일 단위 (음수면 0으로 clamp — 시계 오차 방어)
  (start, floor) = normal: (7, 30) / important: (30, 90)
  d ≤ start                     → 1.0
  d ≥ floor                     → 0.25
  그 외                          → 1.0 − 0.75 × (d − start) / (floor − start)
```

- DB에 저장하지 않는다. 카드/행 렌더링 시점에 계산해 opacity로 적용.
- 수치는 SPEC §5 확정값. 변경 시 이 함수 한 곳만 고친다.

### 3.5 링크 메타데이터 백필

- **저장은 즉시, 메타데이터는 나중에.** insert를 막지 않는다 (입력 마찰 0).
- 앱이 포그라운드 진입 시: `type = 'link' and link_title is null`인 파편 최대 10개를
  네이티브 fetch로 HTML을 받아 `og:title`/`og:image`(없으면 `<title>`)를 추출 → patch.
  (RN의 fetch는 CORS 제약이 없어 브라우저와 달리 직접 수집 가능)
- `link_thumbnail_url`에는 `og:image`의 외부 URL을 그대로 저장 — 버킷 업로드 불필요.
- 웹 페이지에서 던진 링크도 이 경로로 자동 해결된다.
- 실패한 것은 그냥 둔다 — URL 원문이 이미 있으므로 기능 손실 없음. 재시도 카운터 같은 것 안 만든다.

## 4. 공유 저장 설계 — expo-share-intent (최우선 구현 대상)

**방식 (2026-07-12 확정):** 네이티브 share extension을 시트 UI로 만들지 않고,
`expo-share-intent`로 공유 시트에서 Mind 선택 시 **앱 본체가 열리며 페이로드를 수신**한다.

- **흐름**: 공유 버튼 → Mind 선택 (여기까지 2탭) → 앱이 열리며 **자동 판별 + 즉시 insert** →
  상단 토스트 "던져짐". 미리보기·확인 버튼 없음 — 잘못 던진 것은 피드에서 지우면 된다.
  ※ SPEC 화면 5의 "미리보기 + 던지기 버튼"보다 마찰이 더 적은 방향의 의도적 변경 (2탭 유지).
- 입력별 처리:
  - **Safari/유튜브 (URL)**: `content = URL`. 제목이 같이 오면 `link_title` 즉시 저장 (백필 생략).
  - **사진/이미지**: `expo-image-manipulator`로 긴 변 2000px 이하 다운스케일 + JPEG 80% →
    Storage 업로드 → insert.
  - **선택 텍스트**: 타입 판별 후 insert.
- **실패 시**: 에러 표시 + 원문을 빠른 입력 화면에 채워서 보존, 재시도는 수동 (확정 결정 2).
- 세션 공유 장치 불필요 — 앱 본체가 처리하므로 App Group 없이 기존 로그인 세션 그대로.
- 요구사항: `app.json`에 config plugin 등록 → `expo prebuild` → dev client 빌드.
  Expo Go 불가, 실기기 테스트 필수. (유료 개발자 계정 확보됨 — TestFlight 배포 가능)
- 리스크: 커뮤니티 플러그인 의존 — Expo SDK 업그레이드 시 깨질 수 있음.
  대응: SDK 버전 고정, 업그레이드는 공유 기능 실기기 확인과 함께만.

## 5. 웹 입력 페이지 설계

- `web/index.html` 단일 파일. supabase-js는 CDN `<script>`. 빌드 도구 없음.
- 첫 방문: 이메일/비번 로그인 → 세션은 supabase-js가 localStorage에 유지.
- 이후: textarea + [던지기] 버튼이 전부. Cmd/Ctrl+Enter 지원. 타입 판별(§3.3 복사본) 후 insert, 성공 시 입력창 비움.
- 뷰 기능 없음 — 저장 결과 확인은 폰에서.
- 호스팅: 정적 파일이므로 GitHub Pages든 로컬 `file://`이든 동작. 기본은 로컬 파일로 시작.

## 6. 화면별 데이터 요구사항

| 화면 | 필요 데이터/동작 | 스타일 확정 대상 (§6.5 기준) |
|---|---|---|
| 타임라인 피드 | 페이징 조회, 칩(**All + active 프로젝트만**), 날짜 구분선, opacity, 카드 탭→상세, **우→좌 스와이프→수정/삭제** | 카드 레이아웃, 색, 타이포 |
| 사이드바 (Things식) | 좌측 엣지 스와이프/☰로 열기, All·Inbox·프로젝트(상태별 그룹: 진행중/시작전/중단/완료 + 상태 점)·무덤, 탭→필터 전환 | 사이드바 스타일 |
| 어젠다 뷰 | 동일 데이터 날짜 그룹핑, 한 줄 행, opacity, 동일 스와이프/탭 | 헤더/행 스타일 |
| 빠른 입력 | 타입 실시간 판별 배지 + **인식 시 입력창 은은한 글로우**(링크=블루/인용=잉크), 접힌 프로젝트 선택(기본 Inbox), 던지기. `?id=` 로 열면 **내용 수정 모드** | 입력 UI 스타일 |
| 파편 상세 | mount 시 touch, tier 3단 토글, 프로젝트 붙이기/떼기, 묻기/파내기, 수정 진입, 삭제(확인 1회, image 파편은 Storage 객체도 함께 삭제) | 상세 레이아웃 |
| 검색 | 헤더 ⌕ → 모달. 원문·링크 제목 부분일치(ilike), 무덤 포함 전부. 결과 탭→상세 | 검색 UI 스타일 |
| 공유 저장 | 앱 열림 → 자동 저장 + 토스트 (§4) | 토스트 스타일 |
| 웹 입력 | textarea + 던지기 | 페이지 스타일 |

### 6.5 Design.md 적용 방식 (2026-07-12 확정: 다크 반전)

Design.md(Geist 시스템)는 라이트 기준으로 기술되어 있으나, SPEC §7에 따라 MVP는 다크 온리.
**구조 언어(잉크 래더·헤어라인·절제·타이포·radius 체계)는 그대로 가져오고 명암만 반전한다.**
모든 값은 `lib/theme.ts` 한 파일에 토큰으로 모으고 컴포넌트에 하드코딩하지 않는다 — 라이트 모드(v2) 전환 비용 최소화.

**색 토큰 (다크 반전, 실기기에서 미세조정 허용):**

| 토큰 | 라이트(Design.md) | 다크(적용값) | 용도 |
|---|---|---|---|
| canvas | #fafafa | #0a0a0a | 페이지 바탕 — 파편이 이쪽으로 가라앉는다 |
| canvasElevated | #ffffff | #111111 | 카드/입력창/시트 |
| hairline | #ebebeb | #2e2e2e | 1px 보더 — 구조의 주역 |
| hairlineSoft | #f2f2f2 | #1a1a1a | 인셋 웰, 교차 패널 |
| ink | #171717 | #ededed | 제목·본문 최상위, 주 버튼 채움 |
| body | #4d4d4d | #a1a1a1 | 보조 텍스트 |
| mute | #8f8f8f | #7d7d7d | 캡션·메타데이터 |
| faint | #a1a1a1 | #5c5c5c | 플레이스홀더 |
| link | #0070f3 | #52a8ff | 링크·포커스 (다크 대비 확보 위해 밝힘) |
| error | #ee0000 | #ff4d4d | 삭제·오류 |

- 순수 흑/백(#000/#fff)은 쓰지 않는다 — Design.md의 "잉크는 #171717" 원칙의 다크 대응.
- 메시 그라디언트: MVP 앱 화면에는 히어로가 없으므로 **사용하지 않는다**. 유일한 후보는
  웹 입력 페이지 상단 정도 — 그마저 선택 사항. 절제가 시스템이다.
- accent 계열(violet/cyan/pink)은 chrome에 쓰지 않는다. 타입 배지도 잉크 래더로만.

**타이포:** Geist Sans/Mono TTF를 `expo-font`로 번들 (오픈소스).
한글 글리프가 없으므로 한글 본문은 시스템 폰트(Apple SD Gothic Neo) 자동 폴백 — 의도된 동작.
Geist가 실제로 그리는 것: UI 라벨, 숫자(어젠다 날짜 큰 숫자 — negative tracking 적용), mono 아이브로.
웨이트는 600/500/400만 (Design.md 원칙).

**형태 매핑 (bimodal radius 언어 유지):**

| 앱 요소 | Design.md 컴포넌트 | radius |
|---|---|---|
| 던지기 버튼 | button-primary (잉크 채움 pill — 다크에선 #ededed 채움 + #0a0a0a 텍스트) | pill(100px) |
| 프로젝트 필터 칩 | button-category-pill (hairline 아웃라인) | 64px |
| tier 토글, 앱 내 컨트롤 | button-ghost-sm | 6px |
| 파편 카드 | feature-card (canvasElevated + hairline) | 12px |
| 상세/입력 시트 | Level-2 floating (저알파 레이어드 섀도) | 16px |

- 선명도 감쇠는 카드 전체(보더 포함)에 opacity 적용 → 다크 캔버스 속으로 가라앉는 지층감.
- 간격은 Design.md 4px 스케일 토큰 그대로.

## 7. 개발 마일스톤 (SPEC §8 순서, 단계별 verify)

```
1. Expo 프로젝트 생성(+supabase-js) + Supabase 세팅
   → verify: schema.sql 적용 후 curl(anon)으로 조회 시 차단, 로그인 토큰으로 조회 성공.
     시뮬레이터에서 앱 부팅 성공.
2. 모델 타입 + typeDetector + vividness + 유닛 테스트 (jest-expo)
   → verify: 판별 규칙 표·감쇠 경계값(7/30/90일, 음수, pinned) 테스트 전부 통과.
3. 빠른 입력 + 타임라인 피드 (선명도 시각화 포함)
   → verify: 시뮬레이터에서 저장 → 피드 최상단 표시. DB에서 last_touched_at을 과거로 조작 → opacity 감쇠 확인.
4. expo-share-intent 통합 (prebuild + dev client, 실기기 필수)
   → verify: 실기기에서 Safari URL·사진·선택 텍스트 각각 2탭 저장 → 피드에 등장.
5. 파편 상세 (touch / tier / 프로젝트 / 묻기 / 삭제)
   → verify: 바닥(25%) 파편을 열면 피드 복귀 시 100%. tier 변경이 감쇠 커브에 반영.
     묻기 → 기본 피드에서 사라지고 무덤 칩에서 보임, 파내기 → 복귀.
6. 어젠다 뷰
   → verify: 자정 경계 파편이 로컬 타임존 기준 올바른 날짜 섹션에 표시.
7. 웹 입력 페이지
   → verify: 데스크탑 브라우저에서 텍스트·링크 던지기 → 폰 피드에 표시, 링크 제목 백필 확인.
```

- 화면 스타일은 §6.5(Design.md 다크 반전) 기준으로 구현.

## 8. 확정된 결정 (2026-07-12 사용자 답변)

1. **archived = 수동 "무덤"**: 자동 아카이브 없음. 상세에서 수동 "묻기" → 기본 뷰에서 제외,
   무덤 칩(타임라인 필터 맨 끝)으로만 열람, 파내기 가능. 감쇠(바닥 25%)와는 완전히 별개 개념.
   ※ SPEC §4의 "archived = 바닥 여부" 설명은 이 결정으로 대체됨 — SPEC 갱신은 사용자 판단.
2. **네트워크 실패 시**: 에러 표시 + 입력 원문 보존, 수동 재시도. 로컬 큐 없음 (MVP).
3. **보안 모델**: 이메일+비번 계정 1개(대시보드 수동 생성), user_id 없음,
   RLS authenticated 전면 허용 / anon 전면 차단, images 버킷 private — 확정.
4. **Apple Developer 유료 계정**: 실기기 테스트 및 TestFlight 배포 가능.
5. **색 스킴 = 다크 반전**: Design.md의 구조 언어를 유지하고 명암만 반전 (§6.5).
   SPEC §7의 "라이트 모드"가 v2 목록에 있는 것과 일치. 토큰은 theme.ts 단일 파일.
6. **스택 = Expo (React Native + TypeScript), 공유는 expo-share-intent 방식**:
   사용자의 주 언어가 JS라 유지보수 가능성 우선. 공유 저장은 앱 열림 + 자동 저장으로 2탭 유지.
   시트형 extension(expo-share-extension)은 실기기에서 필요성이 확인되면 v2에서 재검토.
7. **내비게이션·CRUD 개편 (사용자 요청)**: Things식 좌측 사이드바(엣지 스와이프),
   상단 칩은 All+active 프로젝트만, 리스트 우→좌 스와이프로 수정/삭제, 파편 내용 수정 기능,
   입력창 타입 인식 글로우. SPEC §6-1의 칩 구성(All/Inbox/프로젝트들)은 이 결정으로 대체.
   ※ 참고: 스와이프 수정/삭제는 '정리 강요'가 아닌 기본 CRUD로, SPEC v2의 "정리 스와이프(솎아내기)"와는 다른 기능.

## 9. 검토 기준 & 검토 기록

**기준 (각 검토 패스가 이 렌즈로 전체 문서를 훑는다):**

- K1 절대 원칙 5개 위반 없음 · K2 v2 금지 목록 미침범 · K3 데이터 모델 = SPEC §4
- K4 선명도 수치 = SPEC §5 · K5 1인용 기준 과잉 설계 없음 · K6 anon key 노출 전제 보안
- K7 공유 저장 기술 실현성 · K8 엣지 케이스(오프라인·대용량·타임존·중복탭·빈 입력)
- K9 모든 마일스톤에 검증 기준 존재 · K10 Design.md 적용 일관성(§6.5 밖 스타일 결정 금지)

**10회 검토 결과 요약 (SwiftUI 기준 초안에 대해 수행, 결과는 Expo 전환 후에도 유효):**

| 패스 | 렌즈 | 발견 → 조치 |
|---|---|---|
| 1 | K1 | 초안의 타입 수동 수정 기능이 마찰 추가 → 제거, 오판별 허용 명시 (§3.3) |
| 2 | K2 | 백필 재시도 카운터가 사실상 관리 기능 → 제거 (§3.5). 검색·위젯 등 언급 없음 확인 |
| 3 | K3 | 필드 1:1 대조 통과. archived 의미만 SPEC 내부 충돌 → 질문 1 |
| 4 | K4 | 7/30, 30/90, 25%, 선형, pinned 무감쇠, 미저장 — 전부 일치 |
| 5 | K5 | 초안의 전역 스토어 제거 → 화면이 직접 호출하는 구조로 단순화 (§3.1) |
| 6 | K6 | 초안이 Storage public이었음 → private + signed URL로 수정 (§2.3). RLS anon 차단 확인 |
| 7 | K7 | 세션 공유·메모리 상한 리스크 식별 → (Expo 전환으로 두 리스크 모두 소멸, §4 참조) |
| 8 | K8 | 음수 경과시간 clamp 추가(§3.4), 던지기 버튼 중복탭 방지·빈 입력 비활성은 구현 규칙으로 채택, 오프라인 → 질문 2 |
| 9 | K9 | 마일스톤 3의 verify가 "잘 나오는지"로 모호했음 → last_touched_at 조작 검증으로 구체화 |
| 10 | K10 | 문서 전체에서 §6.5 밖 스타일 결정 없음 확인. 다운스케일 2000px는 기술 파라미터로 유지 |

**답변 반영 후 추가 확인 (무덤 기능):** 수동·선택적 행위이므로 "정리를 요구하지 않는다" 원칙과
충돌 없음(요구가 아니라 허용). 새 화면 추가 없이 기존 필터 칩으로 진입 — v2 금지 목록 미침범.

**Expo 전환 후 재검토 (2026-07-12):** K1~K10 재적용. 소멸한 리스크: extension 세션 공유,
extension 메모리 상한, Swift/JS 타입 판별 중복. 새 리스크: expo-share-intent 커뮤니티 플러그인
의존(§4에 대응 명시), 공유 시 앱 전환으로 원래 화면 복귀에 앱 스위치 1회 필요(수용).
자동 저장으로 SPEC 화면 5의 "미리보기+버튼"을 대체 — 마찰이 줄어드는 방향의 변경이므로 원칙 합치.
