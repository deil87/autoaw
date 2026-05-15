"""Mangum adapter — wraps the FastAPI app for AWS Lambda."""
from __future__ import annotations

import os

# Switch store backend to DynamoDB when running in Lambda
os.environ.setdefault("STORE_BACKEND", "dynamo")

from mangum import Mangum  # noqa: E402
from backend.api.app import app  # noqa: E402

handler = Mangum(app, lifespan="off")
