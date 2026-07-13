// PLAN.md §6.5 — Design.md(Geist)의 다크 반전 토큰. 컴포넌트에 하드코딩 금지, 전부 여기서.
// 라이트 모드는 v2 — 그때 이 파일만 스킴 분기하면 된다.

import type { TextStyle } from 'react-native';

export const colors = {
  canvas: '#0a0a0a', // 페이지 바탕 — 파편이 이쪽으로 가라앉는다
  canvasElevated: '#111111', // 카드/입력창/시트
  hairline: '#2e2e2e', // 1px 보더 — 구조의 주역
  hairlineSoft: '#1a1a1a', // 인셋 웰, 교차 패널
  ink: '#ededed', // 최상위 텍스트, 주 버튼 채움
  onInk: '#0a0a0a', // 잉크 채움 버튼 위의 텍스트
  body: '#b3b3b3',
  mute: '#8a8a8a',
  faint: '#5f5f5f',
  link: '#52a8ff',
  error: '#ff4d4d',
} as const;

// Design.md 4px 스케일
export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  card: 20, // 카드 내부 패딩 (가독성)
  lg: 24,
  xl: 32,
  xxl: 40,
  xxxl: 64,
} as const;

export const rounded = {
  sm: 6, // 앱 내 컨트롤 (tier 토글 등)
  md: 12, // 파편 카드
  lg: 16, // 상세/입력 시트
  chip: 64, // 프로젝트 필터 칩
  pill: 100, // 던지기 버튼
} as const;

// 웨이트는 600/500/400만 (Design.md 원칙). 한글은 시스템 폰트로 자동 폴백.
export const fonts = {
  sans: 'Geist_400Regular',
  sansMedium: 'Geist_500Medium',
  sansSemiBold: 'Geist_600SemiBold',
  mono: 'GeistMono_500Medium', // 업퍼케이스 아이브로, 타입 배지
} as const;

// Design.md 타입 스케일 (모바일에 맞게 display만 축소)
export const type = {
  displayLg: { fontSize: 40, lineHeight: 44, letterSpacing: -2 }, // 어젠다 날짜 큰 숫자
  headingMd: { fontSize: 20, lineHeight: 28, letterSpacing: -0.4 },
  labelSm: { fontSize: 14, lineHeight: 20, letterSpacing: -0.28 },
  monoEyebrow: { fontSize: 12, lineHeight: 16, letterSpacing: 0.5 }, // 업퍼케이스
  bodyLg: { fontSize: 17, lineHeight: 26 }, // 파편 본문 — 주인공
  bodyMd: { fontSize: 15, lineHeight: 21 },
  bodySm: { fontSize: 12, lineHeight: 16 },
} as const;

export const FLOOR_OPACITY = 0.25; // 무덤 뷰 고정 opacity (SPEC §5의 바닥값과 동일)

// 웹(react-native-web)에서 TextInput에 그려지는 브라우저 기본 파란 포커스 링을 끈다.
// outline-style:auto는 outline-width를 무시하므로 style 자체를 none으로 꺼야 한다.
// RN 네이티브 타입엔 'none'이 없어 캐스팅이 필요하다. 네이티브에선 무시된다.
export const noFocusRing = { outlineStyle: 'none' } as unknown as TextStyle;
