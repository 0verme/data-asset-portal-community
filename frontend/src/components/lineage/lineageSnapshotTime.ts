const SNAPSHOT_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,]\d+)?\s*(Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?$/i;

export function formatLineageSnapshotTime(value?: unknown) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(SNAPSHOT_TIMESTAMP);
  if (!match) return null;

  const [, date, hour, minute, second, offset] = match;
  const clock = `${hour}:${minute}:${second}`;
  const calendarCheck = new Date(`${date}T${clock}Z`);
  if (Number.isNaN(calendarCheck.getTime()) || calendarCheck.toISOString().slice(0, 19) !== `${date}T${clock}`) {
    return null;
  }

  const timezone = offset?.toUpperCase() === "Z" ? "UTC" : offset?.replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
  return { text: timezone ? `${date} ${clock} ${timezone}` : `${date} ${clock}`, hasOffset: Boolean(timezone) };
}
