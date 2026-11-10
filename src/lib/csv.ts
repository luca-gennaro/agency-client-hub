const PHONE_LIKE = /^[+-][\d\s().-]*$/;

/** Escape a single CSV cell, neutralising spreadsheet formulas. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  const first = text.charAt(0);
  const isFormula =
    first === "=" ||
    first === "@" ||
    first === "\t" ||
    first === "\r" ||
    ((first === "+" || first === "-") && !PHONE_LIKE.test(text));
  if (isFormula) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
