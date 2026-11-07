"""Cross-stack regression test for the AI ask SSE event contract.

The committed sample in ``backend/tests/fixtures/ai_ask_stream_contract.json`` is
generated from the real execution pipeline (see
``backend/tests/ai_ask_sse_contract_samples.py``). Two tests keep it honest:

* the backend must still emit exactly the sampled structure, and
* ``frontend/src/api/aiAskExecutionContract.test.ts`` must still parse every
  sampled frame.

A backend field addition therefore fails CI twice: once here (the sample is
stale) and once on the frontend (the whitelist is too narrow). That pairing is
the guard against the class of bug where a backend change silently breaks the
browser parser.

Regenerate the sample after an intentional contract change:

    AI_ASK_SSE_FIXTURE_UPDATE=1 python -m unittest \
        backend.tests.test_ai_ask_sse_contract
"""

from __future__ import annotations

import json
import os
import unittest
from pathlib import Path

from backend.tests.ai_ask_sse_contract_samples import build_contract_samples

FIXTURE_PATH = Path(__file__).with_name("fixtures") / "ai_ask_stream_contract.json"

#: Event kinds the browser parser must accept.
REQUIRED_EVENTS = ("step_start", "step_complete", "answer", "done")

#: Step ids that must appear across the sampled scenarios.
REQUIRED_STEP_PREFIXES = (
    "planning",
    "rag-round-1",
    "search-",
    "catalog-",
    "merge",
    "verification",
    "asset-",
    "field-",
    "generating",
)

#: Fields that the browser whitelist previously rejected (the 0.2.0 defect).
REQUIRED_CATALOG_FIELDS = (
    "phase",
    "candidateAssetCount",
    "candidateFieldCount",
    "databaseCallCount",
    "verifiedAssetCount",
)

#: Search completion must carry the stage timings and directory call count.
REQUIRED_SEARCH_FIELDS = ("stageTimings", "databaseCallCount", "requestCount")


def _step_events(scenario: dict) -> list[tuple[str, str, dict]]:
    """Return ``(event, step_id, data)`` for every step event in a scenario."""
    rows: list[tuple[str, str, dict]] = []
    for frame in scenario["events"]:
        payload = json.loads(frame["data"])
        if not frame["event"].startswith("step_"):
            continue
        rows.append((frame["event"], str(payload.get("step_id")), payload.get("data") or {}))
    return rows


def _describe_difference(expected: list, actual: list) -> str:
    """Return a focused, readable description of the first structural difference."""
    if len(expected) != len(actual):
        return f"事件数量不同：期望 {len(expected)} 条，实际 {len(actual)} 条。"
    for index, (left, right) in enumerate(zip(expected, actual, strict=True)):
        if left != right:
            left_payload = json.loads(left["data"])
            right_payload = json.loads(right["data"])
            if left["event"] != right["event"]:
                return f"第 {index} 条事件名不同：期望 {left['event']}，实际 {right['event']}。"
            if left_payload.get("step_id") != right_payload.get("step_id"):
                return (
                    f"第 {index} 条 step_id 不同："
                    f"期望 {left_payload.get('step_id')}，实际 {right_payload.get('step_id')}。"
                )
            left_keys = set(left_payload.get("data") or {})
            right_keys = set(right_payload.get("data") or {})
            if left_keys != right_keys:
                return (
                    f"第 {index} 条（{left['event']} / {left_payload.get('step_id')}）data 字段不同："
                    f"仅后端有 {sorted(right_keys - left_keys)}，"
                    f"仅样本有 {sorted(left_keys - right_keys)}。"
                )
            return (
                f"第 {index} 条（{left['event']} / {left_payload.get('step_id')}）字段取值不同："
                f"样本 {json.dumps(left_payload.get('data'), ensure_ascii=False, sort_keys=True)} "
                f"实际 {json.dumps(right_payload.get('data'), ensure_ascii=False, sort_keys=True)}"
            )
    return "结构一致。"


