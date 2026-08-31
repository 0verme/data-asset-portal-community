import { useDictOptions } from "./useDictOptions.js";

const STATUS_FALLBACK = [
  { value: "enabled", name: "启用" },
  { value: "disabled", name: "禁用" },
];

export function useStatusOptions() {
  const { options: statusOptions, loading, error } = useDictOptions("SYSTEM_STATUS", {
    fallback: STATUS_FALLBACK,
  });

  return { statusOptions, statusLoading: loading, statusError: error };
}
