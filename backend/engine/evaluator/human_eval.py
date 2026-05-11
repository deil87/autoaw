from __future__ import annotations
import time
import uuid
import boto3
from backend.shared.results import Score
from backend.engine.evaluator.base import Evaluator


class HumanEvaluator(Evaluator):
    """Queues a rating task to DynamoDB and blocks until a human rates it."""

    def __init__(
        self,
        table_name: str,
        poll_interval_sec: float = 5.0,
        timeout_sec: float = 3600.0,
    ) -> None:
        self.table_name = table_name
        self.poll_interval_sec = poll_interval_sec
        self.timeout_sec = timeout_sec
        self._dynamo = boto3.resource("dynamodb")

    def score(self, input: str, output: str, expected: str | None) -> Score:
        table = self._dynamo.Table(self.table_name)
        task_id = f"human_{uuid.uuid4().hex[:8]}"
        table.put_item(
            Item={
                "pk": task_id,
                "sk": "human_rating",
                "status": "pending",
                "input": input,
                "output": output,
                "expected": expected or "",
            }
        )

        deadline = time.monotonic() + self.timeout_sec
        while time.monotonic() < deadline:
            resp = table.get_item(Key={"pk": task_id, "sk": "human_rating"})
            item = resp.get("Item", {})
            if item.get("status") == "rated":
                quality = max(0.0, min(1.0, float(item["quality"])))
                return Score(
                    quality=quality,
                    metadata={"task_id": task_id, "comment": item.get("comment", "")},
                )
            time.sleep(self.poll_interval_sec)

        return Score(quality=0.0, metadata={"task_id": task_id, "error": "timeout"})