class AiAskSseContractTests(unittest.TestCase):
    def test_backend_emits_exactly_the_committed_contract_sample(self):
        actual = build_contract_samples()
        if os.environ.get("AI_ASK_SSE_FIXTURE_UPDATE") == "1":
            FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
            FIXTURE_PATH.write_text(
                json.dumps(actual, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
                newline="\n",
            )
            self.skipTest("已重新生成契约样本，请复核并提交 fixtures/ai_ask_stream_contract.json")

        self.assertTrue(
            FIXTURE_PATH.is_file(),
            f"缺少契约样本 {FIXTURE_PATH}；请运行 AI_ASK_SSE_FIXTURE_UPDATE=1 生成。",
        )
        expected = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

        self.assertEqual(
            [scenario["name"] for scenario in expected["scenarios"]],
            [scenario["name"] for scenario in actual["scenarios"]],
            "契约样本的场景集合发生了变化。",
        )
        for expected_scenario, actual_scenario in zip(
            expected["scenarios"], actual["scenarios"], strict=True
        ):
            with self.subTest(scenario=actual_scenario["name"]):
                self.assertEqual(
                    expected_scenario["responseStatus"],
                    actual_scenario["responseStatus"],
                    "问答终态发生变化。",
                )
                self.assertEqual(
                    expected_scenario["doneReasonCode"],
                    actual_scenario["doneReasonCode"],
                    "done 事件 reasonCode 发生变化。",
                )
                self.assertEqual(
                    expected_scenario["events"],
                    actual_scenario["events"],
                    "SSE 事件结构与契约样本不一致。后端新增/修改了事件字段后，"
                    "必须同步更新 frontend/src/api/aiAskExecution.ts 的字段白名单，"
                    "然后运行 AI_ASK_SSE_FIXTURE_UPDATE=1 重新生成样本。差异："
                    + _describe_difference(expected_scenario["events"], actual_scenario["events"]),
                )

    def test_sample_covers_the_documented_event_surface(self):
        sample = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        scenarios = sample["scenarios"]
        self.assertGreaterEqual(len(scenarios), 2, "契约样本必须同时覆盖证据不足与多查询检索。")

        event_names = {frame["event"] for scenario in scenarios for frame in scenario["events"]}
        for name in REQUIRED_EVENTS:
            self.assertIn(name, event_names, f"契约样本缺少 {name} 事件。")

        step_ids = {
            step_id
            for scenario in scenarios
            for _event, step_id, _data in _step_events(scenario)
        }
        for prefix in REQUIRED_STEP_PREFIXES:
            self.assertTrue(
                any(step_id.startswith(prefix) for step_id in step_ids),
                f"契约样本缺少 {prefix}* 步骤（现有：{sorted(step_ids)}）。",
            )

        catalog_fields: set[str] = set()
        search_fields: set[str] = set()
        for scenario in scenarios:
            for event, step_id, data in _step_events(scenario):
                if step_id.startswith("catalog-"):
                    catalog_fields.update(data)
                elif step_id.startswith("search-") and event == "step_complete":
                    search_fields.update(data)
        for field in REQUIRED_CATALOG_FIELDS:
            self.assertIn(
                field,
                catalog_fields,
                "catalog 事件必须包含目录核验字段 "
                f"{field}（现有：{sorted(catalog_fields)}）。",
            )
        for field in REQUIRED_SEARCH_FIELDS:
            self.assertIn(
                field,
                search_fields,
                "search 完成事件必须包含检索字段 "
                f"{field}（现有：{sorted(search_fields)}）。",
            )

        done_payloads = [
            json.loads(frame["data"]).get("data") or {}
            for scenario in scenarios
            for frame in scenario["events"]
            if frame["event"] == "done"
        ]
        self.assertTrue(done_payloads, "契约样本缺少 done 事件。")
        self.assertTrue(
            any("reasonCode" in payload for payload in done_payloads),
            "契约样本必须覆盖 done 事件带 reasonCode 的分支。",
        )
        self.assertTrue(
            any("reasonCode" not in payload for payload in done_payloads),
            "契约样本必须覆盖 done 事件不带 reasonCode 的分支。",
        )
        for payload in done_payloads:
            self.assertLessEqual(
                set(payload),
                {"status", "stepCount", "reasonCode"},
                "done 事件只允许 status/stepCount/reasonCode。",
            )

    def test_insufficient_evidence_is_a_successful_terminal_state(self):
        sample = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        scenario = next(
            item for item in sample["scenarios"] if item["name"] == "insufficient_evidence"
        )
        self.assertEqual("insufficient_evidence", scenario["responseStatus"])

        done = json.loads(
            next(frame["data"] for frame in scenario["events"] if frame["event"] == "done")
        )["data"]
        self.assertEqual(
            "completed",
            done["status"],
            "证据不足是正常终态，不能映射为 failed；否则前端会把结果误报成检索失败。",
        )
        self.assertEqual("insufficient_evidence", done["reasonCode"])


if __name__ == "__main__":
    unittest.main()
