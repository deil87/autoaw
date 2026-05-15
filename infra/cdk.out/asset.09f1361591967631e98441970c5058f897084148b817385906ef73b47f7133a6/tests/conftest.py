"""
Ensure backend.api.app is never imported against the real autoaw.db.

Sets DATABASE_PATH before any import of the app module so module-level
globals resolve to the test database, not the production autoaw.db.
"""

import os
import sys
import pytest


@pytest.fixture(autouse=True)
def _isolate_app_db(tmp_path):
    """Point DATABASE_PATH at an isolated per-test DB before app.py is imported."""
    db_path = str(tmp_path / "test_isolated.db")
    old = os.environ.get("DATABASE_PATH")
    os.environ["DATABASE_PATH"] = db_path

    yield

    if old is None:
        os.environ.pop("DATABASE_PATH", None)
    else:
        os.environ["DATABASE_PATH"] = old
