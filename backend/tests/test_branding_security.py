from __future__ import annotations

import hashlib
import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend.app.services.branding_service import (
    BrandingService,
    BrandingValidationError,
    sanitize_svg,
    validate_png,
)


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def valid_png() -> bytes:
    signature = b"\x89PNG\r\n\x1a\n"
    header = struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)
    image = zlib.compress(b"\x00\xff\x00\x00\xff")
    return signature + png_chunk(b"IHDR", header) + png_chunk(b"IDAT", image) + png_chunk(b"IEND", b"")


class BrandingAssetSecurityTests(unittest.TestCase):
    def test_png_validation_checks_signature_chunks_crc_and_decoded_image(self):
        validate_png(valid_png())
        malformed_crc = bytearray(valid_png())
        malformed_crc[29] ^= 0x01
        with self.assertRaises(BrandingValidationError):
            validate_png(bytes(malformed_crc))
        with self.assertRaises(BrandingValidationError):
            validate_png(b"not a png")
        with self.assertRaises(BrandingValidationError):
            validate_png(b"x" * (200 * 1024))

    def test_safe_svg_is_parsed_and_normalized(self):
        sanitized = sanitize_svg(
            b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2 L22 22" stroke="#123456" stroke-width="2" transform="translate(1, 2) scale(1)"/></svg>'
        )
        self.assertIn(b"<path", sanitized)
        self.assertNotIn(b"https://", sanitized)

    def test_svg_rejects_active_elements_attributes_external_urls_and_entities(self):
        repeated_transform = b"scale(\t\t)scale(" * 5000
        cases = [
            b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script></svg>',
            b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="alert(1)"><path d="M0 0"/></svg>',
            b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><image href="https://example.invalid/a.png"/></svg>',
            b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><foreignObject/></svg>',
            b'<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">&x;</svg>',
            b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path style="fill:red" d="M0 0"/></svg>',
            b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path transform="' + repeated_transform + b'"/></svg>',
        ]
        for source in cases:
            with self.subTest(svg=source[:45]), self.assertRaises(BrandingValidationError):
                sanitize_svg(source)

    def test_upload_uses_hash_name_and_rejects_traversal_mime_mismatch_and_fake_png(self):
        with tempfile.TemporaryDirectory(prefix="dap-branding-") as temp_dir:
            service = BrandingService(upload_directory=temp_dir)
            audit = MagicMock()
            audit.__enter__.return_value = MagicMock()
            audit.__exit__.return_value = False
            with patch("backend.app.services.branding_service.operation_log_service.audit", return_value=audit):
                uploaded = service.upload_asset("logo", "logo.png", "image/png", valid_png())
            expected_hash = hashlib.sha256(valid_png()).hexdigest()
            self.assertEqual(f"/static/branding/{expected_hash}.png", uploaded["url"])
            self.assertEqual(valid_png(), (Path(temp_dir) / f"{expected_hash}.png").read_bytes())
            self.assertFalse((Path(temp_dir) / "logo.png").exists())

            for args in (
                ("logo", "../../logo.png", "image/png", valid_png()),
                ("favicon", "icon.png", "image/svg+xml", valid_png()),
                ("logo", "fake.png", "image/png", b"\x89PNG\r\n\x1a\nnot a png"),
            ):
                with self.subTest(filename=args[1]), self.assertRaises(BrandingValidationError):
                    service.upload_asset(*args)

    def test_failed_upload_audit_rolls_back_new_file_but_never_deletes_existing_asset(self):
        data = valid_png()
        digest = hashlib.sha256(data).hexdigest()
        with tempfile.TemporaryDirectory(prefix="dap-branding-rollback-") as temp_dir:
            service = BrandingService(upload_directory=temp_dir)
            with patch("backend.app.services.branding_service.operation_log_service.audit", side_effect=RuntimeError("audit unavailable")):
                with self.assertRaises(Exception):
                    service.upload_asset("logo", "logo.png", "image/png", data)
            self.assertEqual([], list(Path(temp_dir).iterdir()))

            path = Path(temp_dir) / f"{digest}.png"
            path.write_bytes(data)
            with patch("backend.app.services.branding_service.operation_log_service.audit", side_effect=RuntimeError("audit unavailable")):
                with self.assertRaises(Exception):
                    service.upload_asset("logo", "logo.png", "image/png", data)
            self.assertEqual(data, path.read_bytes())


if __name__ == "__main__":
    unittest.main()
