// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const SCHEDULE_STATUS_LABELS = Object.freeze({
  completed: "已完成",
  next: "下一次",
  pending: "待执行",
});

export type ScheduleStatus = keyof typeof SCHEDULE_STATUS_LABELS;

interface SchedulePoint {
  label: string;
  minutes: number;
}

export interface ScheduleStep {
  label: string;
  status: ScheduleStatus;
  statusLabel: string;
}

export interface NextUnloadResult {
  label: string;
  nextDay: boolean;
}

function schedulePoints(
  times: readonly unknown[] | null | undefined,
): SchedulePoint[] {
  if (!Array.isArray(times)) return [];

  return times
    .filter(
      (label): label is string =>
        typeof label === "string" && TIME_RE.test(label),
    )
    .map((label) => {
      const [hourText, minuteText] = label.split(":");
      const hour = Number(hourText || 0);
      const minute = Number(minuteText || 0);
      return { label, minutes: hour * 60 + minute };
    })
    .sort((left, right) => left.minutes - right.minutes);
}

function currentMinutes(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

function nextIndex(points: readonly SchedulePoint[], now: Date): number {
  return points.findIndex((point) => point.minutes > currentMinutes(now));
}

export function getScheduleSteps(
  times: readonly unknown[] | null | undefined,
  now = new Date(),
): ScheduleStep[] {
  const points = schedulePoints(times);
  const upcomingIndex = nextIndex(points, now);

  return points.map((point, index) => {
    const status: ScheduleStatus =
      upcomingIndex === -1 || index < upcomingIndex
        ? "completed"
        : index === upcomingIndex
          ? "next"
          : "pending";

    return {
      label: point.label,
      status,
      statusLabel: SCHEDULE_STATUS_LABELS[status],
    };
  });
}

export function nextUnload(
  times: readonly unknown[] | null | undefined,
  now = new Date(),
): NextUnloadResult | null {
  const points = schedulePoints(times);
  if (!points.length) return null;

  const upcomingIndex = nextIndex(points, now);
  const target = points[upcomingIndex === -1 ? 0 : upcomingIndex];
  if (!target) return null;

  return {
    label: target.label,
    nextDay: upcomingIndex === -1,
  };
}
