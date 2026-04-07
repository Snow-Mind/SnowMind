"""Utilities for grounded risk explanations backed by report.md.

This service keeps assistant explanations anchored to the canonical risk report
in the repository root. It does not call any external model and never mutates
risk scores.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

logger = logging.getLogger("snowmind")

_REPORT_FILENAME = "report.md"

# Heading hints let us map human section names in report.md to canonical IDs.
_PROTOCOL_HEADING_HINTS: dict[str, tuple[str, ...]] = {
    "aave_v3": ("aave v3",),
    "benqi": ("benqi",),
    "spark": ("spark", "spusdc"),
    "euler_v2": ("euler", "9summits"),
    "silo_savusd_usdc": ("silo", "savusd/usdc"),
    "silo_susdp_usdc": ("silo", "susdp/usdc"),
    "silo_gami_usdc": ("silo v3", "gami", "usdc vault"),
    "folks": ("folks finance", "xchain"),
}


@dataclass(frozen=True)
class RiskReportContext:
    """Context payload returned to API routes for assistant-facing responses."""

    framework_markdown: str
    protocol_markdown: str
    report_source: str | None
    report_updated_at: str | None


class RiskReportExplainer:
    """Load and cache report.md sections for protocol risk explanations."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._cached_path: Path | None = None
        self._cached_mtime_ns: int | None = None
        self._cached_framework: str = ""
        self._cached_sections: dict[str, str] = {}
        self._cached_updated_iso: str | None = None

    def get_context(self, protocol_id: str) -> RiskReportContext:
        """Return framework + protocol sections for the requested protocol."""
        normalized = (protocol_id or "").strip().lower()
        if normalized in {"folks_finance_xchain", "folks_finance"}:
            normalized = "folks"
        self._refresh_if_needed()

        with self._lock:
            framework = self._cached_framework
            protocol = self._cached_sections.get(normalized, "")
            source = self._cached_path.name if self._cached_path else None
            updated_at = self._cached_updated_iso

        if not framework:
            framework = (
                "Risk framework reference is unavailable because report.md could "
                "not be loaded from this deployment environment."
            )

        if not protocol:
            protocol = (
                "No protocol-specific section was found in report.md for this "
                "protocol identifier."
            )

        return RiskReportContext(
            framework_markdown=framework,
            protocol_markdown=protocol,
            report_source=source,
            report_updated_at=updated_at,
        )

    def _refresh_if_needed(self) -> None:
        path = self._locate_report_path()
        if path is None:
            with self._lock:
                self._cached_path = None
                self._cached_mtime_ns = None
                self._cached_framework = ""
                self._cached_sections = {}
                self._cached_updated_iso = None
            return

        try:
            stat = path.stat()
        except OSError as exc:
            logger.warning("Unable to stat %s: %s", path, exc)
            return

        mtime_ns = stat.st_mtime_ns

        with self._lock:
            if self._cached_path == path and self._cached_mtime_ns == mtime_ns:
                return

        try:
            markdown = path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning("Unable to read %s: %s", path, exc)
            return

        framework = self._extract_framework(markdown)
        sections = self._extract_protocol_sections(markdown)
        updated_iso = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()

        with self._lock:
            self._cached_path = path
            self._cached_mtime_ns = mtime_ns
            self._cached_framework = framework
            self._cached_sections = sections
            self._cached_updated_iso = updated_iso

    def _locate_report_path(self) -> Path | None:
        """Find report.md by walking up from this module."""
        this_file = Path(__file__).resolve()
        for parent in this_file.parents:
            candidate = parent / _REPORT_FILENAME
            if candidate.is_file():
                return candidate
        logger.warning("%s not found in parent directories of %s", _REPORT_FILENAME, this_file)
        return None

    @staticmethod
    def _extract_framework(markdown: str) -> str:
        lower = markdown.lower()
        start = lower.find("## scoring framework")
        end = lower.find("## protocol assessments")
        if start != -1 and end != -1 and end > start:
            return markdown[start:end].strip()

        # Conservative fallback when headings are edited.
        return markdown[:3000].strip()

    def _extract_protocol_sections(self, markdown: str) -> dict[str, str]:
        headings = list(re.finditer(r"^###\s+(.+?)\s*$", markdown, flags=re.MULTILINE))
        sections: dict[str, str] = {}

        for idx, match in enumerate(headings):
            title = (match.group(1) or "").strip().lower()
            start = match.start()
            end = headings[idx + 1].start() if idx + 1 < len(headings) else len(markdown)
            section_markdown = markdown[start:end].strip()

            protocol_id = self._map_title_to_protocol_id(title)
            if protocol_id is None:
                continue

            # First match wins to avoid accidental overwrite from similarly named headings.
            if protocol_id not in sections:
                sections[protocol_id] = section_markdown

        return sections

    @staticmethod
    def _map_title_to_protocol_id(title: str) -> str | None:
        for protocol_id, hints in _PROTOCOL_HEADING_HINTS.items():
            if all(hint in title for hint in hints):
                return protocol_id

        # Fallback for headings where one hint is sufficient.
        for protocol_id, hints in _PROTOCOL_HEADING_HINTS.items():
            if any(hint in title for hint in hints):
                return protocol_id

        return None
