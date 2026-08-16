class MigrationError(RuntimeError):
    """Base class for safe, operator-facing migration failures."""


class ManifestError(MigrationError):
    pass


class VerificationError(MigrationError):
    pass


class LockError(MigrationError):
    pass


class BaselineError(MigrationError):
    pass
