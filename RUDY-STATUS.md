# RUDY-STATUS.md — 빌드 진행 상황 (세션 핸드오프)

> 새 세션은 이 파일부터 읽는다. 설계=RUDY.md, 빌드 스펙=RUDY-BUILD.md, 진행상황=여기.
> 마지막 갱신: 2026-07-19.

## 진행 상태

| Phase | 내용 | 코드 | 배포/검증 |
|---|---|---|---|
| 0 | 임베딩 파이프라인 (rudy 스키마·embed 웹훅·백필) | ✅ | ✅ 실사용 중 |
| 0+ | 링크 임베딩 품질 (og:description + 유튜브 shortDescription) | ✅ | ✅ |
| A | 하이브리드 의미검색 (search_fragments RPC + 검색창 교체) | ✅ | ⚠️ **아래 확인 대기** |
| A+ | 검색 UI (로딩 표시·뒤로가기 결과유지·타입필터 칩) | ✅ | 기기 검증 필요 |
| B | 충돌 회상 (recall.ts 개선) | ⬜ 미착수 | — |
| C | 채팅 RAG | ⬜ **다음 차례** | — |

## Supabase 배포 상태 (코드 밖 수동 작업)

이미 적용됨: rudy 스키마, `rudy` Exposed schemas 추가, `OPENAI_API_KEY` 시크릿,
`embed`·`embed-query` 함수 배포, fragments Insert/Update 웹훅, `link_description` 컬럼,
임베딩 백필 완료.

**재실행 필요 여부 미확인:** `supabase/rudy-search.sql` (타입필터 4-arg RPC로 갱신됨).
클라가 4-arg로 호출하므로 이 SQL을 재실행 안 했으면 **매 검색이 조용히 키워드 폴백**한다.

## ⚠️ 확인 대기 (다음 세션 첫 할 일)

"음악" 검색이 2개만 나온다는 리포트 미해결. 진단:
```
node scripts/check-search.mjs "음악"
```
- "function does not exist" → rudy-search.sql 재실행
- 많이 나옴 → RPC 정상, 앱에선 텍스트 칩이 켜져 있던 것

무성 폴백이 계속 혼란 주면 → 폴백을 조용히 말고 에러 표시로 바꿀지 결정 (supabase.ts searchFragments의 catch).

## 스크립트 인벤토리 (전부 로컬 node 실행, service role 필요)

| 스크립트 | 용도 | 성격 |
|---|---|---|
| backfill-embeddings.mjs | 기존 파편 전체 임베딩 | 일회성(완료) |
| backfill-link-desc.mjs | 기존 링크 og:description 채우기 | 일회성 |
| fix-youtube-descriptions.mjs | 유튜브 홍보문구 오염값 → 실제 설명 재계산 | 일회성 |
| check-embeddings.mjs | 임베딩 유사도 실측 (`--links` 링크만) | 진단 |
| check-search.mjs | search_fragments RPC 직접 검증 | 진단 |

## 구현 중 내린 결정 (RUDY-BUILD 대비 변경/확정)

- **링크 임베딩 = 제목+og:description** (요약 아님). 유튜브는 og:description이 홍보문구로 오염돼
  페이지의 `ytInitialPlayerResponse.shortDescription`을 직접 파싱 (linkMeta.ts + 스크립트 동일 로직).
- **다이제스트(LLM 요약·의도) 보류.** 이유는 비용 아님 — (1) 보여줄 표면 없음, (2) 검색품질은
  설명글 임베딩으로 이미 해결, (3) 의도 해석은 lazy가 §2-1 정합. → Phase C(채팅) 만들 때 lazy 계산.
- **검색 폴백**: 임베딩/RPC 실패 시 키워드 검색으로 자동 폴백(+console.warn). 검색이 OpenAI에 안 묶이게.
- **타입 필터 = 서버(RPC)에서** (클라 후필터 아님 — 상위 결과가 특정 타입에 밀리지 않게).
- 스크립트는 `.ts` 대신 `.mjs` (TS 러너 미설치). embedText/해시는 embed 함수와 반드시 동일(해시 일치).

## 다음: Phase C — 채팅 RAG (RUDY-BUILD.md §C)

`chat` Edge Function(스트리밍 RAG) + 채팅 탭 + `rudy.conversations/messages` + 자발적 연결 + 원탭 진입.

**⚠️ 여기서 Fable 전환 검토 (유저 지시).** 두 지점이 어렵거나 delicate:
1. **RN `fetch` 스트리밍** — 표준 `getReader()`가 RN에서 안 먹는 알려진 함정. SSE 소비 방식 설계 필요.
2. **Rudy 시스템 프롬프트** — §2-b 목소리 + §2-1 규정 금지 화법(시간한정·정체성단정 금지)이 캐릭터를 결정.
   RUDY-BUILD §C-1에 초안 있음. 인용 없는 단정 금지, touch 불변(§2-3).

**착수 전 확정:** `OPENAI_CHAT_MODEL` env로 모델 뺌(코드에 하드코딩 X), 채팅은 touch 갱신 절대 금지.
