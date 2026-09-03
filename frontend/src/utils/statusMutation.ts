export interface OptimisticStatusMutationOptions<T = unknown> {
  apply: () => void;
  request: () => Promise<T>;
  rollback: () => void;
  onError: (error: unknown) => void;
}

export async function runOptimisticStatusMutation<T = unknown>({
  apply,
  request,
  rollback,
  onError,
}: OptimisticStatusMutationOptions<T>): Promise<T | null> {
  apply();
  try {
    return await request();
  } catch (error) {
    rollback();
    onError(error);
    return null;
  }
}
