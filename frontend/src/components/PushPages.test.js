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
import { DEFAULT_AUTH_OPTIONS } from "./push/pushConstants.js";
import { PUSH_JOB_TABLE_COLUMNS, getPushJobTableValues } from "./push/pushJobTable.js";
import { formatFreq, validateJob, validateSystem } from "./push/pushUtils.js";

const defaultsPath = fileURLToPath(new URL("../config/defaults.js", import.meta.url));
const commonCodesPath = fileURLToPath(new URL("../data/commonCodes.js", import.meta.url));
const pushHookPath = fileURLToPath(new URL("../hooks/usePushModule.js", import.meta.url));
const locationPath = fileURLToPath(new URL("../routing/location.ts", import.meta.url));
const pagePath = fileURLToPath(new URL("./PushPages.jsx", import.meta.url));
const pushSidebarPath = fileURLToPath(new URL("./sidebar/PushSidebar.jsx", import.meta.url));
const systemListPath = fileURLToPath(new URL("./push/PushSystemList.jsx", import.meta.url));
const jobListPath = fileURLToPath(new URL("./push/PushJobList.jsx", import.meta.url));
const systemEditorPath = fileURLToPath(new URL("./push/SystemEditor.jsx", import.meta.url));
const jobEditorPath = fileURLToPath(new URL("./push/JobEditor.jsx", import.meta.url));
const constantsPath = fileURLToPath(new URL("./push/pushConstants.js", import.meta.url));
const pushApiPath = fileURLToPath(new URL("../api/push.js", import.meta.url));
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

test("push demo auth values follow the backend contract", async () => {
  const source = await readSources(defaultsPath, commonCodesPath);

  assert.match(source, /DEFAULT_PUSH_AUTH_OPTIONS = \["密钥认证", "账号密码"\]/);
  assert.match(source, /category\("PUSH_AUTH_TYPE", "下游认证方式", \["密钥认证", "账号密码"\]\)/);
  assert.equal(PUSH_SYSTEMS.every((system) => DEFAULT_AUTH_OPTIONS.includes(system.auth)), true);
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

test("push list mapping keeps both path fields available to the table", async () => {
  const source = await readFile(pushApiPath, "utf8");

  assert.match(source, /sourcePath: job\.sourcePath \|\| ""/);
  assert.match(source, /targetPath: job\.targetPath \|\| ""/);
});

test("push job table keeps six semantic columns when paths are present or absent", async () => {
  const source = await readFile(jobListPath, "utf8");
  const columnKeys = ["job", "sourcePath", "targetPath", "frequency", "status", "action"];

  assert.deepEqual(PUSH_JOB_TABLE_COLUMNS.map((column) => column.key), columnKeys);
  assert.equal(PUSH_JOB_TABLE_COLUMNS.length, columnKeys.length);
  assert.match(source, /PUSH_JOB_TABLE_COLUMNS\.map/);
  assert.match(source, /getPushJobTableValues\(job\)/);
  assert.doesNotMatch(source, /job\.sourcePath\s*&&|job\.targetPath\s*&&/);

  const baseJob = {
    cn: "客户声音分析台每日推送",
    sourceFileName: "DWM_voc_stat_1d_{yyyyMMdd}.json",
    targetFileName: "DWM_voc_stat_1d_{yyyyMMdd}.json",
    freqType: "T+1",
    freq: "",
    enabled: true,
  };
  const cases = [
    {
      name: "both paths",
      job: { ...baseJob, sourcePath: "/lakehouse/dwm/voc/dt={yyyy-MM-dd}", targetPath: "/oss/incoming/voc/" },
      sourcePath: "/lakehouse/dwm/voc/dt={yyyy-MM-dd}",
      targetPath: "/oss/incoming/voc/",
    },
    {
      name: "source path missing",
      job: { ...baseJob, sourcePath: "", targetPath: "/oss/incoming/voc/" },
      sourcePath: "—",
      targetPath: "/oss/incoming/voc/",
    },
    {
      name: "target path missing",
      job: { ...baseJob, sourcePath: "/lakehouse/dwm/voc/", targetPath: "" },
      sourcePath: "/lakehouse/dwm/voc/",
      targetPath: "—",
    },
    {
      name: "both paths missing",
      job: { ...baseJob, sourcePath: "", targetPath: "" },
      sourcePath: "—",
      targetPath: "—",
    },
    {
      name: "disabled job",
      job: { ...baseJob, sourcePath: "", targetPath: "", enabled: false },
      sourcePath: "—",
      targetPath: "—",
      status: "禁用",
    },
  ];

  for (const item of cases) {
    const cells = getPushJobTableValues(item.job);
    assert.deepEqual(Object.keys(cells), columnKeys, item.name);
    assert.equal(cells.sourcePath, item.sourcePath, item.name);
    assert.equal(cells.targetPath, item.targetPath, item.name);
    assert.equal(cells.frequency, "T+1", item.name);
    assert.equal(cells.status, item.status || "启用", item.name);
    assert.equal(cells.action, "编辑", item.name);
  }
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
