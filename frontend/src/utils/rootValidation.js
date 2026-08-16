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

export const ROOT_ABBR_RE = /^[a-z0-9]+$/;
export const ROOT_ABBR_RULE_MESSAGE = "词根缩写仅支持小写字母和数字，不允许下划线";

export function isValidRootAbbr(value) {
  return ROOT_ABBR_RE.test(String(value || "").trim());
}

export function assertValidRootAbbr(value) {
  if (!isValidRootAbbr(value)) throw new Error(ROOT_ABBR_RULE_MESSAGE);
}
