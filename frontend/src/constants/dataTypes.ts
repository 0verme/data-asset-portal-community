export const PG_DWS_DATA_TYPES = [
  "VARCHAR(64)",
  "VARCHAR(128)",
  "TEXT",
  "INTEGER",
  "BIGINT",
  "NUMERIC(18,2)",
  "NUMERIC(20,6)",
  "DATE",
  "TIMESTAMP",
  "BOOLEAN",
] as const;

export const DATA_TYPE_BASE_OPTIONS = [
  "VARCHAR",
  "TEXT",
  "INTEGER",
  "BIGINT",
  "NUMERIC",
  "DATE",
  "TIMESTAMP",
  "BOOLEAN",
] as const;

export type DataTypeBaseOption = (typeof DATA_TYPE_BASE_OPTIONS)[number];

export const DEFAULT_DATA_TYPE = "VARCHAR(64)";
export const DEFAULT_VARCHAR_LENGTH = 64;
export const DEFAULT_NUMERIC_PRECISION = 18;
export const DEFAULT_NUMERIC_SCALE = 2;

const DECIMAL_TYPE_RE = /^(?:decimal|numeric)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)$/i;
const VARCHAR_TYPE_RE = /^(?:varchar|character varying)\s*\(\s*(\d+)\s*\)$/i;

const LEGACY_TYPE_MAP: Record<string, string> = {
  string: DEFAULT_DATA_TYPE,
  text: "TEXT",
  int: "INTEGER",
  integer: "INTEGER",
  bigint: "BIGINT",
  date: "DATE",
  timestamp: "TIMESTAMP",
  boolean: "BOOLEAN",
  double: "NUMERIC(20,6)",
  float: "NUMERIC(20,6)",
};

export interface ColumnTypeParts {
  baseType: string;
  length: string;
  precision: string;
  scale: string;
  normalizedType: string;
}

export interface ColumnTypeInput {
  baseType?: string | undefined;
  typeBase?: string | undefined;
  length?: string | number | undefined;
  typeLength?: string | number | undefined;
  precision?: string | number | undefined;
  typePrecision?: string | number | undefined;
  scale?: string | number | undefined;
  typeScale?: string | number | undefined;
}

export function normalizeDataType(type?: unknown): string {
  const rawType = String(type ?? "").trim();
  if (!rawType) {
    return DEFAULT_DATA_TYPE;
  }

  const normalized = rawType.toLowerCase();
  const decimalMatch = normalized.match(DECIMAL_TYPE_RE);
  if (decimalMatch && decimalMatch[1] && decimalMatch[2]) {
    return `NUMERIC(${decimalMatch[1]},${decimalMatch[2]})`;
  }

  const varcharMatch = normalized.match(VARCHAR_TYPE_RE);
  if (varcharMatch && varcharMatch[1]) {
    return `VARCHAR(${varcharMatch[1]})`;
  }

  if (normalized === "varchar") {
    return DEFAULT_DATA_TYPE;
  }

  if (normalized === "decimal" || normalized === "numeric") {
    return `NUMERIC(${DEFAULT_NUMERIC_PRECISION},${DEFAULT_NUMERIC_SCALE})`;
  }

  if (LEGACY_TYPE_MAP[normalized]) {
    return LEGACY_TYPE_MAP[normalized]!;
  }

  return rawType.toUpperCase();
}

export function normalizeFieldDataType<T extends { type?: unknown }>(
  field: T,
): T & { type: string } {
  return {
    ...field,
    type: normalizeDataType(field?.type),
  };
}

export function parseColumnType(type?: unknown): ColumnTypeParts {
  const normalized = normalizeDataType(type);
  const varcharMatch = normalized.match(VARCHAR_TYPE_RE);
  if (varcharMatch && varcharMatch[1]) {
    return {
      baseType: "VARCHAR",
      length: varcharMatch[1],
      precision: "",
      scale: "",
      normalizedType: normalized,
    };
  }

  const decimalMatch = normalized.match(DECIMAL_TYPE_RE);
  if (decimalMatch && decimalMatch[1] && decimalMatch[2]) {
    return {
      baseType: "NUMERIC",
      length: "",
      precision: decimalMatch[1],
      scale: decimalMatch[2],
      normalizedType: normalized,
    };
  }

  return {
    baseType: normalized,
    length: "",
    precision: "",
    scale: "",
    normalizedType: normalized,
  };
}

