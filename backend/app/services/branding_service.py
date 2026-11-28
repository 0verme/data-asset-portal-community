"""Public site branding backed by the existing system parameter tables."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path
from typing import Any

from sqlalchemy import func, insert, select, update

from ..application import AuditActorMixin, actor_aware
from ..db.service import CoreAccess
from ..db.tables import code_category, code_item
from .operation_log_service import OPERATION_TYPE_UPDATE, operation_log_service
from .system_management_service import SystemDataSourceError

BRANDING_CATEGORY_CODE = "SITE_BRANDING_CONFIG"
BRANDING_ITEM_CODE = "CONFIG"
BRANDING_CATEGORY_NAME = "站点品牌配置"
BRANDING_ITEM_NAME = "站点 Branding 配置"
BRANDING_UPLOAD_LIMIT = 200 * 1024
SUPPORTED_LOCALES = ("zh-CN", "en-US")
DEFAULT_LOGO_URL = "/brand-icon.svg"
DEFAULT_FAVICON_URL = "/favicon.ico"
DEFAULT_ACCENT_PRESET = "purple"
SUPPORTED_ACCENT_PRESETS = ("purple", "green", "blue", "orange")
_BRANDING_UPLOAD_DIRECTORY = Path.cwd() / "uploads" / "branding"
_BRANDING_URL_RE = re.compile(r"^/static/branding/[0-9a-f]{64}\.(?:png|svg)$")


def _localized(zh: str, en: str) -> dict[str, str]:
    return {"zh-CN": zh, "en-US": en}


DEFAULT_BRANDING_CONFIG: dict[str, Any] = {
    "site": {
        "title": _localized("数据资产门户", "Data Asset Portal"),
        "display_name": _localized("数据资产门户", "Data Asset Portal"),
        "announcement": _localized("", ""),
        "logo_url": DEFAULT_LOGO_URL,
        "favicon_url": DEFAULT_FAVICON_URL,
        "default_accent": DEFAULT_ACCENT_PRESET,
    },
    "hero": {
        "title": _localized("数据资产门户", "Data Asset Portal"),
        "subtitle": _localized(
            "一个入口，搜索系统、字段、词根、指标、报表、API、资产、下游推送和码值表。",
            "One place to search systems, fields, roots, metrics, reports, APIs, assets, downstream deliveries, and code tables.",
        ),
        "search_placeholder": _localized(
            "搜索资产、系统、字段、指标、报表、API、码值表、负责人或下游推送",
            "Search assets, systems, fields, metrics, reports, APIs, code tables, owners, or downstream deliveries",
        ),
    },
    "login": {
        "hint": _localized(
            "无需登录即可浏览公开目录；登录后可按当前权限新增、编辑与维护数据资产。",
            "Browse the public catalog without signing in. Sign in to manage data according to your permissions.",
        ),
        "quick_demo_login_enabled": False,
    },
}

_TEXT_LIMITS = {
    ("site", "title"): 160,
    ("site", "display_name"): 128,
    ("site", "announcement"): 500,
    ("hero", "title"): 180,
    ("hero", "subtitle"): 400,
    ("hero", "search_placeholder"): 240,
    ("login", "hint"): 500,
}
_ELEMENTS = {
    "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
}
_SVG_ATTRIBUTES = {
    "xmlns", "viewBox", "width", "height", "fill", "stroke", "stroke-width",
    "stroke-linecap", "stroke-linejoin", "fill-rule", "clip-rule", "opacity",
    "d", "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2",
    "points", "transform",
}
_SVG_NUMBER_RE = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:px)?$")
_SVG_OPACITY_RE = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$")
_SVG_COORDINATES_RE = re.compile(r"^[0-9eE+.,\-\s]+$")
_SVG_PATH_RE = re.compile(r"^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\-\s]+$")
_SVG_COLOR_RE = re.compile(r"^(?:none|transparent|currentColor|#[0-9a-fA-F]{3,8}|black|white|red|green|blue|gray|grey)$")


def _is_safe_svg_transform(value: str) -> bool:
    """Validate a small SVG transform grammar without a backtracking regex."""
    allowed_argument_counts = {"translate": {1, 2}, "scale": {1, 2}, "rotate": {1, 3}}
    position = 0
    transform_count = 0
    while position < len(value):
        while position < len(value) and value[position].isspace():
            position += 1
        if position == len(value):
            break

        name = next(
            (candidate for candidate in allowed_argument_counts if value.startswith(f"{candidate}(", position)),
            None,
        )
        if name is None:
            return False
        position += len(name) + 1
        end = value.find(")", position)
        if end < 0:
            return False

        arguments = value[position:end].strip()
        if not arguments or not _SVG_COORDINATES_RE.fullmatch(arguments):
            return False
        numbers = [part for part in re.split(r"[,\s]+", arguments) if part]
        if len(numbers) not in allowed_argument_counts[name]:
            return False
        if any(not _SVG_OPACITY_RE.fullmatch(number) for number in numbers):
            return False
        position = end + 1
        transform_count += 1

    return transform_count > 0


class BrandingManagementError(Exception):
    code = "BRANDING_MANAGEMENT_ERROR"

    def __init__(self, message: str, details: Any = None):
        self.message = message
        self.details = details
        super().__init__(message)

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details is not None:
            payload["details"] = self.details
        return payload


class BrandingNotFoundError(BrandingManagementError):
    code = "BRANDING_ASSET_NOT_FOUND"


class BrandingValidationError(BrandingManagementError):
    code = "BRANDING_VALIDATION_FAILED"


class BrandingDataSourceError(SystemDataSourceError, BrandingManagementError):
    code = "BRANDING_DATA_SOURCE_ERROR"


def _copy_config(value: dict[str, Any] | None = None) -> dict[str, Any]:
    return json.loads(json.dumps(value or DEFAULT_BRANDING_CONFIG, ensure_ascii=False))


def _version(config: dict[str, Any]) -> str:
    encoded = json.dumps(config, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:16]


def _normalize_text(value: Any, field: str, *, allow_empty: bool) -> str:
    limit = _TEXT_LIMITS[field]
    if not isinstance(value, str):
        raise BrandingValidationError("站点文案格式无效", [{"field": ".".join(field), "message": "必须为文本"}])
    normalized = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if any(ord(char) < 32 and char not in "\n\t" for char in normalized):
        raise BrandingValidationError("站点文案包含不允许的控制字符", [{"field": ".".join(field), "message": "请移除控制字符"}])
    if len(normalized) > limit:
        raise BrandingValidationError("站点文案超出长度限制", [{"field": ".".join(field), "message": f"最多 {limit} 个字符"}])
    if not normalized and not allow_empty:
        return ""
    return normalized


def _safe_branding_url(value: Any, key: str) -> str:
    default = DEFAULT_LOGO_URL if key == "logo_url" else DEFAULT_FAVICON_URL
    if not isinstance(value, str):
        raise BrandingValidationError("品牌图片路径无效", [{"field": key, "message": "必须为站内资源路径"}])
    normalized = value.strip()
    if normalized == default or _BRANDING_URL_RE.fullmatch(normalized):
        return normalized
    raise BrandingValidationError("品牌图片路径无效", [{"field": key, "message": "仅支持默认资源或本站已上传的品牌图片"}])


def validate_png(data: bytes) -> None:
    """Validate a bounded, fully decodable non-interlaced PNG using stdlib only."""
    if len(data) >= BRANDING_UPLOAD_LIMIT:
        raise BrandingValidationError("图片文件不能达到或超过 200 KB", [{"field": "file", "message": "文件大小必须小于 200 KB"}])
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise BrandingValidationError("PNG 文件内容无效", [{"field": "file", "message": "文件内容与 PNG 格式不符"}])

    offset = 8
    width = height = bit_depth = color_type = interlace = 0
    idat = bytearray()
    saw_ihdr = saw_idat = saw_iend = saw_plte = False
    idat_closed = False
    channels_by_type = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
    valid_depths = {0: {1, 2, 4, 8, 16}, 2: {8, 16}, 3: {1, 2, 4, 8}, 4: {8, 16}, 6: {8, 16}}

    while offset < len(data):
        if offset + 12 > len(data):
            raise BrandingValidationError("PNG 数据不完整")
        chunk_length = int.from_bytes(data[offset:offset + 4], "big")
        chunk_type = data[offset + 4:offset + 8]
        chunk_start = offset + 8
        chunk_end = chunk_start + chunk_length
        if chunk_end + 4 > len(data) or not re.fullmatch(rb"[A-Za-z]{4}", chunk_type):
            raise BrandingValidationError("PNG 数据块格式无效")
        chunk_data = data[chunk_start:chunk_end]
        expected_crc = int.from_bytes(data[chunk_end:chunk_end + 4], "big")
        if zlib.crc32(chunk_type + chunk_data) & 0xFFFFFFFF != expected_crc:
            raise BrandingValidationError("PNG 校验和无效")
        offset = chunk_end + 4

        if not saw_ihdr and chunk_type != b"IHDR":
            raise BrandingValidationError("PNG 缺少图像头")
        if chunk_type == b"IHDR":
            if saw_ihdr or chunk_length != 13 or saw_idat:
                raise BrandingValidationError("PNG 图像头无效")
            width = int.from_bytes(chunk_data[0:4], "big")
            height = int.from_bytes(chunk_data[4:8], "big")
            bit_depth, color_type = chunk_data[8], chunk_data[9]
            compression, filtering, interlace = chunk_data[10], chunk_data[11], chunk_data[12]
            if (
                width < 1 or height < 1 or width > 2048 or height > 2048
                or width * height > 4_194_304
                or color_type not in channels_by_type
                or bit_depth not in valid_depths[color_type]
                or compression != 0 or filtering != 0 or interlace != 0
            ):
                raise BrandingValidationError("PNG 图像尺寸或编码格式不受支持")
            saw_ihdr = True
        elif chunk_type == b"PLTE":
            if saw_plte or saw_idat or color_type in {0, 4} or not chunk_length or chunk_length > 768 or chunk_length % 3:
                raise BrandingValidationError("PNG 调色板无效")
            saw_plte = True
        elif chunk_type == b"IDAT":
            if idat_closed:
                raise BrandingValidationError("PNG 图像数据块顺序无效")
            if color_type == 3 and not saw_plte:
                raise BrandingValidationError("索引色 PNG 缺少调色板")
            saw_idat = True
            idat.extend(chunk_data)
            if len(idat) > BRANDING_UPLOAD_LIMIT:
                raise BrandingValidationError("PNG 图像数据超出限制")
        elif chunk_type == b"IEND":
            if chunk_length != 0 or not saw_idat or saw_iend:
                raise BrandingValidationError("PNG 结束数据块无效")
            saw_iend = True
            if offset != len(data):
                raise BrandingValidationError("PNG 结束标记后存在额外数据")
            break
        else:
            if saw_idat:
                idat_closed = True
            # Ancillary chunks are ignored; unknown critical chunks are rejected.
            if chunk_type[0:1].isupper():
                raise BrandingValidationError("PNG 包含不支持的关键数据块")

    if not (saw_ihdr and saw_idat and saw_iend):
        raise BrandingValidationError("PNG 图像数据不完整")
    bits_per_pixel = channels_by_type[color_type] * bit_depth
    stride = (width * bits_per_pixel + 7) // 8
    expected_bytes = (stride + 1) * height
    if expected_bytes > 21_000_000:
        raise BrandingValidationError("PNG 解码后图像过大")
    try:
        decoder = zlib.decompressobj()
        decoded = decoder.decompress(bytes(idat), expected_bytes + 1)
        if len(decoded) != expected_bytes or decoder.unconsumed_tail or decoder.unused_data:
            raise BrandingValidationError("PNG 图像压缩数据无效")
        decoded += decoder.flush()
        if len(decoded) != expected_bytes or not decoder.eof:
            raise BrandingValidationError("PNG 图像压缩数据无效")
    except zlib.error as error:
        raise BrandingValidationError("PNG 图像压缩数据无效") from error
    row_bytes = stride + 1
    if any(decoded[index * row_bytes] > 4 for index in range(height)):
        raise BrandingValidationError("PNG 行过滤器无效")


def sanitize_svg(data: bytes) -> bytes:
    """Parse SVG with a strict, local-only element/attribute/value allowlist."""
    if len(data) >= BRANDING_UPLOAD_LIMIT:
        raise BrandingValidationError("SVG 文件不能达到或超过 200 KB", [{"field": "file", "message": "文件大小必须小于 200 KB"}])
    try:
        source = data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise BrandingValidationError("SVG 必须使用 UTF-8 编码") from error
    lowered = source.lower()
    if "<!doctype" in lowered or "<!entity" in lowered or "<?xml-stylesheet" in lowered:
        raise BrandingValidationError("SVG 不允许文档类型、实体或外部样式表")
    try:
        root = ET.fromstring(source)
    except ET.ParseError as error:
        raise BrandingValidationError("SVG XML 格式无效") from error

    namespace = "http://www.w3.org/2000/svg"
    ET.register_namespace("", namespace)
    nodes = list(root.iter())
    if len(nodes) > 1000:
        raise BrandingValidationError("SVG 元素数量超出限制")

    def check_value(name: str, value: str) -> None:
        stripped = value.strip()
        lowered_value = stripped.lower()
        if any(token in lowered_value for token in ("url(", "javascript:", "data:", "http:", "https:", "file:", "\\")):
            raise BrandingValidationError("SVG 包含外部资源或危险 URL")
        if name in {"fill", "stroke"} and not _SVG_COLOR_RE.fullmatch(stripped):
            raise BrandingValidationError("SVG 颜色值不受支持")
        if name in {"width", "height", "stroke-width", "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2"}:
            if not _SVG_NUMBER_RE.fullmatch(stripped):
                raise BrandingValidationError("SVG 坐标值无效")
        if name == "viewBox" and not _SVG_COORDINATES_RE.fullmatch(stripped):
            raise BrandingValidationError("SVG viewBox 无效")
        if name in {"d", "points"} and not _SVG_PATH_RE.fullmatch(stripped):
            raise BrandingValidationError("SVG 路径数据无效")
        if name == "opacity" and (not _SVG_OPACITY_RE.fullmatch(stripped) or float(stripped) > 1 or float(stripped) < 0):
            raise BrandingValidationError("SVG 透明度无效")
        if name in {"fill-rule", "clip-rule"} and stripped not in {"evenodd", "nonzero"}:
            raise BrandingValidationError("SVG 填充规则无效")
        if name == "stroke-linecap" and stripped not in {"butt", "round", "square"}:
            raise BrandingValidationError("SVG 线端样式无效")
        if name == "stroke-linejoin" and stripped not in {"miter", "round", "bevel"}:
            raise BrandingValidationError("SVG 连接样式无效")
        if name == "transform" and not _is_safe_svg_transform(stripped):
            raise BrandingValidationError("SVG 变换无效")

    for element in nodes:
        if element.tag.startswith("{"):
            element_namespace, tag = element.tag[1:].split("}", 1)
        else:
            element_namespace, tag = "", element.tag
        if element_namespace != namespace or tag not in _ELEMENTS:
            raise BrandingValidationError("SVG 包含不允许的元素")
        if element.text and element.text.strip():
            raise BrandingValidationError("SVG 不允许文本节点")
        if element.tail and element.tail.strip():
            raise BrandingValidationError("SVG 不允许文本节点")
        if len(element.attrib) > 20:
            raise BrandingValidationError("SVG 属性数量超出限制")
        for raw_name, value in element.attrib.items():
            name = raw_name.rsplit("}", 1)[-1]
            if name not in _SVG_ATTRIBUTES:
                raise BrandingValidationError("SVG 包含不允许的属性")
            if name == "xmlns" and value != namespace:
                raise BrandingValidationError("SVG 命名空间无效")
            check_value(name, value)

    # Reject excessive nesting, which is cheap to check after the parser's bounded input.
    def check_depth(element: ET.Element, depth: int = 1) -> None:
        if depth > 20:
            raise BrandingValidationError("SVG 嵌套层级超出限制")
        for child in element:
            check_depth(child, depth + 1)

    check_depth(root)
    if root.tag != f"{{{namespace}}}svg":
        raise BrandingValidationError("SVG 根元素无效")
    view_box = root.attrib.get("viewBox")
    if not view_box:
        raise BrandingValidationError("SVG 必须提供 viewBox")
    numbers = re.findall(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", view_box)
    if len(numbers) != 4 or float(numbers[2]) <= 0 or float(numbers[3]) <= 0:
        raise BrandingValidationError("SVG viewBox 无效")
    return ET.tostring(root, encoding="utf-8", xml_declaration=False)


class BrandingService(AuditActorMixin):
    """Read and write one reserved JSON value in p_code_item.ext_json."""

    def __init__(self, upload_directory: str | Path | None = None):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._core = CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=BrandingDataSourceError,
        )
        self._upload_directory = Path(upload_directory) if upload_directory else _BRANDING_UPLOAD_DIRECTORY

    @property
    def upload_directory(self) -> Path:
        return self._upload_directory

    def _core_fetch(self, statement) -> list[dict[str, Any]]:
        return self._core.fetch_rows(statement)

    def _core_execute(self, statements) -> int:
        return self._core.execute_statements(statements)

    def _core_next(self, table, column) -> int:
        return self._core.next_pk(table, column)

    def _reserved_rows(self) -> list[dict[str, Any]]:
        return self._core_fetch(
            select(
                code_item.c.item_id,
                code_item.c.ext_json,
                code_item.c.is_active.label("item_active"),
                code_category.c.is_active.label("category_active"),
                code_category.c.category_id,
            )
            .select_from(code_item.join(
                code_category,
                code_item.c.category_code == code_category.c.category_code,
            ))
            .where(
                code_item.c.category_code == BRANDING_CATEGORY_CODE,
                code_item.c.item_code == BRANDING_ITEM_CODE,
            )
        )

    def _load_config(self) -> dict[str, Any]:
        rows = self._reserved_rows()
        if len(rows) > 1:
            raise BrandingDataSourceError("站点品牌配置存在重复记录")
        if not rows:
            return _copy_config()
        row = rows[0]
        if str(row.get("category_active") or "N").upper() != "N" or str(row.get("item_active") or "N").upper() != "N":
            raise BrandingDataSourceError("保留的站点品牌配置必须保持停用状态")
        try:
            stored = json.loads(row.get("ext_json") or "{}")
        except (TypeError, json.JSONDecodeError):
            stored = {}
        return self._merge_config(stored, _copy_config())

    @staticmethod
    def _merge_config(values: Any, base: dict[str, Any]) -> dict[str, Any]:
        merged = _copy_config(base)
        if not isinstance(values, dict):
            return merged
        for section, keys in (("site", ("title", "display_name", "announcement")), ("hero", ("title", "subtitle", "search_placeholder")), ("login", ("hint",))):
            candidate = values.get(section)
            if not isinstance(candidate, dict):
                continue
            for key in keys:
                localized = candidate.get(key)
                if not isinstance(localized, dict):
                    continue
                limit = _TEXT_LIMITS[(section, key)]
                for locale in SUPPORTED_LOCALES:
                    value = localized.get(locale)
                    if not isinstance(value, str):
                        continue
                    normalized = value.replace("\r\n", "\n").replace("\r", "\n").strip()
                    allow_empty = (section, key) in {("site", "announcement"), ("hero", "subtitle")}
                    if (
                        len(normalized) <= limit
                        and (normalized or allow_empty)
                        and not any(ord(char) < 32 and char not in "\n\t" for char in normalized)
                    ):
                        merged[section][key][locale] = normalized
        for key, default in (("logo_url", DEFAULT_LOGO_URL), ("favicon_url", DEFAULT_FAVICON_URL)):
            value = values.get("site", {}).get(key) if isinstance(values.get("site"), dict) else None
            if isinstance(value, str) and (value == default or _BRANDING_URL_RE.fullmatch(value)):
                merged["site"][key] = value
        raw_accent = values.get("site", {}).get("default_accent") if isinstance(values.get("site"), dict) else None
        if isinstance(raw_accent, str):
            normalized_accent = raw_accent.strip().lower()
            if normalized_accent in SUPPORTED_ACCENT_PRESETS:
                merged["site"]["default_accent"] = normalized_accent
        # Quick demo login is intentionally fixed off; the auth flow never consumes it.
        merged["login"]["quick_demo_login_enabled"] = False
        return merged

    def get_admin_config(self) -> dict[str, Any]:
        config = self._load_config()
        return {"config": config, "version": _version(config)}

    def get_public_config(self, locale: str = "zh-CN") -> dict[str, Any]:
        normalized_locale = locale if locale in SUPPORTED_LOCALES else "zh-CN"
        config = self._load_config()
        return {
            "site": {
                "title": config["site"]["title"][normalized_locale],
                "display_name": config["site"]["display_name"][normalized_locale],
                "announcement": config["site"]["announcement"][normalized_locale],
                "logo_url": config["site"]["logo_url"],
                "favicon_url": config["site"]["favicon_url"],
                "default_accent": config["site"]["default_accent"],
            },
            "hero": {
                "title": config["hero"]["title"][normalized_locale],
                "subtitle": config["hero"]["subtitle"][normalized_locale],
                "search_placeholder": config["hero"]["search_placeholder"][normalized_locale],
            },
            "login": {
                "hint": config["login"]["hint"][normalized_locale],
                "quick_demo_login_enabled": False,
            },
            "version": _version(config),
        }

    def _normalize_update(self, payload: Any, current: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise BrandingValidationError("站点品牌配置格式无效", [{"field": "body", "message": "必须为对象"}])
        allowed_sections = {"site", "hero", "login"}
        if set(payload) - allowed_sections:
            raise BrandingValidationError("包含不支持的配置项", [{"field": "body", "message": "只能修改站点、首页和登录展示配置"}])
        result = _copy_config(current)
        text_sections = {"site": {"title", "display_name", "announcement"}, "hero": {"title", "subtitle", "search_placeholder"}, "login": {"hint"}}
        for section, section_payload in payload.items():
            if not isinstance(section_payload, dict):
                raise BrandingValidationError("品牌配置分组格式无效", [{"field": section, "message": "必须为对象"}])
            allowed_keys = set(text_sections[section]) | ({"logo_url", "favicon_url", "default_accent"} if section == "site" else set()) | ({"quick_demo_login_enabled"} if section == "login" else set())
            unknown = set(section_payload) - allowed_keys
            if unknown:
                raise BrandingValidationError("包含不支持的配置项", [{"field": section, "message": "包含未知字段"}])
            for key in text_sections[section] & set(section_payload):
                translations = section_payload[key]
                if not isinstance(translations, dict) or set(translations) - set(SUPPORTED_LOCALES):
                    raise BrandingValidationError("多语言文案格式无效", [{"field": f"{section}.{key}", "message": "仅接受 zh-CN 和 en-US 文本"}])
                for locale, raw_text in translations.items():
                    text = _normalize_text(raw_text, (section, key), allow_empty=(section, key) == ("site", "announcement") or (section, key) == ("hero", "subtitle"))
                    if not text and (section, key) != ("site", "announcement") and (section, key) != ("hero", "subtitle"):
                        text = DEFAULT_BRANDING_CONFIG[section][key][locale]
                    result[section][key][locale] = text
            if section == "site":
                for key in ("logo_url", "favicon_url"):
                    if key in section_payload:
                        result["site"][key] = _safe_branding_url(section_payload[key], key)
                if "default_accent" in section_payload:
                    raw_accent = section_payload["default_accent"]
                    normalized_accent = raw_accent.strip().lower() if isinstance(raw_accent, str) else ""
                    if normalized_accent not in SUPPORTED_ACCENT_PRESETS:
                        raise BrandingValidationError(
                            "默认主题色无效",
                            [{"field": "site.default_accent", "message": "仅支持 purple、green、blue、orange"}],
                        )
                    result["site"]["default_accent"] = normalized_accent
            if section == "login" and "quick_demo_login_enabled" in section_payload:
                if section_payload["quick_demo_login_enabled"] is not False:
                    raise BrandingValidationError("快速体验登录保持关闭", [{"field": "login.quick_demo_login_enabled", "message": "此版本不提供快速登录"}])
        return result

    def _persist(self, config: dict[str, Any]) -> None:
        categories = self._core_fetch(
            select(code_category.c.category_id, code_category.c.is_active).where(
                code_category.c.category_code == BRANDING_CATEGORY_CODE,
            )
        )
        rows = self._reserved_rows()
        if len(categories) > 1 or len(rows) > 1:
            raise BrandingDataSourceError("站点品牌配置存在重复记录")
        if categories and str(categories[0].get("is_active") or "N").upper() != "N":
            raise BrandingDataSourceError("保留的站点品牌配置必须保持停用状态")
        if rows and (str(rows[0].get("item_active") or "N").upper() != "N" or str(rows[0].get("category_active") or "N").upper() != "N"):
            raise BrandingDataSourceError("保留的站点品牌配置必须保持停用状态")

        now_actor = self._default_operator
        values_json = json.dumps(config, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        statements = []
        if not categories:
            statements.append(insert(code_category).values(
                category_id=self._core_next(code_category, code_category.c.category_id),
                category_code=BRANDING_CATEGORY_CODE,
                category_name=BRANDING_CATEGORY_NAME,
                category_desc="DAP 主产品站点展示设置；保留参数，不作为公共码值。",
                display_order=999,
                is_active="N",
                remark="仅通过受权限保护的站点品牌配置接口维护。",
                created_by=now_actor,
                updated_by=now_actor,
            ))
        if rows:
            statements.append(
                update(code_item)
                .where(code_item.c.item_id == rows[0]["item_id"])
                .values(
                    ext_json=values_json,
                    is_active="N",
                    updated_by=now_actor,
                    updated_at=func.current_timestamp(),
                )
            )
        else:
            statements.append(insert(code_item).values(
                item_id=self._core_next(code_item, code_item.c.item_id),
                category_code=BRANDING_CATEGORY_CODE,
                item_code=BRANDING_ITEM_CODE,
                item_name=BRANDING_ITEM_NAME,
                item_value="stored-in-ext-json",
                item_desc="站点品牌 JSON 配置；请使用专用管理 API。",
                display_order=1,
                ext_json=values_json,
                is_active="N",
                remark="隐藏保留参数，不可经通用参数字典接口修改。",
                created_by=now_actor,
                updated_by=now_actor,
            ))
        self._core_execute(statements)

    @actor_aware
    def update_admin_config(self, payload: Any) -> dict[str, Any]:
        before = self._load_config()
        after = self._normalize_update(payload, before)
        with operation_log_service.audit(
            module_name="站点品牌",
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=BRANDING_CATEGORY_CODE,
            operation_desc="更新站点 Branding 配置",
            before=before,
            after=after,
        ):
            self._persist(after)
        return {"config": after, "version": _version(after)}

    @actor_aware
    def reset_admin_config(self) -> dict[str, Any]:
        before = self._load_config()
        after = _copy_config()
        with operation_log_service.audit(
            module_name="站点品牌",
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=BRANDING_CATEGORY_CODE,
            operation_desc="恢复站点 Branding 默认配置",
            before=before,
            after=after,
        ):
            self._persist(after)
        return {"config": after, "version": _version(after)}

    @actor_aware
    def upload_asset(self, kind: str, filename: str | None, content_type: str | None, data: bytes) -> dict[str, str]:
        if kind not in {"logo", "favicon"}:
            raise BrandingNotFoundError("品牌资源类型不存在")
        normalized_name = str(filename or "")
        if not normalized_name or "/" in normalized_name or "\\" in normalized_name or ".." in normalized_name:
            raise BrandingValidationError("上传文件名无效")
        suffix = Path(normalized_name).suffix.lower()
        media_type = str(content_type or "").split(";", 1)[0].strip().lower()
        if suffix == ".png" and media_type == "image/png":
            validate_png(data)
        elif suffix == ".svg" and media_type == "image/svg+xml":
            data = sanitize_svg(data)
        else:
            raise BrandingValidationError("仅支持内容与类型匹配的 PNG 或安全 SVG", [{"field": "file", "message": "文件扩展名、Content-Type 与实际内容必须一致"}])

        digest = hashlib.sha256(data).hexdigest()
        path = self._upload_directory / f"{digest}{suffix}"
        self._upload_directory.mkdir(parents=True, exist_ok=True)
        created = False
        temp_name: str | None = None
        try:
            with tempfile.NamedTemporaryFile(mode="wb", dir=self._upload_directory, prefix=".branding-", delete=False) as temp:
                temp_name = temp.name
                temp.write(data)
                temp.flush()
                os.fsync(temp.fileno())
            try:
                os.link(temp_name, path)
                created = True
            except FileExistsError:
                if not path.is_file() or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                    raise BrandingDataSourceError("品牌资源目标冲突，未覆盖现有文件")
            with operation_log_service.audit(
                module_name="站点品牌",
                operation_type=OPERATION_TYPE_UPDATE,
                operation_object=f"{BRANDING_CATEGORY_CODE}/{kind}",
                operation_desc=f"上传站点 {kind} 资源",
                after={"kind": kind, "sha256": digest, "format": suffix[1:], "bytes": len(data)},
            ):
                pass
        except BrandingManagementError:
            if created:
                path.unlink(missing_ok=True)
            raise
        except Exception as error:
            if created:
                path.unlink(missing_ok=True)
            raise BrandingDataSourceError("品牌资源保存失败") from error
        finally:
            if temp_name:
                Path(temp_name).unlink(missing_ok=True)
        return {"url": f"/static/branding/{digest}{suffix}", "sha256": digest, "format": suffix[1:]}


branding_service = BrandingService()


def default_public_branding(locale: str = "zh-CN") -> dict[str, Any]:
    """Return a fully localized fallback without reading any database state."""
    normalized_locale = locale if locale in SUPPORTED_LOCALES else "zh-CN"
    config = _copy_config()
    return {
        "site": {
            "title": config["site"]["title"][normalized_locale],
            "display_name": config["site"]["display_name"][normalized_locale],
            "announcement": config["site"]["announcement"][normalized_locale],
            "logo_url": config["site"]["logo_url"],
            "favicon_url": config["site"]["favicon_url"],
            "default_accent": config["site"]["default_accent"],
        },
        "hero": {
            "title": config["hero"]["title"][normalized_locale],
            "subtitle": config["hero"]["subtitle"][normalized_locale],
            "search_placeholder": config["hero"]["search_placeholder"][normalized_locale],
        },
        "login": {"hint": config["login"]["hint"][normalized_locale], "quick_demo_login_enabled": False},
        "version": _version(config),
    }
