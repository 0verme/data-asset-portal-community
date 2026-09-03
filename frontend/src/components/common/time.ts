const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(value: unknown): boolean {
  return TIME_PATTERN.test(String(value ?? ""));
}
