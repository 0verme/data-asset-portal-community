"""Deprecated database facade kept for private-edition import compatibility.

New code should import :mod:`backend.app.db.facade`.  Importing this module is
safe without JayDeBeApi/JPype; the JDBC implementation is loaded only when a
GaussDB profile is selected.
"""

from .facade import *  # noqa: F401,F403
from .facade import (  # compatibility for existing private tests and scripts
    _connect_gaussdb,
    _connect_postgres,
    _commit_if_needed,
    _prepare_execute_args,
    _rollback_if_needed,
)


def __getattr__(name):
    if name == "jaydebeapi":
        from .gaussdb_adapter import jaydebeapi

        return jaydebeapi
    raise AttributeError(name)
