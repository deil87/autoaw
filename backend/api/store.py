from __future__ import annotations
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.shared.experiment import ExperimentConfig
from backend.shared.gene import Gene
from backend.engine.gp.loop import TrialResult

_CREATE_EXPERIMENTS = """
CREATE TABLE IF NOT EXISTS experiments (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    config_json     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    best_gene_json  TEXT,
    best_fitness    REAL,
    error_message   TEXT
)
"""

_CREATE_TRIALS = """
CREATE TABLE IF NOT EXISTS trials (
    id              TEXT PRIMARY KEY,
    experiment_id   TEXT NOT NULL REFERENCES experiments(id),
    generation      INTEGER NOT NULL,
    gene_id         TEXT NOT NULL,
    gene_json       TEXT NOT NULL,
    fitness         REAL NOT NULL,
    quality         REAL NOT NULL,
    cost_usd        REAL NOT NULL,
    latency_ms      INTEGER NOT NULL,
    created_at      TEXT NOT NULL
)
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class LocalStore:
    """SQLite-backed store. Each instance creates its own per-thread connections."""

    def __init__(self, db_path: str = "autoaw.db") -> None:
        self.db_path = db_path
        self._local = threading.local()

    def _conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn"):
            conn = sqlite3.connect(self.db_path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            self._local.conn = conn
        return self._local.conn

    def init_db(self) -> None:
        conn = self._conn()
        conn.execute(_CREATE_EXPERIMENTS)
        conn.execute(_CREATE_TRIALS)
        conn.commit()

    # ── Experiment CRUD ──────────────────────────────────────────────────────

    def create_experiment(self, experiment_id: str, config: ExperimentConfig) -> None:
        now = _now()
        self._conn().execute(
            "INSERT INTO experiments (id, name, config_json, status, created_at, updated_at) "
            "VALUES (?, ?, ?, 'pending', ?, ?)",
            (experiment_id, config.name, json.dumps(config.to_dict()), now, now),
        )
        self._conn().commit()

    def get_experiment(self, experiment_id: str) -> dict[str, Any]:
        row = (
            self._conn()
            .execute("SELECT * FROM experiments WHERE id = ?", (experiment_id,))
            .fetchone()
        )
        if row is None:
            raise KeyError(f"Experiment {experiment_id!r} not found")
        return dict(row)

    def list_experiments(self) -> list[dict[str, Any]]:
        rows = (
            self._conn()
            .execute(
                "SELECT id, name, status, created_at, updated_at, best_fitness "
                "FROM experiments ORDER BY created_at DESC"
            )
            .fetchall()
        )
        return [dict(r) for r in rows]

    def update_experiment_status(
        self, experiment_id: str, status: str, error: str | None = None
    ) -> None:
        self._conn().execute(
            "UPDATE experiments SET status = ?, error_message = ?, updated_at = ? WHERE id = ?",
            (status, error, _now(), experiment_id),
        )
        self._conn().commit()

    def get_experiment_config(self, experiment_id: str) -> ExperimentConfig:
        row = self.get_experiment(experiment_id)
        return ExperimentConfig.from_dict(json.loads(row["config_json"]))

    def put_best_gene(self, experiment_id: str, gene: Gene, fitness: float) -> None:
        self._conn().execute(
            "UPDATE experiments SET best_gene_json = ?, best_fitness = ?, "
            "status = 'completed', updated_at = ? WHERE id = ?",
            (json.dumps(gene.to_dict()), fitness, _now(), experiment_id),
        )
        self._conn().commit()

    # ── Trials ───────────────────────────────────────────────────────────────

    def put_trial_result(self, experiment_id: str, result: TrialResult) -> None:
        self._conn().execute(
            "INSERT INTO trials "
            "(id, experiment_id, generation, gene_id, gene_json, "
            " fitness, quality, cost_usd, latency_ms, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                str(uuid.uuid4()),
                experiment_id,
                result.generation,
                result.gene.id,
                json.dumps(result.gene.to_dict()),
                result.fitness,
                result.pareto.quality,
                result.pareto.cost_usd,
                result.pareto.latency_ms,
                _now(),
            ),
        )
        self._conn().commit()

    def list_trials(
        self, experiment_id: str, page: int = 1, limit: int = 50
    ) -> list[dict[str, Any]]:
        offset = (page - 1) * limit
        rows = (
            self._conn()
            .execute(
                "SELECT * FROM trials WHERE experiment_id = ? "
                "ORDER BY created_at ASC LIMIT ? OFFSET ?",
                (experiment_id, limit, offset),
            )
            .fetchall()
        )
        return [dict(r) for r in rows]
