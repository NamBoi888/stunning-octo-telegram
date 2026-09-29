"""Exception hierarchy shared by all modules.

The CLI catches :class:`TransitScopeError` and renders it as a friendly error
panel instead of a traceback, so every anticipated failure (missing file,
malformed feed, bad parameter) should raise one of these.
"""


class TransitScopeError(Exception):
    """Base class for all expected, user-facing errors."""


class InputFileError(TransitScopeError):
    """A required input file is missing, unreadable or in the wrong format."""


class GTFSValidationError(TransitScopeError):
    """A GTFS feed is structurally invalid (missing tables/columns, bad values)."""


class RenderError(TransitScopeError):
    """The SVG renderer received data it cannot draw."""
