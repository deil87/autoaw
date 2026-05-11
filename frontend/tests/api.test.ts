import { describe, it, expect } from "vitest";
import type { Experiment, Trial, Gene, ObjectiveWeights } from "@/lib/types";

describe("types", () => {
  it("ObjectiveWeights shape is correct", () => {
    const w: ObjectiveWeights = { quality: 0.6, cost: 0.2, speed: 0.2 };
    expect(w.quality + w.cost + w.speed).toBeCloseTo(1.0);
  });

  it("Gene has required fields", () => {
    const gene: Gene = {
      id: "gene_001",
      topology: "fixed_pipeline",
      agents: [],
      edges: [],
      topology_params: {},
    };
    expect(gene.topology).toBe("fixed_pipeline");
  });
});
