import { useEffect, useState } from 'react';
import { getImageUrl } from './supabase';

// image 파편의 서명 URL. 아직 못 받았으면 null — 호출부는 빈 자리(well)를 보여준다.
export function useImageUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    getImageUrl(path)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}
