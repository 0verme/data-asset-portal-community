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

function schedulePoints(times) {
  if (!Array.isArray(times)) return [];

  return times
    .filter((label) => typeof label === "string" && TIME_RE.test(label))
    .map((label) => {
      const [hour, minute] = label.split(":").map(Number);
      return { label, minutes: hour * 60 + minute };
    })
    .sort((left, right) => left.minutes - right.minutes);
}

function currentMinutes(now) {
  return now.getHours() * 60 + now.getMinutes();
}

function nextIndex(points, now) {
  return points.findIndex((point) => point.minutes > currentMinutes(now));
}

export function getScheduleSteps(times, now = new Date()) {
  const points = schedulePoints(times);
  const upcomingIndex = nextIndex(points, now);

  return points.map((point, index) => {
    const status = upcomingIndex === -1 || index < upcomingIndex
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

export function nextUnload(times, now = new Date()) {
  const points = schedulePoints(times);
  if (!points.length) return null;

  const upcomingIndex = nextIndex(points, now);
  const target = points[upcomingIndex === -1 ? 0 : upcomingIndex];

  return {
    label: target.label,
    nextDay: upcomingIndex === -1,
  };
}
