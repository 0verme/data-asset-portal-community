import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateAudit } from "./dependency-audit.mjs";

const advisoryUrl = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";
const picomatchPath = "node_modules/picomatch";
const lockJson = readFileSync(new URL("../package-lock.json", import.meta.url), "utf8");

function advisory(name, severity, url = "https://github.com/advisories/GHSA-aaaa-bbbb-cccc") {
  return { name, dependency: name, source: 1247710, severity, url };
}

function finding(name, severity, via, node = `node_modules/${name}`) {
  return { name, severity, isDirect: false, via, nodes: [node] };
}

function fixture() {
  const vulnerabilities = {
    picomatch: finding("picomatch", "high", [advisory("picomatch", "high", advisoryUrl)]),
    fdir: finding("fdir", "high", ["picomatch"]),
    tinyglobby: finding("tinyglobby", "high", ["fdir", "picomatch"]),
    vite: finding("vite", "high", ["picomatch", "tinyglobby"]),
    "@vitejs/plugin-react": finding("@vitejs/plugin-react", "high", ["vite"]),
    "@typescript-eslint/typescript-estree": finding("@typescript-eslint/typescript-estree", "high", ["minimatch", "tinyglobby"]),
    minimatch: finding(
      "minimatch", "moderate", [advisory("minimatch", "moderate")],
      "node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch",
    ),
  };
  const lock = JSON.parse(lockJson);

  return {
    vulnerabilities,
    lock,
    run() {
      const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
      for (const item of Object.values(vulnerabilities)) {
        counts[item.severity] += 1;
        counts.total += 1;
      }
      return evaluateAudit(JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities,
        metadata: { vulnerabilities: counts },
      }), lock);
    },
  };
}

test("allows the exact dev-only picomatch advisory and its locked dependent chains", () => {
  const { blocked, exempted, counts } = fixture().run();
  assert.deepEqual(blocked, []);
  assert.deepEqual(exempted, [
    "picomatch", "fdir", "tinyglobby", "vite",
    "@vitejs/plugin-react", "@typescript-eslint/typescript-estree",
  ]);
  assert.equal(counts.moderate, 1);
});

for (const severity of ["high", "critical"]) {
  test(`blocks an unrelated ${severity} finding`, () => {
    const report = fixture();
    report.vulnerabilities.example = finding("example", severity, [advisory("example", severity)]);
    assert.ok(report.run().blocked.some((message) => message.startsWith(`example (${severity})`)));

  });
}

test("blocks another High advisory on an otherwise eligible dependent", () => {
  const report = fixture();
  report.vulnerabilities.vite.via.push(advisory("vite", "high"));
  assert.match(report.run().blocked.join("\n"), /vite \(high\)/);
  assert.ok(!report.run().exempted.includes("vite"));
});

test("blocks a Critical record even when it shares the approved advisory URL", () => {
  const report = fixture();
  report.vulnerabilities.picomatch.severity = "critical";
  report.vulnerabilities.picomatch.via[0].severity = "critical";
  assert.match(report.run().blocked.join("\n"), /picomatch \(critical\)/);
});

test("blocks the approved advisory when the lockfile marks picomatch as a production dependency", () => {
  const report = fixture();
  delete report.lock.packages[picomatchPath].dev;
  assert.match(report.run().blocked.join("\n"), /picomatch \(high\)/);
});

test("blocks unknown paths and extra locked copies of picomatch", () => {
  const report = fixture();
  const nested = "node_modules/vite/node_modules/picomatch";
  report.lock.packages[nested] = { version: "4.0.7", dev: true };
  assert.match(report.run().blocked.join("\n"), /picomatch \(high\)/);
  delete report.lock.packages[nested];
  report.vulnerabilities.picomatch.nodes = [nested];
  assert.match(report.run().blocked.join("\n"), /picomatch \(high\)/);
});

test("blocks a reported dependent link absent from the lockfile", () => {
  const report = fixture();
  delete report.lock.packages["node_modules/@typescript-eslint/typescript-estree"].dependencies.tinyglobby;
  assert.match(report.run().blocked.join("\n"), /@typescript-eslint\/typescript-estree \(high\)/);
});

test("blocks a new advisory for picomatch even when its severity is Moderate", () => {
  const report = fixture();
  report.vulnerabilities.picomatch.via.push(advisory("picomatch", "moderate"));
  assert.match(report.run().blocked.join("\n"), /picomatch \(moderate\)/);
});

test("fails closed for invalid JSON, npm error objects and incomplete reports", () => {
  const lock = JSON.parse(lockJson);
  assert.throws(() => evaluateAudit("{broken", lock), SyntaxError);
  assert.throws(() => evaluateAudit('{"error":{"code":"E503"}}', lock), /Invalid npm audit report/);
  assert.throws(() => evaluateAudit('{"auditReportVersion":2,"vulnerabilities":{}}', lock), /Invalid npm audit report/);
});

test("fails closed when audit metadata and findings disagree", () => {
  const counts = { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 };
  assert.throws(() => evaluateAudit(JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: counts },
  }), JSON.parse(lockJson)), /counts do not match/);
});
