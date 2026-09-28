"""GTFS time helpers.

GTFS times are ``HH:MM:SS`` strings measured from "noon minus 12h" of the
service day and may exceed 24:00:00 for trips running past midnight, so they
are handled as integer seconds rather than ``datetime.time`` objects.
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

_HHMM = re.compile(r"^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$")


def parse_hhmm(value: str) -> int:
    """Parse ``HH:MM`` or ``HH:MM:SS`` (hours may exceed 23) into seconds.

    >>> parse_hhmm("07:30")
    27000
    >>> parse_hhmm("25:00:00")
    90000
    """
    match = _HHMM.match(value)
    if not match:
        raise ValueError(f"Invalid time {value!r}; expected HH:MM or HH:MM:SS")
    hours, minutes, seconds = match.groups()
    minutes_i, seconds_i = int(minutes), int(seconds or 0)
    if minutes_i > 59 or seconds_i > 59:
        raise ValueError(f"Invalid time {value!r}; minutes/seconds must be < 60")
    return int(hours) * 3600 + minutes_i * 60 + seconds_i


def format_seconds(seconds: float | int | None) -> str:
    """Format seconds-after-midnight as ``HH:MM`` (``--:--`` for missing)."""
    if seconds is None or (isinstance(seconds, float) and np.isnan(seconds)):
        return "--:--"
    total_minutes = int(round(float(seconds) / 60.0))
    return f"{total_minutes // 60:02d}:{total_minutes % 60:02d}"


def gtfs_time_series_to_seconds(series: pd.Series) -> pd.Series:
    """Vectorised conversion of a GTFS time column to float seconds.

    Blank or malformed values become ``NaN`` (GTFS allows empty times on
    non-timepoint stops). Times repeat heavily in large feeds, so only the
    distinct values are parsed and the result is broadcast back.
    """
    codes, uniques = pd.factorize(series, use_na_sentinel=True)
    if len(uniques) == 0:
        return pd.Series(np.nan, index=series.index, dtype="float64")
    parts = pd.Series(uniques).astype("string").str.strip().str.split(":", expand=True)
    if parts.shape[1] < 2:
        return pd.Series(np.nan, index=series.index, dtype="float64")
    hours = pd.to_numeric(parts[0], errors="coerce")
    minutes = pd.to_numeric(parts[1], errors="coerce")
    seconds = (
        pd.to_numeric(parts[2], errors="coerce").fillna(0)
        if parts.shape[1] > 2
        else pd.Series(0, index=parts.index)
    )
    parsed = (hours * 3600 + minutes * 60 + seconds).to_numpy(dtype="float64", na_value=np.nan)
    # Append NaN so the -1 "missing" sentinel code indexes it.
    lookup = np.append(parsed, np.nan)
    return pd.Series(lookup[codes], index=series.index, dtype="float64")
