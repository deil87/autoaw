def test_on_progress_callback_fires():
    """on_progress is called with row progress every HEARTBEAT_INTERVAL rows."""
    from unittest.mock import MagicMock
    from backend.engine.gp.loop import GPLoop
    from backend.shared.experiment import ExperimentConfig, ObjectiveWeights

    config = ExperimentConfig(
        name="t",
        task_description="t",
        dataset_id="d",
        evaluators=[],
        objective_weights=ObjectiveWeights(0.7, 0.2, 0.1),
        population_size=1,
        convergence_patience=1,
        concurrency=1,
    )

    # Dataset of 25 rows — heartbeat every 10 rows → fires at rows_done=10, rows_done=20
    dataset = [{"input": f"q{i}", "expected": "a"} for i in range(25)]

    runner = MagicMock()
    runner.run.return_value = MagicMock(
        output="out", token_usage={}, latency_ms=10, cost_usd=0.001
    )

    evaluator = MagicMock()
    evaluator.score.return_value = MagicMock(quality=0.8, metadata={})

    progress_calls = []

    loop = GPLoop(
        config=config,
        runner=runner,
        evaluators=[evaluator],
        dataset=dataset,
        on_progress=lambda p: progress_calls.append(dict(p)),
    )

    from backend.shared.gene import Gene

    gene = MagicMock(spec=Gene)
    gene.id = "g001"
    loop._evaluate_gene(gene, generation=1)

    # Should have fired at rows_done=10 and rows_done=20
    assert len(progress_calls) == 2
    assert progress_calls[0]["rows_done"] == 10
    assert progress_calls[0]["rows_total"] == 25
    assert progress_calls[0]["generation"] == 1
    assert progress_calls[0]["phase"] == "gp"
    assert progress_calls[1]["rows_done"] == 20
