import { useCallback } from "react";

import { popModuleNavigationState } from "../routing/navigation.ts";

export function useSmartBack({ moduleKey, onRestore, onFallback }) {
  return useCallback(() => {
    const snapshot = popModuleNavigationState(moduleKey);
    if (snapshot) {
      onRestore?.(snapshot);
      return;
    }
    onFallback?.();
  }, [moduleKey, onFallback, onRestore]);
}
