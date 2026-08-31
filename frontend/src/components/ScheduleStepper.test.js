import assert from "node:assert/strict";
import test from "node:test";

import { getScheduleSteps, nextUnload } from "./upstream/scheduleStepper.js";

const at = (hour, minute = 0) => new Date(2025, 0, 1, hour, minute);

test("classifies a four-point schedule around the next unload", () => {
  const times = ["01:00", "07:00", "13:00", "19:00"];
  const steps = getScheduleSteps(times, at(12));

  assert.equal(steps.length, times.length);
  assert.deepEqual(
    steps.map(({ label, status, statusLabel }) => ({ label, status, statusLabel })),
    [
      { label: "01:00", status: "completed", statusLabel: "已完成" },
      { label: "07:00", status: "completed", statusLabel: "已完成" },
      { label: "13:00", status: "next", statusLabel: "下一次" },
      { label: "19:00", status: "pending", statusLabel: "待执行" },
    ],
  );
  assert.deepEqual(nextUnload(times, at(12)), { label: "13:00", nextDay: false });
});

test("keeps one schedule point usable", () => {
  assert.deepEqual(getScheduleSteps(["01:00"], at(0)), [
    { label: "01:00", status: "next", statusLabel: "下一次" },
  ]);
});

test("returns an empty plan without inventing a next unload", () => {
  assert.deepEqual(getScheduleSteps([], at(12)), []);
  assert.equal(nextUnload([], at(12)), null);
});

test("supports schedules with more than four points", () => {
  const times = ["01:00", "05:00", "09:00", "13:00", "17:00", "21:00"];
  const steps = getScheduleSteps(times, at(10));

  assert.equal(steps.length, 6);
  assert.deepEqual(steps.map((step) => step.label), times);
  assert.equal(steps.find((step) => step.status === "next")?.label, "13:00");
  assert.equal(steps.filter((step) => step.status === "pending").length, 2);
});

test("marks all points completed while the next unload moves to tomorrow", () => {
  const times = ["01:00", "07:00", "13:00", "19:00"];

  assert.ok(getScheduleSteps(times, at(20)).every((step) => step.status === "completed"));
  assert.deepEqual(nextUnload(times, at(20)), { label: "01:00", nextDay: true });
});
