"""Guardrail tests for execution-service code mirror integrity."""

from pathlib import Path


def _normalized_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


def test_execution_service_legacy_copy_matches_canonical() -> None:
    """Legacy sidecar copy must stay byte-equivalent to canonical execution service.

    This keeps security-critical auth/replay changes from silently diverging
    between the dedicated service and backend sidecar deployment.
    """
    repo_root = Path(__file__).resolve().parents[4]
    canonical_dir = repo_root / "apps" / "execution"
    legacy_dir = repo_root / "apps" / "backend" / "execution_service"

    for filename in ("auth.js", "server.js", "execute.js"):
        canonical = canonical_dir / filename
        legacy = legacy_dir / filename

        assert canonical.exists(), f"Missing canonical execution file: {canonical}"
        assert legacy.exists(), f"Missing legacy execution file: {legacy}"
        assert _normalized_text(legacy) == _normalized_text(canonical), (
            f"Legacy execution file is out of sync: {legacy} != {canonical}. "
            "Apply security fixes to both trees in the same change set."
        )
