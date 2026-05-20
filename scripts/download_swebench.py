#!/usr/bin/env python3
"""Download SWE-bench Lite and write datasets/swebench.json.

Source: princeton-nlp/SWE-bench_Lite on HuggingFace (300 tasks from real
Python repositories with ground-truth patches and failing test references).

Usage:
    python scripts/download_swebench.py [--force] [--output PATH] [--split SPLIT]

Options:
    --force         Overwrite existing file if present.
    --output PATH   Output path (default: datasets/swebench.json).
    --split SPLIT   HuggingFace split to download: test (default) | dev | train.

Output format (AutoAW dataset schema):
    [
      {
        "id":    "<instance_id>",
        "input": "Repository: <repo>\\n\\nProblem:\\n<problem_statement>",
        "expected": "<ground_truth_patch>",
        "swebench_meta": {
          "instance_id": "...",
          "repo": "...",
          "base_commit": "...",
          "fail_to_pass": [...],
          "pass_to_pass": [...]
        }
      },
      ...
    ]
"""

from __future__ import annotations
import argparse
import json
import os
import sys

_HF_DATASET = "princeton-nlp/SWE-bench_Lite"


def _normalise(row: dict) -> dict:
    instance_id = row.get("instance_id", "")
    repo = row.get("repo", "")
    problem = row.get("problem_statement", "").strip()
    patch = row.get("patch", "").strip()

    fail_to_pass = row.get("FAIL_TO_PASS", row.get("fail_to_pass", []))
    pass_to_pass = row.get("PASS_TO_PASS", row.get("pass_to_pass", []))
    if isinstance(fail_to_pass, str):
        try:
            fail_to_pass = json.loads(fail_to_pass)
        except Exception:
            fail_to_pass = []
    if isinstance(pass_to_pass, str):
        try:
            pass_to_pass = json.loads(pass_to_pass)
        except Exception:
            pass_to_pass = []

    task_input = f"Repository: {repo}\n\nProblem:\n{problem}"

    return {
        "id": instance_id,
        "input": task_input,
        "expected": patch,
        "swebench_meta": {
            "instance_id": instance_id,
            "repo": repo,
            "base_commit": row.get("base_commit", ""),
            "fail_to_pass": fail_to_pass,
            "pass_to_pass": pass_to_pass,
        },
    }


def _load_from_hf(split: str) -> list[dict]:
    from datasets import load_dataset  # type: ignore

    print(f"Downloading {_HF_DATASET} (split={split}) from HuggingFace…")
    ds = load_dataset(_HF_DATASET, split=split)
    print(f"  Downloaded {len(ds)} rows. Fields: {list(ds[0].keys())}")
    return [_normalise(dict(row)) for row in ds]


def main() -> None:
    parser = argparse.ArgumentParser(description="Download SWE-bench Lite dataset")
    parser.add_argument("--force", action="store_true", help="Overwrite if file exists")
    parser.add_argument(
        "--output",
        default=os.path.join("datasets", "swebench.json"),
        help="Output path (default: datasets/swebench.json)",
    )
    parser.add_argument(
        "--split",
        default="test",
        choices=["test", "dev", "train"],
        help="HuggingFace split to download (default: test)",
    )
    args = parser.parse_args()

    if os.path.exists(args.output) and not args.force:
        print(f"File already exists: {args.output}  (pass --force to overwrite)")
        sys.exit(0)

    try:
        records = _load_from_hf(args.split)
    except ImportError:
        print(
            "ERROR: 'datasets' package not found.\n"
            "Install it with:  pip install datasets\n"
            "Then re-run this script."
        )
        sys.exit(1)
    except Exception as exc:
        print(f"ERROR: Could not download {_HF_DATASET}: {exc}")
        sys.exit(1)

    if not records:
        print("ERROR: No records downloaded. Check the dataset name and split.")
        sys.exit(1)

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(records)} records to {args.output}")


if __name__ == "__main__":
    main()
