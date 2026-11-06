import unittest

from backend.app.services.ai_ask_admission import AIAskAdmissionController


class AIAskAdmissionTests(unittest.TestCase):
    def test_active_and_waiting_limits_are_bounded_and_fifo(self):
        controller = AIAskAdmissionController(
            max_concurrent=1,
            max_queued=1,
            queue_wait_ms=100,
        )
        active = controller.reserve()
        queued = controller.reserve()

        self.assertTrue(active.active)
        self.assertFalse(queued.active)
        self.assertIsNone(controller.reserve())
        self.assertEqual((1, 1), controller.snapshot())

        active.release()
        self.assertTrue(queued.wait(0.1))
        self.assertEqual((1, 0), controller.snapshot())
        queued.release()
        queued.release()  # release is idempotent
        self.assertEqual((0, 0), controller.snapshot())

    def test_queued_cancel_removes_entry_without_consuming_capacity(self):
        controller = AIAskAdmissionController(max_concurrent=1, max_queued=2)
        active = controller.reserve()
        cancelled = controller.reserve()
        next_queued = controller.reserve()

        cancelled.cancel()
        active.release()

        self.assertTrue(next_queued.active)
        self.assertEqual((1, 0), controller.snapshot())
        next_queued.release()
        self.assertEqual((0, 0), controller.snapshot())

    def test_acquire_times_out_without_leaking_a_queue_slot(self):
        controller = AIAskAdmissionController(max_concurrent=1, max_queued=1)
        active = controller.reserve()

        self.assertIsNone(controller.acquire(timeout=0.01))
        self.assertEqual((1, 0), controller.snapshot())
        active.release()
        self.assertEqual((0, 0), controller.snapshot())

    def test_zero_queue_capacity_is_respected(self):
        controller = AIAskAdmissionController(max_concurrent=1, max_queued=0)
        active = controller.reserve()

        self.assertIsNone(controller.reserve())
        self.assertEqual((1, 0), controller.snapshot())
        active.release()


if __name__ == "__main__":
    unittest.main()
