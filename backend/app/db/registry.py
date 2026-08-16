"""Database adapter availability for diagnostics and edition boundaries."""

COMMUNITY_ADAPTERS = ("sqlite", "postgres")
PRIVATE_ADAPTERS = (*COMMUNITY_ADAPTERS, "gaussdb")


def available_adapter_names(edition: str) -> tuple[str, ...]:
    return COMMUNITY_ADAPTERS if edition == "community" else PRIVATE_ADAPTERS
