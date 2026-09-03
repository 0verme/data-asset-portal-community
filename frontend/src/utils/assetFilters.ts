import { LAYER_OPTIONS } from "../config/assets.ts";

const LAYER_CODES: ReadonlySet<string> = new Set(
  LAYER_OPTIONS.map((item) =>
    String(item.code || "")
      .trim()
      .toUpperCase(),
  ),
);

const LAYER_FIELD_CANDIDATES = [
  "code",
  "layer",
  "tier",
  "level",
  "schemaLayer",
  "dataLayer",
  "category",
] as const;

export function getAssetLayerValue(
  asset?: object | null,
): string {
  if (!asset || typeof asset !== "object") return "";
  const record = asset as Record<string, unknown>;
  for (const fieldName of LAYER_FIELD_CANDIDATES) {
    const value = record[fieldName];
    if (typeof value !== "string") continue;

    const normalized = value.trim().toUpperCase();
    if (LAYER_CODES.has(normalized)) {
      return normalized;
    }
  }

  return "";
}

export function normalizeAssetLayerFields<T extends Record<string, unknown>>(
  asset?: T | null,
): (T & { layer: string }) | null | undefined {
  if (!asset || typeof asset !== "object") return asset as undefined;

  return {
    ...asset,
    layer: getAssetLayerValue(asset),
  };
}
