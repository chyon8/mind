import { useState } from 'react';

// 합치기 전용 선택 모드 — 롱프레스로 진입, 다른 일괄 작업은 없다 (SPEC §7 재검토, 2026-07-15).
export function useMergeSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const active = selected.size > 0;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clear() {
    setSelected(new Set());
  }

  return { selected, active, toggle, clear };
}
