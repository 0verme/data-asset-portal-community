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


export function DbBadge({ type }) {
  return <span className="tag tag-neutral">{type}</span>;
}

export function nextUnload(times) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const values = [...times]
    .map((item) => {
      const [hour, minute] = item.split(":").map(Number);
      return hour * 60 + minute;
    })
    .sort((a, b) => a - b);
  const nextValue = values.find((item) => item > currentMinutes);
  const target = nextValue ?? values[0];
  const nextDay = nextValue === undefined;
  return {
    label: `${String(Math.floor(target / 60)).padStart(2, "0")}:${String(target % 60).padStart(2, "0")}`,
    nextDay,
  };
}

export function ScheduleTimeline({ times, muted }) {
  const points = [...times]
    .map((item) => {
      const [hour, minute] = item.split(":").map(Number);
      return { label: item, percent: ((hour * 60 + minute) / 1440) * 100 };
    })
    .sort((a, b) => a.percent - b.percent);

  return (
    <div className={"sched" + (muted ? " muted" : "")}>
      <div className="sched-track">
        {points.map((point) => (
          <div key={point.label} className="sched-mark" style={{ left: `${point.percent}%` }}>
            <span className="sm-flag">{point.label}</span>
            <span className="sm-dot"></span>
          </div>
        ))}
      </div>
      <div className="sched-hours">
        {[0, 6, 12, 18, 24].map((hour) => (
          <span key={hour} className="sh" style={{ left: `${(hour / 24) * 100}%` }}>
            {String(hour).padStart(2, "0")}:00
          </span>
        ))}
      </div>
    </div>
  );
}

