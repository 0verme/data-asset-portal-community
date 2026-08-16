import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DWM_TABLES } from "../src/data/tables.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const outputPath = path.join(rootDir, "backend", "mock_data", "assets.json");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(DWM_TABLES, null, 2)}\n`, "utf8");

console.log(`Exported ${DWM_TABLES.length} assets to ${outputPath}`);
