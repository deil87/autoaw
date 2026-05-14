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
    stop_reason     TEXT,
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

_ALTER_TRIALS_PARENT = """
ALTER TABLE trials ADD COLUMN parent_gene_ids TEXT NOT NULL DEFAULT '[]'
"""

_ALTER_TRIALS_MUTATION_OP = """
ALTER TABLE trials ADD COLUMN mutation_op TEXT NOT NULL DEFAULT 'seed'
"""

_ALTER_EXPERIMENTS_PROGRESS = """
ALTER TABLE experiments ADD COLUMN progress_json TEXT
"""

_ALTER_EXPERIMENTS_STOP_REASON = """
ALTER TABLE experiments ADD COLUMN stop_reason TEXT
"""

_CREATE_EVAL_ROWS = """
CREATE TABLE IF NOT EXISTS eval_rows (
    id              TEXT PRIMARY KEY,
    trial_id        TEXT NOT NULL REFERENCES trials(id),
    row_index       INTEGER NOT NULL,
    input_json      TEXT NOT NULL,
    output_text     TEXT NOT NULL DEFAULT '',
    score           REAL NOT NULL,
    score_reasoning TEXT NOT NULL DEFAULT '',
    latency_ms      INTEGER NOT NULL DEFAULT 0,
    cost_usd        REAL NOT NULL DEFAULT 0.0
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
        conn.execute(_CREATE_EVAL_ROWS)
        # Idempotent ALTER TABLE — ignore if columns already exist
        for stmt in (
            _ALTER_TRIALS_PARENT,
            _ALTER_TRIALS_MUTATION_OP,
            _ALTER_EXPERIMENTS_PROGRESS,
            _ALTER_EXPERIMENTS_STOP_REASON,
        ):
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError:
                pass  # Column already exists
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

    def update_progress(self, experiment_id: str, progress: dict) -> None:
        self._conn().execute(
            "UPDATE experiments SET progress_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(progress), _now(), experiment_id),
        )
        self._conn().commit()

    def get_experiment_config(self, experiment_id: str) -> ExperimentConfig:
        row = self.get_experiment(experiment_id)
        return ExperimentConfig.from_dict(json.loads(row["config_json"]))

    def put_best_gene(
        self,
        experiment_id: str,
        gene: Gene,
        fitness: float,
        stop_reason: str = "completed",
    ) -> None:
        self._conn().execute(
            "UPDATE experiments SET best_gene_json = ?, best_fitness = ?, "
            "status = 'completed', stop_reason = ?, updated_at = ? WHERE id = ?",
            (json.dumps(gene.to_dict()), fitness, stop_reason, _now(), experiment_id),
        )
        self._conn().commit()

    # ── Trials ───────────────────────────────────────────────────────────────

    def put_trial_result(self, experiment_id: str, result: TrialResult) -> None:
        trial_id = str(uuid.uuid4())
        now = _now()
        self._conn().execute(
            "INSERT INTO trials "
            "(id, experiment_id, generation, gene_id, gene_json, "
            " fitness, quality, cost_usd, latency_ms, created_at, "
            " parent_gene_ids, mutation_op) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                trial_id,
                experiment_id,
                result.generation,
                result.gene.id,
                json.dumps(result.gene.to_dict()),
                result.fitness,
                result.pareto.quality,
                result.pareto.cost_usd,
                result.pareto.latency_ms,
                now,
                json.dumps(result.parent_gene_ids),
                result.mutation_op,
            ),
        )
        for row in result.eval_rows:
            self._conn().execute(
                "INSERT INTO eval_rows "
                "(id, trial_id, row_index, input_json, output_text, score, "
                " score_reasoning, latency_ms, cost_usd) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    str(uuid.uuid4()),
                    trial_id,
                    row.row_index,
                    row.input_json,
                    row.output_text,
                    row.score,
                    row.score_reasoning,
                    row.latency_ms,
                    row.cost_usd,
                ),
            )
        self._conn().commit()

    def get_trial(self, experiment_id: str, trial_id: str) -> dict[str, Any] | None:
        row = (
            self._conn()
            .execute(
                "SELECT * FROM trials WHERE id = ? AND experiment_id = ?",
                (trial_id, experiment_id),
            )
            .fetchone()
        )
        return dict(row) if row else None

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

    def get_eval_rows(self, trial_id: str) -> list[dict[str, Any]]:
        rows = (
            self._conn()
            .execute(
                "SELECT * FROM eval_rows WHERE trial_id = ? ORDER BY row_index ASC",
                (trial_id,),
            )
            .fetchall()
        )
        return [dict(r) for r in rows]

    def list_trials_lineage(self, experiment_id: str) -> list[dict[str, Any]]:
        rows = (
            self._conn()
            .execute(
                "SELECT id, gene_id, generation, fitness, quality, cost_usd, latency_ms, "
                "       parent_gene_ids, mutation_op, created_at "
                "FROM trials WHERE experiment_id = ? ORDER BY generation ASC, created_at ASC",
                (experiment_id,),
            )
            .fetchall()
        )
        return [dict(r) for r in rows]
