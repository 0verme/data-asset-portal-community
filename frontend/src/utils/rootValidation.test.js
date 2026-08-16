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

import assert from "node:assert/strict";
import test from "node:test";

import {
  ROOT_ABBR_RULE_MESSAGE,
  assertValidRootAbbr,
  isValidRootAbbr,
} from "./rootValidation.js";

test("accepts lowercase letters and numbers", () => {
  assert.equal(isValidRootAbbr("trans"), true);
  assert.equal(isValidRootAbbr("amt2"), true);
});

test("rejects underscore and other unsupported forms", () => {
  for (const value of ["pay_amt", "TRANS", "", "pay-amt", "支付"]) {
    assert.equal(isValidRootAbbr(value), false, value);
  }
  assert.throws(() => assertValidRootAbbr("pay_amt"), {
    message: ROOT_ABBR_RULE_MESSAGE,
  });
});
