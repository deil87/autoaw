import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExperimentForm } from "@/components/experiment-form";

// Mock api
vi.mock("@/lib/api", () => ({
  api: {
    datasets: {
      list: () => Promise.resolve([{ dataset_id: "workbench" }]),
    },
    experiments: {
      create: vi.fn().mockResolvedValue({ id: "exp_123" }),
    },
  },
}));

// Mock router
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("ExperimentForm — WorkBench pre-fill", () => {
  it("submits runner_type when set via initialValues", async () => {
    const { api } = await import("@/lib/api");

    render(
      <ExperimentForm
        initialValues={{
          name: "WorkBench Run",
          dataset_id: "workbench",
          runner_type: "workbench",
          task_description: "Workplace tasks",
        }}
      />
    );

    const submitBtn = screen.getByRole("button", { name: /create/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.experiments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          runner_type: "workbench",
          dataset_id: "workbench",
        })
      );
    });
  });
});
