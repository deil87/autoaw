"""Dataset storage abstraction — local filesystem or S3.

When the DATASETS_BUCKET env var is set (production), all reads and writes go
to S3.  Otherwise they hit the local DATASETS_DIR directory (dev / CI).
"""
from __future__ import annotations
import json
import os
from typing import Any


def _bucket() -> str:
    return os.environ.get("DATASETS_BUCKET", "")


def _datasets_dir() -> str:
    return os.environ.get("DATASETS_DIR", "datasets")


def _s3():
    import boto3
    return boto3.client("s3")


# ── Public API ────────────────────────────────────────────────────────────────


def load_dataset(dataset_id: str) -> list[dict[str, Any]]:
    """Return the dataset as a list of row dicts. Raises FileNotFoundError if missing."""
    bucket = _bucket()
    if bucket:
        obj = _s3().get_object(Bucket=bucket, Key=f"{dataset_id}.json")
        return json.loads(obj["Body"].read())

    path = os.path.join(_datasets_dir(), f"{dataset_id}.json")
    if not os.path.exists(path):
        raise FileNotFoundError(f"Dataset {dataset_id!r} not found at {path}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_dataset(dataset_id: str, content: bytes) -> None:
    """Persist raw JSON bytes for a dataset."""
    bucket = _bucket()
    if bucket:
        _s3().put_object(Bucket=bucket, Key=f"{dataset_id}.json", Body=content, ContentType="application/json")
        return

    dest_dir = _datasets_dir()
    os.makedirs(dest_dir, exist_ok=True)
    path = os.path.join(dest_dir, f"{dataset_id}.json")
    with open(path, "wb") as f:
        f.write(content)


def list_dataset_ids() -> list[str]:
    """Return sorted list of available dataset IDs."""
    bucket = _bucket()
    if bucket:
        s3 = _s3()
        ids: list[str] = []
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket):
            for obj in page.get("Contents", []):
                key: str = obj["Key"]
                if key.endswith(".json"):
                    ids.append(key[: -len(".json")])
        return sorted(ids)

    dest_dir = _datasets_dir()
    os.makedirs(dest_dir, exist_ok=True)
    return sorted(
        os.path.splitext(f)[0]
        for f in os.listdir(dest_dir)
        if f.endswith(".json")
    )


def dataset_exists(dataset_id: str) -> bool:
    """Return True if the dataset is available in the configured store."""
    bucket = _bucket()
    if bucket:
        import botocore.exceptions
        try:
            _s3().head_object(Bucket=bucket, Key=f"{dataset_id}.json")
            return True
        except botocore.exceptions.ClientError:
            return False

    return os.path.exists(os.path.join(_datasets_dir(), f"{dataset_id}.json"))
