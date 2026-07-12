# CLAUDE.md — 개발 가이드라인

> Behavioral guidelines to reduce common LLM coding mistakes.
>
> **Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 프로젝트 문서 체계

- **SPEC.md** — 기획서. 절대 원칙 포함, 구현 결정과 충돌 시 SPEC이 이긴다.
- **PLAN.md** — 기술 설계 + 개발 마일스톤. 구현 전 해당 섹션 확인.
- **Design.md** — 비주얼 스타일 원천 (Geist 시스템, 라이트 기준). 앱은 다크 반전 적용 — PLAN.md §6.5의 매핑을 따른다.

스택: Expo(React Native + TypeScript) + expo-share-intent + Supabase + 순수 HTML 웹 입력 페이지. 사용자는 한 명.

---

## 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

---

## 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

---

## 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

**The test:** Every changed line should trace directly to the user's request.

---

## 4. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.


---

## 5. Git 워크플로우 (필수 준수)

> **절대 규칙:** AI는 터미널에서 git 명령어를 직접 실행하지 않는다.
> 사용자가 복사-붙여넣기 할 수 있는 명령어만 제공한다.

### 파일 변경 시 프로세스

코드 변경이 발생하면 반드시 아래 순서를 따른다:

#### Step 1: 변경 리포트

변경된 파일 목록과 각 파일의 변경 내용을 설명한다.

```
📁 변경된 파일:
- Mind/components/FragmentCard.tsx — [무엇을 왜 변경했는지]
- web/index.html — [무엇을 왜 변경했는지]

📝 변경 요약:
[전체적으로 어떤 기능이 바뀌었는지 한 줄 설명]
```

#### Step 2: 검토 체크리스트

사용자가 변경 사항을 확인할 수 있는 구체적인 체크리스트를 제공한다.

```
✅ 검토 체크리스트:
- [ ] 시뮬레이터(또는 실기기)에서 [특정 화면]을 열어 [특정 동작] 확인
- [ ] [특정 입력]을 해보면 [기대 결과]가 나와야 함
- [ ] 웹 입력 페이지 변경 시: 브라우저에서 [특정 동작] 확인
```

#### Step 3: 사용자 컨펌 대기

사용자가 "확인" 또는 "컨펌"이라고 할 때까지 대기한다.

#### Step 4: Git 명령어 제공

사용자가 컨펌하면, 복사-붙여넣기용 git 명령어를 제공한다.

````
```bash
git add -A
git commit -m "feat: [변경 내용 요약]"
git push origin main
```
````

### 커밋 메시지 규칙

- `feat:` 새 기능
- `fix:` 버그 수정
- `refactor:` 리팩토링 (기능 변경 없음)
- `style:` 스타일/UI 변경
- `docs:` 문서 변경
- `chore:` 설정, 의존성 등

### 금지 사항

- ❌ AI가 `git add`, `git commit`, `git push` 등을 터미널에서 직접 실행하는 것
- ❌ 사용자 컨펌 없이 커밋 명령어를 제공하는 것
- ❌ 변경 리포트 없이 바로 커밋을 제안하는 것
