import { BINARY_STATUS_OPTIONS } from '../components/common/status.ts';

export interface StatusOptionItem {
  value: string;
  name: string;
}

export interface UseStatusOptionsResult {
  statusOptions: StatusOptionItem[];
  statusLoading: boolean;
  statusError: string;
}

export function useStatusOptions(): UseStatusOptionsResult {
  return {
    statusOptions: [...BINARY_STATUS_OPTIONS],
    statusLoading: false,
    statusError: '',
  };
}
