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

import { getScheduleSteps } from "./scheduleStepper.js";

export { getScheduleSteps, nextUnload } from "./scheduleStepper.js";

export function DbBadge({ type }) {
  return <span className="tag tag-neutral">{type}</span>;
}

const STATUS_SYMBOLS = {
  completed: "✓",
  next: "●",
  pending: "○",
};

export function ScheduleStepper({ times, muted, now }) {
  const steps = getScheduleSteps(times, now);
  if (!steps.length) return null;

  return (
    <div className={`schedule-stepper${muted ? " muted" : ""}`}>
      <div className="schedule-stepper-scroll">
        <ol className="schedule-steps" aria-label="卸数计划执行状态">
          {steps.map((step, index) => (
            <li
              key={`${step.label}-${index}`}
              className={`schedule-step schedule-step-${step.status}`}
              aria-label={`${step.label}，${step.statusLabel}`}
              aria-current={step.status === "next" ? "step" : undefined}
            >
              <div className="schedule-step-content">
                <span className="schedule-step-node" aria-hidden="true">{STATUS_SYMBOLS[step.status]}</span>
                <span className="schedule-step-time mono">{step.label}</span>
                <span className="schedule-step-status">{step.statusLabel}</span>
              </div>
              {index < steps.length - 1 ? <span className="schedule-step-connector" aria-hidden="true" /> : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
