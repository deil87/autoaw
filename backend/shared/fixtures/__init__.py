from __future__ import annotations
import json
from pathlib import Path

_FIXTURES_DIR = Path(__file__).parent

TOPOLOGY_FIXTURES = [
    "fixed_pipeline",
    "ai_orchestrated",
    "debate",
    "parallel_reduce",
    "human_in_loop",
    "hybrid",
]


def load_fixture(topology: str) -> dict:
    """Load a canonical fixture gene dict by topology type."""
    if topology not in TOPOLOGY_FIXTURES:
        raise ValueError(
            f"Unknown topology fixture: {topology!r}. Valid: {TOPOLOGY_FIXTURES}"
        )
    path = _FIXTURES_DIR / f"{topology}.json"
    with path.open() as f:
        return json.load(f)
