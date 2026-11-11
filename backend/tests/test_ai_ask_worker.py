import threading
import time
import unittest

from backend.app.services.ai_ask_worker import AIAskProcessWorker


def _blocked_jdbc_result_read(output_queue, _cancel_event, _mode, _payload, _profile, _request_id, _timeout):
    # Simulate a JayDeBeApi/JDBC ResultSet fetch that ignores Python cancellation.
    output_queue.put(("simulated_jdbc_fetchall_started", None))
    threading.Event().wait(30)


class AIAskWorkerTests(unittest.TestCase):
    def _worker(self, *, timeout_seconds=10):
        return AIAskProcessWorker(
            mode="test",
            payload={},
            profile="strict",
            timeout_seconds=timeout_seconds,
            process_target=_blocked_jdbc_result_read,
        )

    def test_repeated_stuck_jdbc_reads_can_be_terminated_and_reaped(self):
        for _attempt in range(3):
            with self.subTest(attempt=_attempt + 1):
                worker = self._worker()
                worker.start()
                try:
                    self.assertEqual(
                        ("simulated_jdbc_fetchall_started", None),
                        worker.get_message(timeout=5),
                    )
                    self.assertIsNotNone(worker.process.pid)
                    self.assertTrue(worker.process.daemon)
                    self.assertTrue(worker.cancel_and_stop(grace_seconds=0.05))
                    self.assertFalse(worker.is_alive())
                    self.assertIsNotNone(worker.process.exitcode)
                finally:
                    worker.cancel_and_stop()

    def test_hard_deadline_detects_a_worker_blocked_in_driver_code(self):
        worker = self._worker(timeout_seconds=0.1)
        worker.start()
        self.addCleanup(worker.cancel_and_stop)

        self.assertEqual(
            ("simulated_jdbc_fetchall_started", None),
            worker.get_message(timeout=5),
        )
        deadline = time.monotonic() + 2
        while not worker.has_timed_out() and time.monotonic() < deadline:
            threading.Event().wait(0.01)

        self.assertTrue(worker.has_timed_out())
        self.assertTrue(worker.cancel_and_stop(grace_seconds=0.05))
        self.assertFalse(worker.is_alive())


if __name__ == "__main__":
    unittest.main()
