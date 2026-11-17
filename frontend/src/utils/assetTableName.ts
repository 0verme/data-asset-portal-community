export function getQualifiedAssetTableName(name: string, schema?: unknown): string {
  const tableName = String(name || "").trim();
  const schemaName = typeof schema === "string" ? schema.trim() : "";
  return schemaName ? `${schemaName}.${tableName}` : tableName;
}
