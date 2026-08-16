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
];

export const DATA_TYPE_BASE_OPTIONS = [
  "VARCHAR",
  "TEXT",
  "INTEGER",
  "BIGINT",
  "NUMERIC",
  "DATE",
  "TIMESTAMP",
  "BOOLEAN",
];

export const DEFAULT_DATA_TYPE = "VARCHAR(64)";
export const DEFAULT_VARCHAR_LENGTH = 64;
export const DEFAULT_NUMERIC_PRECISION = 18;
export const DEFAULT_NUMERIC_SCALE = 2;

const DECIMAL_TYPE_RE = /^(?:decimal|numeric)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)$/i;
const VARCHAR_TYPE_RE = /^(?:varchar|character varying)\s*\(\s*(\d+)\s*\)$/i;

const LEGACY_TYPE_MAP = {
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

export function normalizeDataType(type) {
  const rawType = String(type || "").trim();
  if (!rawType) {
    return DEFAULT_DATA_TYPE;
  }

  const normalized = rawType.toLowerCase();
  const decimalMatch = normalized.match(DECIMAL_TYPE_RE);
  if (decimalMatch) {
    return `NUMERIC(${decimalMatch[1]},${decimalMatch[2]})`;
  }

  const varcharMatch = normalized.match(VARCHAR_TYPE_RE);
  if (varcharMatch) {
    return `VARCHAR(${varcharMatch[1]})`;
  }

  if (normalized === "varchar") {
    return DEFAULT_DATA_TYPE;
  }

  if (normalized === "decimal" || normalized === "numeric") {
    return `NUMERIC(${DEFAULT_NUMERIC_PRECISION},${DEFAULT_NUMERIC_SCALE})`;
  }

  if (LEGACY_TYPE_MAP[normalized]) {
    return LEGACY_TYPE_MAP[normalized];
  }

  return rawType.toUpperCase();
}

export function normalizeFieldDataType(field) {
  return {
    ...field,
    type: normalizeDataType(field?.type),
  };
}

export function parseColumnType(type) {
  const normalized = normalizeDataType(type);
  const varcharMatch = normalized.match(VARCHAR_TYPE_RE);
  if (varcharMatch) {
    return {
      baseType: "VARCHAR",
      length: varcharMatch[1],
      precision: "",
      scale: "",
      normalizedType: normalized,
    };
  }

  const decimalMatch = normalized.match(DECIMAL_TYPE_RE);
  if (decimalMatch) {
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

export function parseDataTypeParts(type) {
  return parseColumnType(type);
}

function sanitizePositiveInteger(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function buildColumnType(input, legacyLength) {
  const source = typeof input === "object" && input !== null
    ? input
    : { baseType: input, length: legacyLength };
  const normalizedBaseType = String(source.baseType || source.typeBase || "").trim().toUpperCase();

  if (normalizedBaseType === "VARCHAR") {
    const numericLength = sanitizePositiveInteger(source.length ?? source.typeLength);
    const finalLength = numericLength || String(DEFAULT_VARCHAR_LENGTH);
    return `VARCHAR(${finalLength})`;
  }

  if (normalizedBaseType === "NUMERIC") {
    const precisionValue = sanitizePositiveInteger(source.precision ?? source.typePrecision);
    const scaleValue = sanitizePositiveInteger(source.scale ?? source.typeScale);
    const finalPrecision = precisionValue || String(DEFAULT_NUMERIC_PRECISION);
    const finalScale = scaleValue || String(DEFAULT_NUMERIC_SCALE);
    return `NUMERIC(${finalPrecision},${finalScale})`;
  }

  return normalizeDataType(normalizedBaseType || DEFAULT_DATA_TYPE);
}

export function buildDataType(baseType, length) {
  return buildColumnType(baseType, length);
}

export function validateColumnType(input) {
  const source = typeof input === "object" && input !== null ? input : parseColumnType(input);
  const baseType = String(source.baseType || source.typeBase || "").trim().toUpperCase();

  if (baseType === "VARCHAR") {
    const length = String(source.length ?? source.typeLength ?? "").trim();
    if (!/^\d+$/.test(length) || Number(length) <= 0) {
      return "VARCHAR 长度必须为正整数";
    }
    return "";
  }

  if (baseType === "NUMERIC") {
    const precision = String(source.precision ?? source.typePrecision ?? "").trim();
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

export function normalizeFieldList(fields) {
  return Array.isArray(fields) ? fields.map(normalizeFieldDataType) : [];
}

export function normalizeAssetRiskList(assetRisks) {
  return Array.isArray(assetRisks) ? assetRisks : [];
}

export function normalizeAssetDataTypes(asset) {
  if (!asset || typeof asset !== "object") return asset;
  return {
    ...asset,
    fields: normalizeFieldList(asset.fields),
    assetRisks: normalizeAssetRiskList(asset.assetRisks),
  };
}
