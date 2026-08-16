import React from "react";
import { getCodeItems, getCodeItemsBatch } from "../api/commonCodes.js";
import { getErrorMessage } from "../utils/ui.js";

export function normalizeDictOptions(items = []) {
  return items
    .map((item) => {
      if (typeof item === "string") {
        return { code: "", value: item, name: item };
      }
      return {
        code: item.code || item.itemCode || "",
        value: item.value || item.name || "",
        name: item.name || item.value || "",
      };
    })
    .filter((item) => item.value);
}

export async function getDictOptions(categoryCode, fallback = []) {
  try {
    const items = await getCodeItems(categoryCode);
    return normalizeDictOptions(items);
  } catch (error) {
    if (fallback.length) return normalizeDictOptions(fallback);
    throw error;
  }
}

export async function getDictOptionsBatch(categoryCodes = []) {
  const payload = await getCodeItemsBatch(categoryCodes);
  const options = Object.fromEntries(payload.categoryCodes.map((code) => [code, []]));
  for (const item of payload.items) {
    if (!options[item.categoryCode]) continue;
    options[item.categoryCode].push(...normalizeDictOptions([item]));
  }
  return {
    options,
    missingCodes: payload.missingCodes,
  };
}

export function findDictOption(options = [], value = "") {
  return options.find((item) => (typeof item === "string" ? item === value : item.value === value)) || null;
}

export function isLegacyDictValue(options = [], value = "") {
  return Boolean(value) && !findDictOption(options, value);
}

export function getLegacyAwareOptions(options = [], currentValue = "") {
  if (!isLegacyDictValue(options, currentValue)) return options;
  return [
    ...options,
    {
      code: "__legacy__",
      value: currentValue,
      name: currentValue,
      legacy: true,
    },
  ];
}

export function useDictOptions(categoryCode, { fallback = [] } = {}) {
  const fallbackSignature = JSON.stringify(fallback || []);
  const normalizedFallback = React.useMemo(
    () => normalizeDictOptions(fallback),
    [fallbackSignature],
  );
  const [options, setOptions] = React.useState(() => normalizedFallback);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!categoryCode) {
        setOptions(normalizedFallback);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const nextOptions = await getDictOptions(categoryCode, normalizedFallback);
        if (!cancelled) setOptions(nextOptions);
      } catch (loadError) {
        if (!cancelled) {
          setOptions(normalizedFallback);
          setError(getErrorMessage(loadError, "字典选项加载失败。"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [categoryCode, normalizedFallback]);

  return { options, loading, error };
}
