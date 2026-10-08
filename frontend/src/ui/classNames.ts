export function joinClassNames(...values: Array<string | false | null | undefined>): string {
  const classes = values.filter((value): value is string => Boolean(value));
  return classes.join(" ");
}
