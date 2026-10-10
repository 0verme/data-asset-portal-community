"""Portable helpers for literal SQL LIKE keyword matching."""

LIKE_ESCAPE_CHAR = "~"


def escape_like_keyword(value: str) -> str:
    """Escape LIKE metacharacters for a pattern using ``~`` as ESCAPE.

    Escape the escape character first so user-provided tildes remain literal.
    The caller should keep the resulting pattern as a bound SQL parameter.
    """
    return (
        value.replace(LIKE_ESCAPE_CHAR, LIKE_ESCAPE_CHAR * 2)
        .replace("%", f"{LIKE_ESCAPE_CHAR}%")
        .replace("_", f"{LIKE_ESCAPE_CHAR}_")
    )
