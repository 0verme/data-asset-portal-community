import { BINARY_STATUS_OPTIONS } from "../components/common/status.js";

export function useStatusOptions() {
  return {
    statusOptions: BINARY_STATUS_OPTIONS,
    statusLoading: false,
    statusError: "",
  };
}
