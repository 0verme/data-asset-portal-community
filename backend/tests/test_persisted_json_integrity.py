import unittest

from backend.app.services.report_service import ReportService, ReportDataSourceError
from backend.app.services.lineage_service import _decode_json, LineageDataSourceError


class PersistedJsonIntegrityTests(unittest.TestCase):
    def test_report_empty_legacy_values_and_arrays_remain_readable(self):
        for value in (None, "", "[]", []):
            self.assertEqual([], ReportService._normalize_json_array(value))
        self.assertEqual([{"assetId": 7}], ReportService._normalize_json_array('[{"assetId":7}]'))

    def test_report_corruption_is_not_an_empty_relation(self):
        for value in ("{bad", "{}", "null", 7, "   "):
            with self.subTest(value=value), self.assertRaises(ReportDataSourceError) as raised:
                ReportService._normalize_json_array(value)
            self.assertNotIn(str(value), raised.exception.message)

    def test_lineage_preserves_valid_shapes_and_optional_missing_values(self):
        for fallback, encoded in (({}, '{}'), ([], '[]')):
            for value in (None, '', encoded):
                self.assertEqual(fallback, _decode_json(value, fallback))
        self.assertEqual({"layer": "DWF"}, _decode_json('{"layer":"DWF"}', {}))

    def test_lineage_corrupt_or_wrong_shape_properties_fail_closed(self):
        for value, fallback in (("{bad", {}), ("[]", {}), ("{}", []), ("null", []), (0, {})):
            with self.subTest(value=value), self.assertRaises(LineageDataSourceError):
                _decode_json(value, fallback)
