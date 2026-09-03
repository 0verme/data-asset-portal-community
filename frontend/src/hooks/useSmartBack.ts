import { useCallback } from 'react';
import { popModuleNavigationState } from '../routing/navigation.ts';

export interface SmartBackOptions<T = unknown> {
  moduleKey: string;
  onRestore?: ((snapshot: T) => void) | undefined;
  onFallback?: (() => void) | undefined;
}

export function useSmartBack<T = unknown>({
  moduleKey,
  onRestore,
  onFallback,
}: SmartBackOptions<T>): () => void {
  return useCallback(() => {
    const snapshot = popModuleNavigationState(moduleKey) as T | null;
    if (snapshot !== null && snapshot !== undefined) {
      onRestore?.(snapshot);
      return;
    }
    onFallback?.();
  }, [moduleKey, onFallback, onRestore]);
}
