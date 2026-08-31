import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PUSH_SYSTEMS } from "../data/pushSystems.js";
import {
  comparePushSystemImportance,
  isValidLatestOutputTime,
  normalizeLatestOutputTime,
} from "../utils/push.js";
import { formatFreq, validateJob, validateSystem } from "./push/pushUtils.js";

const defaultsPath = fileURLToPath(new URL("../config/defaults.js", import.meta.url));
const pushHookPath = fileURLToPath(new URL("../hooks/usePushModule.js", import.meta.url));
const locationPath = fileURLToPath(new URL("../routing/location.ts", import.meta.url));
const pagePath = fileURLToPath(new URL("./PushPages.jsx", import.meta.url));
const pushSidebarPath = fileURLToPath(new URL("./sidebar/PushSidebar.jsx", import.meta.url));
const systemListPath = fileURLToPath(new URL("./push/PushSystemList.jsx", import.meta.url));
const jobListPath = fileURLToPath(new URL("./push/PushJobList.jsx", import.meta.url));
const systemEditorPath = fileURLToPath(new URL("./push/SystemEditor.jsx", import.meta.url));
const jobEditorPath = fileURLToPath(new URL("./push/JobEditor.jsx", import.meta.url));
const constantsPath = fileURLToPath(new URL("./push/pushConstants.js", import.meta.url));
const utilsPath = fileURLToPath(new URL("./push/pushUtils.js", import.meta.url));
const timeInputPath = fileURLToPath(new URL("./common/TimeInput.jsx", import.meta.url));
const readSources = async (...paths) => (await Promise.all(paths.map((path) => readFile(path, "utf8")))).join("\n");

test("push systems keep downstream and data-developer contacts separate", async () => {
  const source = await readSources(systemListPath, systemEditorPath);

  assert.match(source, /下游对接人/);
  assert.match(source, /数据开发对接人/);
  assert.match(source, /downstreamContact/);
  assert.match(source, /dataDeveloperContact/);
  assert.equal(PUSH_SYSTEMS.every((system) => typeof system.downstreamContact === "string"), true);
  assert.equal(PUSH_SYSTEMS.every((system) => typeof system.dataDeveloperContact === "string"), true);
});

test("public push cards omit protected connection and contact details", async () => {
  const source = await readFile(systemListPath, "utf8");

  assert.match(source, /showContactDetails/);
  assert.match(source, /system\.host \?/);
  assert.match(source, /连接协议/);
  assert.match(source, /下游对接人/);
  assert.match(source, /数据开发对接人/);
});

test("push jobs rely on system contacts instead of a duplicated owner", async () => {
  const source = await readSources(jobListPath, jobEditorPath);

  assert.doesNotMatch(source, /作业负责人/);
  assert.doesNotMatch(source, /job\.owner|form\.owner/);
  assert.equal(
    PUSH_SYSTEMS.every((system) => system.jobs.every((job) => !("owner" in job))),
    true,
  );
});

test("push system importance defaults and latest output time rules are explicit", async () => {
  const source = await readSources(systemListPath, systemEditorPath);
  const timeInputSource = await readFile(timeInputPath, "utf8");

  assert.equal(PUSH_SYSTEMS.every((system) => system.importanceLevel === "normal"), true);
  assert.equal(PUSH_SYSTEMS.every((system) => system.latestOutputTime === ""), true);
  assert.equal(isValidLatestOutputTime("important", ""), true);
  assert.equal(isValidLatestOutputTime("important", "00:00"), true);
  assert.equal(isValidLatestOutputTime("important", "23:59"), true);
  assert.equal(isValidLatestOutputTime("important", "24:00"), false);
  assert.equal(isValidLatestOutputTime("important", "8:30"), false);
  assert.equal(normalizeLatestOutputTime("normal", "08:30"), "");
  assert.equal(normalizeLatestOutputTime("important", " 08:30 "), "08:30");
  assert.ok(source.includes('className={`sys-card${isImportant ? " important" : ""}`}'));
  assert.match(source, /最晚出数时间/);
  assert.match(source, /<TimeInput/);
  assert.match(source, /disabled=\{form\.importanceLevel !== "important"\}/);
  assert.match(timeInputSource, /type="time"/);
  assert.match(timeInputSource, /step=\{step\}/);
});

