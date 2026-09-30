import unittest

from backend.app.services.push_service import PushService


class PushProjectionTests(unittest.TestCase):
    def test_public_job_projection_keeps_business_metadata_and_schema_only(self):
        job = PushService()._to_public_job(
            {
                "job_code": "JOB_VOC_01",
                "job_name": "客户声音分析台每日推送",
                "source_file_name": "DWM_voc_stat_1d_{yyyyMMdd}.json",
                "target_file_name": "DWM_voc_stat_1d_{yyyyMMdd}.json",
                "freq_desc": "每日",
                "freq_type": "T+1",
                "enabled_flag": "Y",
                "job_desc": "demo",
            },
            [{"name": "order_id", "cn": "订单编号", "meaning": "业务主键", "type": "string"}],
        )

        self.assertEqual("DWM_voc_stat_1d_{yyyyMMdd}.json", job["sourceFileName"])
        self.assertEqual("T+1", job["freqType"])
        self.assertEqual("每日", job["freq"])
        self.assertEqual("order_id", job["fields"][0]["name"])
        self.assertNotIn("sourcePath", job)
        self.assertNotIn("targetPath", job)
        self.assertNotIn("delimiter", job)
        self.assertTrue(job["enabled"])


if __name__ == "__main__":
    unittest.main()
