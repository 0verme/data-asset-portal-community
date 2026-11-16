import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const websiteDir = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(websiteDir, "locales");
const templatePath = path.join(websiteDir, "page.template.html");
const checkOnly = process.argv.slice(2).includes("--check");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--check");

if (unknownArgs.length > 0) {
  throw new Error(`Unknown option: ${unknownArgs.join(" ")}`);
}

const outputPathFor = (locale) => {
  if (locale === "zh-CN") return "index.html";
  if (locale === "en-US") return "en/index.html";
  throw new Error(`Unsupported website locale: ${locale}`);
};

function escapeAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function render(template, localeData, locale) {
  const rendered = template.replace(/\{\{(@?)([A-Za-z0-9_.-]+)\}\}/g, (_match, attribute, key) => {
    const value = localeData[key];
    if (typeof value !== "string") {
      throw new Error(`Missing string for ${locale}.${key}`);
    }
    return attribute ? escapeAttribute(value) : value;
  });
  const unresolved = rendered.match(/\{\{[^}]+\}\}/);
  if (unresolved) throw new Error(`Unresolved template token: ${unresolved[0]}`);
  return rendered;
}

const template = await readFile(templatePath, "utf8");
const localeFiles = (await readdir(localesDir)).filter((name) => name.endsWith(".json")).sort();
if (localeFiles.length === 0) throw new Error(`No locale files found in ${localesDir}`);

let stale = false;
for (const fileName of localeFiles) {
  const locale = fileName.slice(0, -".json".length);
  const localeData = JSON.parse(await readFile(path.join(localesDir, fileName), "utf8"));
  const outputRelativePath = outputPathFor(locale);
  const outputPath = path.join(websiteDir, outputRelativePath);
  const generated = render(template, localeData, locale);

  if (checkOnly) {
    let current;
    try {
      current = await readFile(outputPath, "utf8");
    } catch {
      current = null;
    }
    if (current !== generated) {
      console.error(`Out of date: website/${outputRelativePath}`);
      stale = true;
    }
  } else {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, generated, "utf8");
    console.log(`Generated website/${outputRelativePath}`);
  }
}

if (stale) {
  console.error("Generated pages differ from committed files. Run: node website/build.mjs");
  process.exitCode = 1;
} else if (checkOnly) {
  console.log("Website pages are up to date.");
}