test("push systems sort important entries first while preserving peer order", () => {
  const systems = [
    { id: "normal-a", importanceLevel: "normal" },
    { id: "important-a", importanceLevel: "important" },
    { id: "unknown" },
    { id: "important-b", importanceLevel: "important" },
    { id: "normal-b", importanceLevel: "normal" },
  ];

  assert.deepEqual(
    systems.slice().sort(comparePushSystemImportance).map((system) => system.id),
    ["important-a", "important-b", "normal-a", "unknown", "normal-b"],
  );
});

test("push system list marks important rows with a label and semantic background class", async () => {
  const source = await readFile(systemListPath, "utf8");

  assert.match(source, /className=\{isImportant \? "sys-row-important" : undefined\}/);
  assert.match(source, /\{isImportant \? <span className="tag tag-danger">重要<\/span> : null\}/);
});

test("push sidebar filters systems by importance with counts and a clearable selection", async () => {
  const source = await readSources(defaultsPath, pushHookPath, pushSidebarPath);

  assert.match(source, /importanceLevel: null/);
  assert.match(source, /title="重要程度"/);
  assert.match(source, /\{ value: "important", label: "重要" \}/);
  assert.match(source, /\{ value: "normal", label: "普通" \}/);
  assert.match(source, /pushFacets\.importanceLevel\[item\.value\] \|\| 0/);
  assert.match(source, /system\.importanceLevel !== pushFilter\.importanceLevel/);
  assert.match(source, /prev\.importanceLevel === item\.value \? null : item\.value/);
});

test("push importance filter is restored only from supported URL values", async () => {
  const source = await readFile(locationPath, "utf8");

  assert.match(
    source,
    /readAllowedNullable\(\s*searchParams\.get\("importanceLevel"\),\s*\["important", "normal"\],\s*DEFAULT_PUSH_FILTER\.importanceLevel,\s*\)/,
  );
});

test("push importance filter is persisted in the URL", async () => {
  const source = await readFile(locationPath, "utf8");

  assert.match(
    source,
    /if \(pushFilter\.importanceLevel\) params\.set\("importanceLevel", pushFilter\.importanceLevel\)/,
  );
});

test("push system ids allow a numeric prefix without relaxing other ids", async () => {
  const source = await readSources(constantsPath, utilsPath);

  assert.match(source, /const SYSTEM_ID_RE = \/\^\[A-Za-z0-9_\]\+\$\//);
  assert.match(source, /const ID_RE = \/\^\[A-Za-z_\]\[A-Za-z0-9_\]\*\$\//);
  assert.match(source, /系统编号只允许字母、数字和下划线。/);
  assert.doesNotMatch(source, /系统编号只允许字母、数字和下划线，且不能以数字开头。/);
});

test("push compatibility entrypoint exports all five public components", async () => {
  const source = await readFile(pagePath, "utf8");

  for (const component of ["PushSystemList", "PushJobList", "PushJobDetail", "SystemEditor", "JobEditor"]) {
    assert.match(source, new RegExp(`export \\{ ${component} \\} from`));
  }
});

test("push utilities preserve frequency formatting and validation", () => {
  assert.equal(formatFreq({ freqType: "T+1", freq: "" }), "T+1");
  assert.equal(formatFreq({ freqType: "每月", freq: "LAST" }), "每月末");
  assert.equal(formatFreq({ freqType: "每周", freq: "1" }), "每周一");

  const validSystem = {
    id: "1_CORE",
    name: "核心系统",
    abbr: "CORE",
    host: "192.0.2.1",
    port: "22",
    importanceLevel: "normal",
    latestOutputTime: "",
  };
  assert.deepEqual(validateSystem(validSystem, [], ""), []);
  assert.match(validateSystem({ ...validSystem, id: "CORE-ID" }, [], "")[0], /字母、数字和下划线/);

  const validJob = { cn: "客户推送", sourceFileName: "customer.csv", freqType: "T+1", freq: "" };
  const validField = { _key: "field-1", name: "customer_id", cn: "客户编号" };
  assert.deepEqual(validateJob(validJob, [validField]), { errors: [], fieldErrors: {} });
  assert.equal(validateJob(validJob, [{ ...validField, cn: "" }]).errors.length, 1);
});
