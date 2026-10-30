export interface ParsedRoot {
  abbr: string;
  en: string;
  cn: string;
  cat: string;
  desc: string;
  _line: number;
}

interface DelimitedRecord {
  cells: string[];
  line: number;
}

interface ParseFailure {
  line: number;
  message: string;
}

type Delimiter = "," | "\t" | "|";
type FieldState = "start" | "unquoted" | "quoted" | "afterQuote";

function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { "\t": 0, ",": 0, "|": 0 };
  let quoted = false;
  let recordStarted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
      recordStarted = true;
      continue;
    }
    if (quoted) continue;
    if (character === "\r" || character === "\n") {
      if (recordStarted || Object.values(counts).some((count) => count > 0)) break;
      continue;
    }
    if (character === "\t" || character === "," || character === "|") {
      counts[character] += 1;
      continue;
    }
    if (!/\s/.test(character ?? "")) recordStarted = true;
  }

  // Keep the legacy spreadsheet-import preference so commas inside a TSV
  // description (or pipes inside a delimited row) cannot win by sheer count.
  if (counts["\t"] > 0) return "\t";
  if (counts["|"] > 0) return "|";
  return ",";
}

/** Parse RFC-4180-style quoted records while retaining their physical source line. */
function parseRecords(text: string, delimiter: Delimiter): { records: DelimitedRecord[]; failure?: ParseFailure } {
  const records: DelimitedRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let fieldQuoted = false;
  let state: FieldState = "start";
  let line = 1;
  let recordStartLine = 1;
  let quoteStartLine = 1;
  let recordTouched = false;

  const finishField = (): void => {
    cells.push(fieldQuoted ? field : field.trim());
    field = "";
    fieldQuoted = false;
    state = "start";
  };

  const finishRecord = (): void => {
    finishField();
    if (recordTouched) records.push({ cells, line: recordStartLine });
    cells = [];
    recordTouched = false;
  };

  const lineBreakAt = (index: number): string =>
    text[index] === "\r" && text[index + 1] === "\n" ? "\r\n" : (text[index] ?? "");

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (character === "\r" || character === "\n") {
      const lineBreak = lineBreakAt(index);
      if (state === "quoted") {
        field += lineBreak;
      } else {
        finishRecord();
        recordStartLine = line + 1;
      }
      line += 1;
      if (lineBreak.length === 2) index += 1;
      continue;
    }

    if (state === "quoted") {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          state = "afterQuote";
        }
      } else {
        field += character;
      }
      continue;
    }

    if (state === "afterQuote") {
      if (character === delimiter) {
        finishField();
      } else if (character === " " || (character === "\t" && delimiter !== "\t")) {
        // Permit harmless padding after a closing quote; it is trimmed as before.
      } else {
        return {
          records: [],
          failure: { line, message: "闭合引号后存在非法字符" },
        };
      }
      continue;
    }

    if (state === "start") {
      if (character === delimiter) {
        recordTouched = true;
        finishField();
      } else if (character === '"') {
        if (field.trim()) {
          return {
            records: [],
            failure: { line, message: "引号只能出现在字段开头" },
          };
        }
        field = "";
        fieldQuoted = true;
        state = "quoted";
        quoteStartLine = line;
        recordTouched = true;
      } else if (character === " " || (character === "\t" && delimiter !== "\t")) {
        field += character;
        recordTouched = true;
      } else {
        field += character;
        state = "unquoted";
        recordTouched = true;
      }
      continue;
    }

    if (character === delimiter) {
      finishField();
      recordTouched = true;
    } else if (character === '"') {
      return {
        records: [],
        failure: { line, message: "未加引号字段中出现双引号" },
      };
    } else {
      field += character;
      recordTouched = true;
    }
  }

  if (state === "quoted") {
    return {
      records: [],
      failure: { line: quoteStartLine, message: "引号未闭合" },
    };
  }

  if (recordTouched || cells.length > 0 || field.length > 0) finishRecord();
  return { records };
}

export function parseRootImport(text: string): { items: ParsedRoot[]; error?: string } {
  const content = text.replace(/^\uFEFF/, "");
  if (!content.trim()) return { items: [], error: "内容为空" };

  const { records, failure } = parseRecords(content, detectDelimiter(content));
  if (failure) {
    return {
      items: [],
      error: `第 ${failure.line} 行格式错误：${failure.message}`,
    };
  }
  if (!records.length) return { items: [], error: "内容为空" };

  const firstRow = (records[0]?.cells ?? []).map((cell) => cell.toLowerCase());
  const hasHeader = firstRow.some((cell) => /abbr|root|词根|缩写/.test(cell));
  const startIndex = hasHeader ? 1 : 0;
  const header = hasHeader ? firstRow : [];
  const indexMap: Record<"abbr" | "en" | "cn" | "cat" | "desc", number> = {
    abbr: 0,
    en: 1,
    cn: 2,
    cat: 3,
    desc: 4,
  };

  header.forEach((cell, index) => {
    if (/abbr|root|词根|缩写/.test(cell)) indexMap.abbr = index;
    if (/en|english|全称/.test(cell)) indexMap.en = index;
    if (/cn|中文|名称/.test(cell)) indexMap.cn = index;
    if (/cat|分类|类别/.test(cell)) indexMap.cat = index;
    if (/desc|说明|备注|示例/.test(cell)) indexMap.desc = index;
  });

  return {
    items: records.slice(startIndex).map(({ cells: row, line: sourceLine }) => ({
      abbr: row[indexMap.abbr] || "",
      en: row[indexMap.en] || "",
      cn: row[indexMap.cn] || "",
      cat: row[indexMap.cat] || "",
      desc: row[indexMap.desc] || "",
      _line: sourceLine,
    })),
  };
}
