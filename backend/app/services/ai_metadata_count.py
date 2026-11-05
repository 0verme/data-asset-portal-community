"""Catalog-driven parsing for safe table-count questions.

This module recognizes a narrow metadata-count intent. Filter values are never
invented: they must match the current asset-list facet catalog supplied by the
caller. It deliberately does not generate or execute SQL.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


_FIELD_COUNT_PATTERN = re.compile(
    r"(?:多少|几)\s*(?:个)?\s*(?:字段|列)|(?:字段|列)\s*(?:的\s*)?(?:数量|总数|个数|多少|几)",
    re.IGNORECASE,
)

_COUNT_PATTERNS = (
    re.compile(r"(?:多少|几)\s*(?:张|个)?\s*(?:数据\s*)?表", re.IGNORECASE),
    re.compile(r"(?:数据\s*)?表\s*(?:的\s*)?(?:数量|总数|个数)", re.IGNORECASE),
    re.compile(r"(?:数据\s*)?表(?!示).{0,8}(?:多少|几|数量|总数|个数)", re.IGNORECASE),
    re.compile(r"\bhow\s+many\s+(?:data\s+)?tables?\b", re.IGNORECASE),
    re.compile(r"\b(?:data\s+)?table\s+(?:count|number)\b", re.IGNORECASE),
    re.compile(r"\bcount\s+of\s+(?:data\s+)?tables?\b", re.IGNORECASE),
    re.compile(r"\btotal\s+(?:number\s+of\s+)?(?:data\s+)?tables?\b", re.IGNORECASE),
)

# These are generic question words, not business-domain aliases. Dimension
# aliases always come from the live catalog, never from this list.
_GENERIC_REMAINDERS = (
    "当前数据资产目录", "当前dap目录", "数据资产目录", "资产目录", "当前目录", "dap目录",
    "数据表", "数据", "主题域", "分层", "数据层", "层", "表",
    "how many", "total number of", "number of", "count of", "table count", "tables count",
    "data tables", "data table", "tables", "table", "catalog", "assets", "asset", "data",
    "一共", "总共", "总计", "共有", "所有", "全部", "某个", "多少张", "几张", "多少个",
    "是多少", "多少", "几", "数量", "总数", "个数", "有", "的", "中", "当前", "现在", "请问",
    "帮我", "能否", "可以", "是", "和", "在", "按", "what", "are", "the", "all", "how", "many", "total",
    "please", "in", "of", "has", "have", "do", "we", "you",
)


@dataclass(frozen=True)
class CountDimension:
    code: str
    display_name: str
    matched_as: str
    inferred: bool


@dataclass(frozen=True)
class MetadataCountIntent:
    domain: CountDimension | None = None
    layer: CountDimension | None = None


@dataclass(frozen=True)
class _Alias:
    dimension: str
    code: str
    display_name: str
    text: str
    inferred: bool


@dataclass(frozen=True)
class _Match:
    start: int
    end: int
    dimension: str
    code: str
    display_name: str
    alias: str
    inferred: bool


def is_metadata_count_query(query: str) -> bool:
    """Return whether *query* explicitly asks for a table count."""
    normalized = " ".join(str(query or "").split()).casefold()
    if _FIELD_COUNT_PATTERN.search(normalized):
        return False
    return any(pattern.search(normalized) for pattern in _COUNT_PATTERNS)


def _layer_aliases(code: str, display_name: str) -> list[tuple[str, bool]]:
    aliases: dict[str, bool] = {}
    for value in (code, display_name):
        text = str(value or "").strip()
        if text:
            aliases[text] = False
    # Derive conservative, generic variants from the configured layer label.
    # E.g. a catalog label "数据集市层" may be spoken as "集市"; this maps to
    # whatever layer currently owns that label and does not assume a fixed code.
    labels = [str(display_name or "").strip()]
    for label in tuple(labels):
        if label.endswith("层") and len(label) > 1:
            labels.append(label[:-1])
    for label in tuple(labels):
        if label.startswith("数据") and len(label) > 2:
            labels.append(label[2:])
    for label in labels:
        if len(label) >= 2:
            aliases.setdefault(label, True)
    return list(aliases.items())


def _aliases(catalog: Any) -> list[_Alias]:
    if not isinstance(catalog, dict):
        raise ValueError("asset filter catalog is malformed")
    aliases: list[_Alias] = []
    for row in catalog.get("domains", []):
        if not isinstance(row, dict):
            raise ValueError("asset domain catalog is malformed")
        code = str(row.get("code") or "").strip()
        name = str(row.get("name") or "").strip()
        if not code or not name:
            continue
        aliases.append(_Alias("domain", code, name, name, False))
        aliases.append(_Alias("domain", code, name, code, False))
    for row in catalog.get("layers", []):
        if not isinstance(row, dict):
            raise ValueError("asset layer catalog is malformed")
        code = str(row.get("code") or "").strip()
        name = str(row.get("name") or "").strip()
        if not code:
            continue
        display_name = name or code
        aliases.extend(
            _Alias("layer", code, display_name, alias, inferred)
            for alias, inferred in _layer_aliases(code, display_name)
        )
    return aliases


def _find_matches(query: str, aliases: list[_Alias]) -> list[_Match]:
    matches: list[_Match] = []
    for item in aliases:
        alias = item.text.casefold()
        if not alias:
            continue
        if re.fullmatch(r"[a-z0-9_-]+", alias):
            pattern = re.compile(rf"(?<![a-z0-9_]){re.escape(alias)}(?![a-z0-9_])", re.IGNORECASE)
            occurrences = ((match.start(), match.end()) for match in pattern.finditer(query))
        else:
            occurrences = _substring_occurrences(query, alias)
        for start, end in occurrences:
            matches.append(
                _Match(start, end, item.dimension, item.code, item.display_name, item.text, item.inferred)
            )
    return matches


def _substring_occurrences(value: str, needle: str):
    start = 0
    while True:
        index = value.find(needle, start)
        if index < 0:
            return
        yield index, index + len(needle)
        start = index + 1


def _select_dimension(
    matches: list[_Match], dimension: str
) -> tuple[CountDimension | None, list[_Match], bool]:
    candidates = [item for item in matches if item.dimension == dimension]
    if not candidates:
        return None, [], False

    # Multiple catalog entries claiming the same exact phrase are ambiguous.
    by_span: dict[tuple[int, int], set[str]] = {}
    for item in candidates:
        by_span.setdefault((item.start, item.end), set()).add(item.code)
    if any(len(codes) > 1 for codes in by_span.values()):
        return None, candidates, True

    # Prefer the longest live catalog value when one value contains another
    # (for example, a short domain name embedded in a longer domain name).
    kept: list[_Match] = []
    for item in candidates:
        shadowed = any(
            other.code != item.code
            and other.start <= item.start
            and other.end >= item.end
            and (other.start, other.end) != (item.start, item.end)
            for other in candidates
        )
        if not shadowed:
            kept.append(item)
    distinct_codes = {item.code for item in kept}
    if len(distinct_codes) != 1:
        return None, kept, True

    code = next(iter(distinct_codes))
    selected = [item for item in kept if item.code == code]
    # Prefer a direct catalog value over a derived natural-language alias.
    selected.sort(key=lambda item: (item.inferred, -(item.end - item.start)))
    match = selected[0]
    return (
        CountDimension(
            code=match.code,
            display_name=match.display_name,
            matched_as="catalog_alias" if match.inferred else "catalog_value",
            inferred=match.inferred,
        ),
        selected,
        False,
    )


def _remove_matches(query: str, matches: list[_Match]) -> str:
    chars = list(query)
    for item in matches:
        for index in range(item.start, item.end):
            chars[index] = " "
    return "".join(chars)


def _has_unknown_scope(remainder: str, *, allow_vague_modifier: bool = False) -> bool:
    normalized = remainder.casefold()
    # "某个" is harmless only alongside a recognized catalog dimension (e.g.
    # "某个集市"). Without one, preserve it so "某个主题域" cannot degrade to
    # an unfiltered global count.
    generic_words = [
        word for word in _GENERIC_REMAINDERS
        if allow_vague_modifier or word not in {"某个", "数据"}
    ]
    # Remove generic grammar longest-first. These words do not resolve a
    # dimension; any meaningful residue is an unrecognized scope and must fail
    # closed rather than silently becoming an unfiltered total.
    for word in sorted(generic_words, key=len, reverse=True):
        normalized = normalized.replace(word.casefold(), " ")
    normalized = re.sub(r"[\s\W_]+", "", normalized, flags=re.UNICODE)
    return bool(normalized)


def resolve_metadata_count_intent(
    query: str,
    catalog: Any,
) -> MetadataCountIntent | None:
    """Resolve filters from catalog values, or return ``None`` if ambiguous.

    Call this only after :func:`is_metadata_count_query` returned true. ``None``
    means the user supplied an unknown, conflicting, or overlapping scope; an
    empty ``MetadataCountIntent`` is an explicit request for the full catalog.
    """
    normalized = " ".join(str(query or "").split()).casefold()
    live_aliases = _aliases(catalog)
    matches = _find_matches(normalized, live_aliases)
    domain, domain_matches, domain_ambiguous = _select_dimension(matches, "domain")
    layer, layer_matches, layer_ambiguous = _select_dimension(matches, "layer")
    if domain_ambiguous or layer_ambiguous:
        return None

    for domain_match in domain_matches:
        for layer_match in layer_matches:
            if domain_match.start < layer_match.end and layer_match.start < domain_match.end:
                # The same phrase may name a domain and a layer. Do not guess.
                return None

    selected_matches = [*domain_matches, *layer_matches]
    remainder = _remove_matches(normalized, selected_matches)
    if _has_unknown_scope(
        remainder,
        allow_vague_modifier=domain is not None or layer is not None,
    ):
        return None
    return MetadataCountIntent(domain=domain, layer=layer)


__all__ = [
    "CountDimension",
    "MetadataCountIntent",
    "is_metadata_count_query",
    "resolve_metadata_count_intent",
]
