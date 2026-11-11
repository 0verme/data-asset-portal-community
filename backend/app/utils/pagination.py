"""Pagination normalization for explicit catalog page APIs."""

from ..settings import get_page_size_limits


def resolve_paging(page=None, page_size=None):
    default_size, max_size = get_page_size_limits(20)
    try:
        page = int(page) if page is not None and page != "" else 1
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = int(page_size) if page_size is not None and page_size != "" else default_size
    except (TypeError, ValueError):
        page_size = default_size
    return max(1, page), max(1, min(max_size, page_size))
