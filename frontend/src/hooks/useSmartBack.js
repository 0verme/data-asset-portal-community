import { useCallback } from "react";

import { popModuleNavigationState } from "../routing/navigation.js";

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
