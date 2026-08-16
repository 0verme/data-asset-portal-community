export async function runOptimisticStatusMutation({ apply, request, rollback, onError }) {
  apply();
  try {
    return await request();
  } catch (error) {
    rollback();
    onError(error);
    return null;
  }
}
