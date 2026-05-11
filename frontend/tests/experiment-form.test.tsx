import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ObjectiveSliders } from "@/components/objective-sliders";

describe("ObjectiveSliders", () => {
  it("renders three sliders", () => {
    const onChange = vi.fn();
    render(
      <ObjectiveSliders
        value={{ quality: 0.6, cost: 0.2, speed: 0.2 }}
        onChange={onChange}
      />
    );
    expect(screen.getByText(/quality/i)).toBeInTheDocument();
    expect(screen.getByText(/cost/i)).toBeInTheDocument();
    expect(screen.getByText(/speed/i)).toBeInTheDocument();
  });
});
