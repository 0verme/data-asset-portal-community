import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const advisoryUrl = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";
const severities = ["info", "low", "moderate", "high", "critical"];

// Temporary exception for the ReDoS in the locked, dev-only picomatch 4.0.7.
// Release tracking: https://github.com/micromatch/picomatch/issues/247
// Proposed fix: https://github.com/micromatch/picomatch/pull/267
// When a fixed version is officially published on npm, upgrade the lockfile,
// remove this exception and its tests, and restore the direct npm audit gate.
// npm also reports affected dependents as metavulnerabilities via these edges.
const affectedEdges = new Map([
  ["@typescript-eslint/typescript-estree", ["tinyglobby"]],
  ["@vitejs/plugin-react", ["vite"]],
  ["fdir", ["picomatch"]],
  ["tinyglobby", ["fdir", "picomatch"]],
  ["vite", ["picomatch", "tinyglobby"]],
]);

function requireValid(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readReport(json) {
  const report = JSON.parse(json);
  requireValid(
    report?.auditReportVersion === 2 && !Object.hasOwn(report, "error") &&
      isRecord(report.vulnerabilities) && isRecord(report.metadata?.vulnerabilities),
    "Invalid npm audit report",
  );

  const findings = new Map(Object.entries(report.vulnerabilities));
  const counts = Object.fromEntries(severities.map((severity) => [severity, 0]));
  for (const [name, finding] of findings) {
    requireValid(
      isRecord(finding) && finding.name === name && severities.includes(finding.severity) &&
        typeof finding.isDirect === "boolean" &&
        Array.isArray(finding.nodes) && finding.nodes.length > 0 &&
        finding.nodes.every((node) => typeof node === "string" && node.length > 0) &&
        Array.isArray(finding.via) && finding.via.length > 0,
      `Invalid audit finding for ${name}`,
    );
    for (const cause of finding.via) {
      const valid = typeof cause === "string"
        ? findings.has(cause)
        : isRecord(cause) && cause.name === name && cause.dependency === name &&
          Number.isSafeInteger(cause.source) && typeof cause.url === "string" &&
          cause.url.length > 0 && severities.includes(cause.severity);
      requireValid(valid, `Invalid audit cause for ${name}`);
    }
    counts[finding.severity] += 1;
  }
  counts.total = findings.size;
  requireValid(
    Object.entries(counts).every(([key, count]) => report.metadata.vulnerabilities[key] === count),
    "npm audit vulnerability counts do not match the findings",
  );
  return { findings, counts };
}

export function evaluateAudit(json, lock) {
  const { findings, counts } = readReport(json);
  requireValid(lock?.lockfileVersion === 3 && isRecord(lock.packages), "Invalid npm lockfile");
  const packages = lock.packages;
  const picomatchPath = "node_modules/picomatch";

  function lockedDevNode(finding) {
    const path = `node_modules/${finding.name}`;
    const entry = packages[path];
    return finding.nodes.length === 1 && finding.nodes[0] === path &&
      entry?.dev === true && entry.devOptional !== true && !entry.link &&
      typeof entry.version === "string";
  }

  function hasLockedDevEdge(path, name) {
    const entry = packages[path];
    return entry?.dev === true && entry.devOptional !== true && !entry.link &&
      (Object.hasOwn(entry.dependencies ?? {}, name) ||
        Object.hasOwn(entry.peerDependencies ?? {}, name)) &&
      !Object.hasOwn(packages, `${path}/node_modules/${name}`);
  }

  function isApprovedPicomatch(finding) {
    return finding.severity === "high" && !finding.isDirect && lockedDevNode(finding) &&
      packages[picomatchPath].version === "4.0.7" &&
      !Object.entries(packages).some(([path, entry]) => path !== picomatchPath &&
        (path.endsWith(`/${picomatchPath}`) || entry?.name === "picomatch")) &&
      ["vite", "tinyglobby", "fdir"].every((name) =>
        hasLockedDevEdge(`node_modules/${name}`, "picomatch"),
      ) &&
      finding.via.length === 1 && finding.via[0].url === advisoryUrl &&
      finding.via[0].severity === "high";
  }

  function isHigh(severity) {
    return severity === "high" || severity === "critical";
  }

  function isApproved(finding) {
    if (finding.name === "picomatch") return isApprovedPicomatch(finding);

    const permitted = affectedEdges.get(finding.name);
    if (finding.severity !== "high" || !permitted || !lockedDevNode(finding)) return false;

    const path = finding.nodes[0];
    // A local direct advisory is evaluated separately below. String causes
    // point to other findings, each of which must account for its own alerts.
    const highCauses = finding.via.filter((cause) => typeof cause === "string" &&
      isHigh(findings.get(cause).severity));
    return highCauses.length > 0 && highCauses.every((cause) =>
      permitted.includes(cause) &&
      hasLockedDevEdge(path, cause) &&
      isApproved(findings.get(cause)),
    );
  }

  const blocked = [];
  const exempted = [];
  for (const finding of findings.values()) {
    const approved = isApproved(finding);
    const isPicomatch = finding.name === "picomatch";
    const directBlockers = finding.via.filter((cause) => typeof cause !== "string" &&
      (isPicomatch ? !approved : isHigh(cause.severity)),
    );
    for (const advisory of directBlockers) {
      blocked.push(`${finding.name} (${advisory.severity}): ${advisory.url}`);
    }
    if (directBlockers.length > 0) continue;
    if ((isHigh(finding.severity) || isPicomatch) && !approved) {
      blocked.push(`${finding.name} (${finding.severity}): unapproved audit finding`);
    } else if (approved) {
      exempted.push(finding.name);
    }
  }
  return { counts, blocked, exempted };
}

function main() {
  const cwd = new URL("../", import.meta.url);
  const audit = spawnSync("npm", ["audit", "--audit-level=high", "--include=dev", "--json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (audit.stderr) process.stderr.write(audit.stderr);
  if (audit.error) throw audit.error;
  requireValid(audit.status === 0 || audit.status === 1, `npm audit terminated (${audit.signal ?? audit.status})`);

  const lock = JSON.parse(readFileSync(new URL("package-lock.json", cwd), "utf8"));
  const { counts, blocked, exempted } = evaluateAudit(audit.stdout, lock);
  requireValid(audit.status === Number(counts.high + counts.critical > 0), "Unexpected npm audit exit status");

  console.log("npm audit vulnerability counts:", JSON.stringify(counts));
  if (exempted.length > 0) {
    console.log(`Temporary development-only exception ${advisoryUrl}: ${exempted.join(", ")}`);
  }
  for (const failure of blocked) console.error(failure);
  process.exitCode = Number(blocked.length > 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`Dependency audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}
