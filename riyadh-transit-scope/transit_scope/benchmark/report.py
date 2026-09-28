"""Markdown and Rich renderings of benchmark results."""

from __future__ import annotations

from datetime import date

from rich.table import Table

from transit_scope.benchmark.engine import FARE_BURDEN_CEILING_PCT, METRICS, rank
from transit_scope.benchmark.models import BenchmarkDataset, CityMetrics, CityProfile


def rich_table(metrics: list[CityMetrics]) -> Table:
    """Side-by-side comparison table; the best value per row is highlighted."""
    table = Table(
        title="Multi-city transit benchmark",
        caption="★ best in row · indicative data, see report for sources",
        header_style="bold cyan",
        show_lines=False,
    )
    table.add_column("Metric", style="bold")
    table.add_column("Unit", style="dim")
    for m in metrics:
        table.add_column(f"{m.name}\n[dim]{m.data_year}[/dim]", justify="right")
    for spec in METRICS:
        ranks = rank(metrics, spec) if len(metrics) > 1 else {}
        cells = []
        for m in metrics:
            text = spec.format(getattr(m, spec.attr))
            if ranks.get(m.key) == 1:
                text = f"[bold green]{text} ★[/bold green]"
            cells.append(text)
        table.add_row(spec.label, spec.unit, *cells)
    return table


def _md_table(metrics: list[CityMetrics]) -> list[str]:
    head = "| Metric | Unit | " + " | ".join(m.name for m in metrics) + " |"
    sep = "|---|---|" + "|".join("---:" for _ in metrics) + "|"
    lines = [head, sep]
    for spec in METRICS:
        ranks = rank(metrics, spec) if len(metrics) > 1 else {}
        cells = []
        for m in metrics:
            text = spec.format(getattr(m, spec.attr))
            cells.append(f"**{text}**" if ranks.get(m.key) == 1 else text)
        lines.append(f"| {spec.label} | {spec.unit} | " + " | ".join(cells) + " |")
    return lines


def _findings(metrics: list[CityMetrics]) -> list[str]:
    if len(metrics) < 2:
        return []
    out = []
    for spec in METRICS:
        ranks = rank(metrics, spec)
        if not ranks:
            continue
        best = next(m for m in metrics if ranks[m.key] == 1)
        worst = next(m for m in metrics if ranks[m.key] == len(metrics))
        bv, wv = getattr(best, spec.attr), getattr(worst, spec.attr)
        if bv == wv:
            continue
        ratio = ""
        if wv and bv and min(bv, wv) > 0:
            factor = max(bv, wv) / min(bv, wv)
            ratio = f" ({factor:.1f}× difference)"
        out.append(
            f"- **{spec.label}:** {best.name} leads at {spec.format(bv)} {spec.unit}; "
            f"{worst.name} trails at {spec.format(wv)} {spec.unit}{ratio}."
        )
    return out


def markdown_report(
    dataset: BenchmarkDataset, profiles: list[CityProfile], metrics: list[CityMetrics]
) -> str:
    """Render a complete, self-contained Markdown benchmark report."""
    names = ", ".join(m.name for m in metrics)
    lines = [
        "# Multi-City Transit Benchmark",
        "",
        f"*Cities:* {names}  ",
        f"*Generated:* {date.today().isoformat()} by `riyadh-transit-scope`",
        "",
    ]
    if dataset.disclaimer:
        lines += [f"> **Data note.** {dataset.disclaimer}", ""]
    lines += ["## Side-by-side comparison", "", *_md_table(metrics), "",
              "Bold marks the best value in each row (urban extent is context only).", ""]

    findings = _findings(metrics)
    if findings:
        lines += ["## Key findings", "", *findings, ""]

    lines += ["## Mode supply detail", ""]
    lines += ["| City | Mode | Route km | Lines | Fleet | Peak headway (min) |",
              "|---|---|---:|---:|---:|---:|"]
    for p in profiles:
        for mode, stats in p.modes():
            lines.append(
                f"| {p.name} | {mode.replace('_', ' ')} | {stats.route_km:,.0f} | {stats.lines} "
                f"| {stats.fleet_vehicles:,} | {stats.peak_headway_min:.1f} |"
            )
    lines += [
        "",
        "## Methodology",
        "",
        "- **Coverage vs. urban extent** = network walk-catchment area ÷ built-up urban area.",
        "- **Route density** = total one-way route-km (all modes) ÷ urban extent.",
        "- **Mean peak headway** = route-km-weighted mean of modal peak headways.",
        "- **Rapid transit : bus fleet ratio** = rail rapid-transit revenue vehicles ÷ buses.",
        "- **Fare accessibility index** = 100 × (1 − monthly-pass burden ÷ "
        f"{FARE_BURDEN_CEILING_PCT:.0f}%), clamped to 0–100; burden = monthly pass (USD) ÷ "
        "median monthly household income (USD).",
        "",
        "## City notes & sources",
        "",
    ]
    for p in profiles:
        lines.append(f"### {p.name}, {p.country} ({p.data_year})")
        lines.append("")
        if p.coverage_definition:
            lines.append(f"- Coverage definition: {p.coverage_definition}")
        lines.append(
            f"- Monthly pass: {p.monthly_pass_local:,.0f} {p.currency} "
            f"(≈ USD {p.monthly_pass_usd:,.0f})"
        )
        if p.notes:
            lines.append(f"- Notes: {p.notes}")
        for src in p.sources:
            lines.append(f"- Source: {src}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
