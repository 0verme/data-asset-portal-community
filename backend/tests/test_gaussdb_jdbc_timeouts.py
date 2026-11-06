import unittest
from urllib.parse import parse_qsl, urlsplit

from backend.app.db.providers import with_jdbc_timeouts


class GaussDbJdbcTimeoutTests(unittest.TestCase):
    def test_existing_jdbc_url_values_cannot_disable_or_loosen_timeouts(self):
        url = (
            "jdbc:gaussdb://db.example.invalid:25308/catalog"
            "?currentSchema=dap&loginTimeout=0&connectTimeout=900000"
            "&socketTimeout=999999&socketTimeout=not-a-number"
        )

        result = with_jdbc_timeouts(
            url,
            connect_timeout_seconds=5,
            socket_timeout_seconds=10,
        )
        query = dict(parse_qsl(urlsplit(result.removeprefix("jdbc:")).query))

        self.assertEqual("dap", query["currentSchema"])
        self.assertEqual("5", query["loginTimeout"])
        self.assertEqual("5000", query["connectTimeout"])
        self.assertEqual("10000", query["socketTimeout"])
        self.assertEqual(
            1,
            len([key for key, _value in parse_qsl(urlsplit(result.removeprefix("jdbc:")).query) if key == "socketTimeout"]),
        )

    def test_shorter_explicit_url_timeouts_are_preserved(self):
        url = "jdbc:gaussdb://db.example.invalid/catalog?socketTimeout=250&loginTimeout=2"

        result = with_jdbc_timeouts(
            url,
            connect_timeout_seconds=5,
            socket_timeout_seconds=10,
        )
        query = dict(parse_qsl(urlsplit(result.removeprefix("jdbc:")).query))

        self.assertEqual("2", query["loginTimeout"])
        self.assertEqual("250", query["socketTimeout"])
        self.assertEqual("5000", query["connectTimeout"])


if __name__ == "__main__":
    unittest.main()