export function parseDataTypeParts(type?: unknown): ColumnTypeParts {
  return parseColumnType(type);
}

function sanitizePositiveInteger(value?: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function buildColumnType(
  input?: ColumnTypeInput | string,
  legacyLength?: string | number,
): string {
  const source: ColumnTypeInput =
    typeof input === "object" && input !== null
      ? input
      : {
          baseType: typeof input === "string" ? input : undefined,
          length: legacyLength,
        };
  const normalizedBaseType = String(source.baseType || source.typeBase || "")
    .trim()
    .toUpperCase();

  if (normalizedBaseType === "VARCHAR") {
    const numericLength = sanitizePositiveInteger(
      source.length ?? source.typeLength,
    );
    const finalLength = numericLength || String(DEFAULT_VARCHAR_LENGTH);
    return `VARCHAR(${finalLength})`;
  }

  if (normalizedBaseType === "NUMERIC") {
    const precisionValue = sanitizePositiveInteger(
      source.precision ?? source.typePrecision,
    );
    const scaleValue = sanitizePositiveInteger(
      source.scale ?? source.typeScale,
    );
    const finalPrecision = precisionValue || String(DEFAULT_NUMERIC_PRECISION);
    const finalScale = scaleValue || String(DEFAULT_NUMERIC_SCALE);
    return `NUMERIC(${finalPrecision},${finalScale})`;
  }

  return normalizeDataType(normalizedBaseType || DEFAULT_DATA_TYPE);
}

export function buildDataType(
  baseType?: ColumnTypeInput | string,
  length?: string | number,
): string {
  return buildColumnType(baseType, length);
}

export function validateColumnType(input?: ColumnTypeInput | string): string {
  const source: ColumnTypeInput =
    typeof input === "object" && input !== null
      ? input
      : parseColumnType(input);
  const baseType = String(source.baseType || source.typeBase || "")
    .trim()
    .toUpperCase();

  if (baseType === "VARCHAR") {
    const length = String(source.length ?? source.typeLength ?? "").trim();
    if (!/^\d+$/.test(length) || Number(length) <= 0) {
      return "VARCHAR 长度必须为正整数";
    }
    return "";
  }

  if (baseType === "NUMERIC") {
    const precision = String(
      source.precision ?? source.typePrecision ?? "",
    ).trim();
    const scale = String(source.scale ?? source.typeScale ?? "").trim();

    if (!/^\d+$/.test(precision) || Number(precision) <= 0) {
      return "NUMERIC precision 必须为正整数";
    }

    if (!/^\d+$/.test(scale) || Number(scale) < 0) {
      return "NUMERIC scale 必须为 0 或正整数";
    }

    if (Number(scale) > Number(precision)) {
      return "NUMERIC scale 不能大于 precision";
    }
  }

  return "";
}

export function normalizeFieldList<T extends { type?: unknown }>(
  fields?: T[] | null,
): Array<T & { type: string }> {
  return Array.isArray(fields) ? fields.map(normalizeFieldDataType) : [];
}

export function normalizeAssetRiskList<T>(assetRisks?: T[] | null): T[] {
  return Array.isArray(assetRisks) ? assetRisks : [];
}

export interface NormalizeAssetInput {
  fields?: Array<{ type?: unknown }> | null;
  assetRisks?: unknown[] | null;
  [key: string]: unknown;
}

export function normalizeAssetDataTypes<T extends NormalizeAssetInput>(
  asset?: T | null,
): T | null | undefined {
  if (!asset || typeof asset !== "object") return asset;
  return {
    ...asset,
    fields: normalizeFieldList(asset.fields),
    assetRisks: normalizeAssetRiskList(asset.assetRisks),
  };
}
