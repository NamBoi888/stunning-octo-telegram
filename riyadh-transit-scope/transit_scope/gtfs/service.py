"""Service-day selection from ``calendar.txt`` / ``calendar_dates.txt``.

KPIs are computed for a single representative service day. When the user
passes a date, the exact services active that day are used; otherwise the
weekday with the most scheduled trips is chosen (Sunday–Thursday is the
working week in Riyadh, so no weekday is assumed a priori).
"""

from __future__ import annotations

from datetime import date, datetime

import pandas as pd

from transit_scope.errors import GTFSValidationError
from transit_scope.gtfs.loader import GTFSFeed

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def _parse_date(text: str) -> date:
    try:
        return datetime.strptime(text, "%Y%m%d").date()
    except ValueError as exc:
        raise GTFSValidationError(f"Invalid service date {text!r}; expected YYYYMMDD") from exc


def _services_on(feed: GTFSFeed, day: date) -> set[str]:
    active: set[str] = set()
    ymd = day.strftime("%Y%m%d")
    cal = feed.calendar
    if cal is not None and not cal.empty:
        weekday = WEEKDAYS[day.weekday()]
        if weekday in cal:
            in_range = (cal["start_date"] <= ymd) & (cal["end_date"] >= ymd)
            runs = cal[weekday].astype(str).str.strip() == "1"
            active |= set(cal.loc[in_range & runs, "service_id"])
    exc = feed.calendar_dates
    if exc is not None and not exc.empty:
        today = exc[exc["date"] == ymd]
        kind = today["exception_type"].astype(str).str.strip()
        active |= set(today.loc[kind == "1", "service_id"])
        active -= set(today.loc[kind == "2", "service_id"])
    return active


def select_service(feed: GTFSFeed, service_date: str | None = None) -> tuple[set[str], str]:
    """Return ``(active service_ids, human-readable label)`` for the analysis day."""
    all_services = set(feed.trips["service_id"].unique())
    has_cal = feed.calendar is not None and not feed.calendar.empty
    has_dates = feed.calendar_dates is not None and not feed.calendar_dates.empty

    if service_date:
        day = _parse_date(service_date)
        active = _services_on(feed, day) if (has_cal or has_dates) else all_services
        if not active:
            raise GTFSValidationError(f"No service is scheduled on {service_date}.")
        return active, f"{day.isoformat()} ({WEEKDAYS[day.weekday()]})"

    if not has_cal and not has_dates:
        return all_services, "all services (no calendar)"

    trips_per_service = feed.trips.groupby("service_id").size()

    if has_cal:
        cal = feed.calendar
        best_day, best_count, best_services = "", -1, set()
        # Iterate from Sunday so ties resolve to the start of the Riyadh working week.
        for weekday in WEEKDAYS[-1:] + WEEKDAYS[:-1]:
            if weekday not in cal:
                continue
            services = set(cal.loc[cal[weekday].astype(str).str.strip() == "1", "service_id"])
            count = int(trips_per_service.reindex(list(services)).fillna(0).sum())
            if count > best_count:
                best_day, best_count, best_services = weekday, count, services
        if best_services:
            return best_services, f"busiest weekday ({best_day})"

    # calendar_dates-only feeds: choose the date with most trips.
    exc = feed.calendar_dates
    added = exc[exc["exception_type"].astype(str).str.strip() == "1"]
    per_date = (
        added.assign(trips=added["service_id"].map(trips_per_service).fillna(0))
        .groupby("date")["trips"]
        .sum()
    )
    if per_date.empty:
        return all_services, "all services (empty calendar)"
    best = str(per_date.idxmax())
    return _services_on(feed, _parse_date(best)), f"busiest date ({best})"


def expand_frequencies(stop_times: pd.DataFrame, frequencies: pd.DataFrame | None) -> pd.DataFrame:
    """Expand ``frequencies.txt`` template trips into concrete trip instances.

    Each template trip is replicated once per headway interval, shifting all
    its stop times so the first departure matches the instance start. The
    resulting ``trip_id`` values are suffixed with ``#<n>``; ``base_trip_id``
    preserves the link to ``trips.txt``.
    """
    stop_times = stop_times.assign(base_trip_id=stop_times["trip_id"])
    if frequencies is None or frequencies.empty:
        return stop_times

    templated = stop_times["trip_id"].isin(frequencies["trip_id"])
    fixed = stop_times[~templated]
    template = stop_times[templated]
    if template.empty:
        return stop_times

    first = template.groupby("trip_id")["dep_s"].min().rename("first_s")
    instances = []
    counter: dict[str, int] = {}
    for row in frequencies.itertuples(index=False):
        if row.trip_id not in first.index:
            continue
        # A template trip may have several frequency rows (e.g. peak/off-peak);
        # keep instance numbering unique across them.
        for start in range(int(row.start_s), int(row.end_s), int(row.headway_secs)):
            n = counter.get(row.trip_id, 0)
            counter[row.trip_id] = n + 1
            instances.append((row.trip_id, start - first[row.trip_id], f"{row.trip_id}#{n}"))
    if not instances:
        return fixed
    inst = pd.DataFrame(instances, columns=["trip_id", "offset", "instance_id"])
    expanded = template.merge(inst, on="trip_id")
    expanded["dep_s"] += expanded["offset"]
    expanded["arr_s"] += expanded["offset"]
    expanded["trip_id"] = expanded["instance_id"]
    expanded = expanded.drop(columns=["offset", "instance_id"])
    return pd.concat([fixed, expanded], ignore_index=True)
