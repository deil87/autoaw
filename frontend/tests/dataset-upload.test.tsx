import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DatasetUpload } from "@/components/dataset-upload";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    datasets: {
      upload: vi.fn(),
    },
  },
}));

describe("DatasetUpload", () => {
  const onUploaded = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls onUploaded with dataset_id and records on success", async () => {
    vi.mocked(api.datasets.upload).mockResolvedValue({ dataset_id: "myds", records: 5 });

    render(<DatasetUpload onUploaded={onUploaded} />);

    const file = new File(['[{"input":"a","expected":"b"}]'], "myds.json", {
      type: "application/json",
    });
    const input = screen.getByLabelText("JSON file");
    fireEvent.change(input, { target: { files: [file] } });

    fireEvent.click(screen.getByRole("button", { name: /upload/i }));

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith("myds", 5));
    expect(screen.queryByText(/failed/i)).toBeNull();
  });

  it("shows error message on upload failure", async () => {
    vi.mocked(api.datasets.upload).mockRejectedValue(new Error("Dataset must be a JSON array"));

    render(<DatasetUpload onUploaded={onUploaded} />);

    const file = new File(["not-an-array"], "bad.json", { type: "application/json" });
    const input = screen.getByLabelText("JSON file");
    fireEvent.change(input, { target: { files: [file] } });

    fireEvent.click(screen.getByRole("button", { name: /upload/i }));

    await waitFor(() =>
      expect(screen.getByText("Dataset must be a JSON array")).toBeTruthy()
    );
    expect(onUploaded).not.toHaveBeenCalled();
  });
});
