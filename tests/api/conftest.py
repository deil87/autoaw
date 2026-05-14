"""
Set DATABASE_PATH to a safe temp path before backend.api.app is imported
at module collection time (e.g. tests that create a module-level TestClient).
"""

import os
import tempfile

# Use a single temp file for the whole test session — safe because these tests
# don't write experiments, they only read catalog/evaluator data.
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ.setdefault("DATABASE_PATH", _tmp.name)
