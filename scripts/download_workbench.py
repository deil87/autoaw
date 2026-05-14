#!/usr/bin/env python3
"""Download the WorkBench dataset and write datasets/workbench.json.

Sources tried (in order):
  1. HuggingFace dataset hub (olly-styles/WorkBench, mindsdb/WorkBench, …)
  2. GitHub raw CSV files from https://github.com/olly-styles/WorkBench

Usage:
    python scripts/download_workbench.py [--force] [--output PATH]

Options:
    --force     Overwrite existing file if present.
    --output    Output path (default: datasets/workbench.json).
"""

from __future__ import annotations
import argparse
import csv
import io
import json
import os
import sys
import urllib.request


# GitHub raw base URL for the WorkBench data directory
_GITHUB_RAW = "https://raw.githubusercontent.com/olly-styles/WorkBench/main/data"

# All task CSV files in the repo (one per domain)
_GITHUB_TASK_FILES = [
    "analytics_queries_and_answers.csv",
    "calendar_queries_and_answers.csv",
    "customer_relationship_manager_queries_and_answers.csv",
    "email_queries_and_answers.csv",
    "multi_domain_queries_and_answers.csv",
    "project_management_queries_and_answers.csv",
]


def _load_from_github() -> list[dict]:
    """Download task CSVs from GitHub and return normalised records."""
    print("Falling back to GitHub (olly-styles/WorkBench)…")
    records: list[dict] = []
    idx = 0
    for fname in _GITHUB_TASK_FILES:
        url = f"{_GITHUB_RAW}/processed/queries_and_answers/{fname}"
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                content = resp.read().decode("utf-8")
        except Exception as exc:
            print(f"  WARNING: could not fetch {fname}: {exc}")
            continue

        reader = csv.DictReader(io.StringIO(content))
        domain = fname.replace("_tasks.csv", "")
        for row in reader:
            task_input = row.get("query") or row.get("task") or row.get("input") or ""
            expected_raw = (
                row.get("answer")
                or row.get("actions")
                or row.get("expected_actions")
                or "[]"
            )
            try:
                expected_actions = json.loads(expected_raw)
            except Exception:
                expected_actions = expected_raw

            records.append(
                {
                    "id": f"wb_{idx:04d}",
                    "input": task_input,
                    "expected": json.dumps(expected_actions)
                    if not isinstance(expected_actions, str)
                    else expected_actions,
                    "workbench_meta": {
                        "expected_actions": expected_actions,
                        "category": domain,
                        "difficulty": row.get("difficulty", ""),
                        "original_row": {k: v for k, v in row.items()},
                    },
                }
            )
            idx += 1
        print(f"  {domain}: {len(list(csv.DictReader(io.StringIO(content))))} tasks")

    return records


def main() -> None:
    parser = argparse.ArgumentParser(description="Download WorkBench dataset")
    parser.add_argument("--force", action="store_true", help="Overwrite if file exists")
    parser.add_argument(
        "--output",
        default=os.path.join("datasets", "workbench.json"),
        help="Output path (default: datasets/workbench.json)",
    )
    args = parser.parse_args()

    if os.path.exists(args.output) and not args.force:
        print(f"File already exists: {args.output}  (pass --force to overwrite)")
        sys.exit(0)

    # --- Try HuggingFace first ---
    try:
        from datasets import load_dataset  # type: ignore

        hf_available = True
    except ImportError:
        hf_available = False

    ds = None
    if hf_available:
        print("Downloading olly-styles/WorkBench from HuggingFace…")
        candidates = [
            "olly-styles/WorkBench",
            "mindsdb/WorkBench",
            "WorkBench/WorkBench",
        ]
        for slug in candidates:
            try:
                ds = load_dataset(slug, split="train")
                print(f"Loaded from: {slug}")
                break
            except Exception as exc:
                print(f"  {slug}: {exc}")

    if ds is None:
        # HuggingFace failed — fetch from GitHub
        records = _load_from_github()
        if not records:
            print(
                "\nERROR: Could not download WorkBench from HuggingFace or GitHub.\n"
                f"Place the dataset manually at {args.output!r} in AutoAW format:\n"
                '  [{"id": "wb_0001", "input": "...", "expected": "[{...}]", '
                '"workbench_meta": {...}}]'
            )
            sys.exit(1)
    else:
        # Normalise HuggingFace rows
        first_row = ds[0]
        print(f"Dataset fields: {list(first_row.keys())}")
        records = []
        for i, row in enumerate(ds):
            task_input = (
                row.get("task")
                or row.get("input")
                or row.get("instruction")
                or row.get("prompt")
                or ""
            )
            expected_actions = (
                row.get("actions")
                or row.get("expected_actions")
                or row.get("solution")
                or []
            )
            if isinstance(expected_actions, str):
                try:
                    expected_actions = json.loads(expected_actions)
                except Exception:
                    expected_actions = []

            category = row.get("category") or row.get("type") or ""
            difficulty = row.get("difficulty") or ""
            records.append(
                {
                    "id": f"wb_{i:04d}",
                    "input": task_input,
                    "expected": json.dumps(expected_actions),
                    "workbench_meta": {
                        "expected_actions": expected_actions,
                        "category": category,
                        "difficulty": difficulty,
                        "original_row": {
                            k: v
                            for k, v in row.items()
                            if k
                            not in (
                                "task",
                                "input",
                                "instruction",
                                "actions",
                                "expected_actions",
                                "solution",
                            )
                        },
                    },
                }
            )

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(records)} records to {args.output}")


if __name__ == "__main__":
    main()
