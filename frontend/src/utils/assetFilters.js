import { LAYER_OPTIONS } from "../config/assets.js";

const LAYER_CODES = new Set(
  LAYER_OPTIONS.map((item) => String(item.code || "").trim().toUpperCase()),
);

const LAYER_FIELD_CANDIDATES = [
  "code",
  "layer",
  "tier",
  "level",
  "schemaLayer",
  "dataLayer",
  "category",
];

export function getAssetLayerValue(asset) {
  for (const fieldName of LAYER_FIELD_CANDIDATES) {
    const value = asset?.[fieldName];
    if (typeof value !== "string") continue;

    const normalized = value.trim().toUpperCase();
    if (LAYER_CODES.has(normalized)) {
      return normalized;
    }
  }

  return "";
}

export function normalizeAssetLayerFields(asset) {
  if (!asset || typeof asset !== "object") return asset;

  return {
    ...asset,
    layer: getAssetLayerValue(asset),
  };
}
