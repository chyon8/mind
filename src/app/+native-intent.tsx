import { getShareExtensionKey } from 'expo-share-intent';

// 공유 시트로 앱이 열리면 iOS가 mind://dataUrl=... 딥링크로 깨운다.
// 대응하는 라우트가 없어 "Unmatched Route"가 뜨므로 홈으로 돌린다.
// 페이로드는 네이티브 모듈이 들고 있고, 저장은 ShareIntentHandler가 전역에서 처리한다 (PLAN §4).
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) return '/';
  } catch {
    return '/';
  }
  return path;
}
