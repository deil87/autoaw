#!/usr/bin/env python3
"""Download the WorkBench dataset from HuggingFace and write datasets/workbench.json.

Usage:
    python scripts/download_workbench.py [--force] [--output PATH]

Options:
    --force     Overwrite existing file if present.
    --output    Output path (default: datasets/workbench.json).
"""

from __future__ import annotations
import argparse
import json
import os
import sys


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

    try:
        from datasets import load_dataset  # type: ignore
    except ImportError:
        print("ERROR: 'datasets' library not installed. Run: pip install datasets")
        sys.exit(1)

    print("Downloading olly-styles/WorkBench from HuggingFace…")
    # Try known dataset slugs; the canonical repo may require HF login
    candidates = [
        "olly-styles/WorkBench",
        "mindsdb/WorkBench",
        "WorkBench/WorkBench",
    ]
    ds = None
    for slug in candidates:
        try:
            ds = load_dataset(slug, split="train")
            print(f"Loaded from: {slug}")
            break
        except Exception as exc:
            print(f"  {slug}: {exc}")

    if ds is None:
        print(
            "\nERROR: Could not load WorkBench from HuggingFace.\n"
            "If the dataset requires authentication, run:\n"
            "  huggingface-cli login\n"
            "and try again. Alternatively, download the dataset manually and\n"
            f"place it at {args.output!r} in the AutoAW dataset format:\n"
            '  [{"id": "wb_0001", "input": "...", "expected": "[{...}]", '
            '"workbench_meta": {...}}]'
        )
        sys.exit(1)

    # Inspect first row to understand field names
    first_row = ds[0]
    print(f"Dataset fields: {list(first_row.keys())}")

    records = []
    for i, row in enumerate(ds):
        # WorkBench field names (adapt if schema differs — check first_row above)
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
        # Normalise: expected_actions may be a list of dicts or a JSON string
        if isinstance(expected_actions, str):
            try:
                expected_actions = json.loads(expected_actions)
            except Exception:
                expected_actions = []

        category = row.get("category") or row.get("type") or ""
        difficulty = row.get("difficulty") or ""

        expected_str = json.dumps(expected_actions)

        records.append(
            {
                "id": f"wb_{i:04d}",
                "input": task_input,
                "expected": expected_str,
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
