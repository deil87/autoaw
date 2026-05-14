import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BenchmarkCard } from "@/components/benchmark-card";
import type { BenchmarkDescriptor } from "@/lib/types";

const wb: BenchmarkDescriptor = {
  id: "workbench",
  name: "WorkBench",
  description: "690 workplace tasks.",
  paper_url: "https://arxiv.org/abs/2405.00823",
  dataset_id: "workbench",
  runner_type: "workbench",
  evaluators: [],
  default_objective: { quality_weight: 0.7, cost_weight: 0.2, speed_weight: 0.1 },
  task_count: 690,
};

describe("BenchmarkCard", () => {
  it("renders name and task count", () => {
    render(<BenchmarkCard benchmark={wb} onSelect={vi.fn()} />);
    expect(screen.getByText("WorkBench")).toBeDefined();
    expect(screen.getAllByText(/690/).length).toBeGreaterThan(0);
  });

  it("calls onSelect with the benchmark when button clicked", () => {
    const onSelect = vi.fn();
    render(<BenchmarkCard benchmark={wb} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith(wb);
  });
});
