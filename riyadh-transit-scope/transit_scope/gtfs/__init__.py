"""GTFS engine: feed ingestion, validation and network KPI computation."""

from transit_scope.gtfs.kpis import AnalysisResult, analyze_feed
from transit_scope.gtfs.loader import GTFSFeed, load_feed
from transit_scope.gtfs.models import AnalysisConfig, NetworkReport, TimeWindow

__all__ = [
    "AnalysisConfig",
    "AnalysisResult",
    "GTFSFeed",
    "NetworkReport",
    "TimeWindow",
    "analyze_feed",
    "load_feed",
]
