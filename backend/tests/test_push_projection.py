import unittest

from backend.app.services.push_service import PushService


class PushProjectionTests(unittest.TestCase):
    def test_public_job_projection_preserves_table_path_fields(self):
        job = PushService()._to_public_job({
            "job_code": "JOB_VOC_01",
            "job_name": "客户声音分析台每日推送",
            "source_path": "/lakehouse/dwm/voc/dt={yyyy-MM-dd}",
            "source_file_name": "DWM_voc_stat_1d_{yyyyMMdd}.json",
            "target_path": "/oss/incoming/voc/",
            "target_file_name": "DWM_voc_stat_1d_{yyyyMMdd}.json",
            "freq_desc": "",
            "freq_type": "T+1",
            "enabled_flag": "Y",
            "job_desc": "demo",
        })

        self.assertEqual("/lakehouse/dwm/voc/dt={yyyy-MM-dd}", job["sourcePath"])
        self.assertEqual("/oss/incoming/voc/", job["targetPath"])
        self.assertEqual("DWM_voc_stat_1d_{yyyyMMdd}.json", job["sourceFileName"])
        self.assertEqual("T+1", job["freqType"])
        self.assertTrue(job["enabled"])


if __name__ == "__main__":
    unittest.main()
