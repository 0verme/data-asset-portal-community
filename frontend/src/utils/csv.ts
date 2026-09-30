export function serializeCsvRows(rows: readonly (readonly unknown[])[]): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          let text = String(value ?? "");
          if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
          return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(","),
    )
    .join("\r\n");
}

export function downloadCsvContent(fileName: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
}

export function downloadCsvRows(
  fileName: string,
  rows: readonly (readonly unknown[])[],
): void {
  downloadCsvContent(fileName, `\uFEFF${serializeCsvRows(rows)}`);
}
