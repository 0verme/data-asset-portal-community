import { useCallback, useEffect, useRef, useState } from "react";

import { getErrorMessage } from "../utils/ui.ts";

export interface BusinessOptionLoadState<T> {
  catalog: T | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
}

export function useBusinessOptionCatalog<T>(
  enabled: boolean,
  load: () => Promise<T>,
  reloadKey: string,
  failureMessage: string,
): BusinessOptionLoadState<T> {
  const [catalog, setCatalog] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    const request = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const result = await load();
      if (request === sequence.current) setCatalog(result);
    } catch (caught: unknown) {
      if (request === sequence.current) {
        setCatalog(null);
        setError(getErrorMessage(caught, failureMessage));
      }
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [failureMessage, load]);

  useEffect(() => {
    if (!enabled) {
      sequence.current += 1;
      setCatalog(null);
      setLoading(false);
      setError("");
      return;
    }
    void reload();
    return () => {
      sequence.current += 1;
    };
  }, [enabled, reload, reloadKey]);

  return { catalog, loading, error, reload };
}
