"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { EvaluatorTypeDescriptor, EvaluatorConfig } from "@/lib/types";

const CATEGORY_LABELS: Record<string, string> = {
  built_in: "Built-in",
  deepeval: "DeepEval",
  ragas: "RAGAS",
};

interface EvaluatorPickerProps {
  catalog: EvaluatorTypeDescriptor[];
  onAdd: (evaluator: EvaluatorConfig) => void;
}

export function EvaluatorPicker({ catalog, onAdd }: EvaluatorPickerProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (descriptor: EvaluatorTypeDescriptor) => {
    const params: Record<string, unknown> = {};
    for (const p of descriptor.params) {
      params[p.name] = p.default;
    }
    onAdd({ type: descriptor.type, params });
    setOpen(false);
  };

  const categories = ["built_in", "deepeval", "ragas"] as const;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" />}>
        + Add Evaluator
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start">
        <div className="space-y-3">
          {categories.map((cat) => {
            const entries = catalog.filter((e) => e.category === cat);
            if (entries.length === 0) return null;
            return (
              <div key={cat}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  {CATEGORY_LABELS[cat]}
                </p>
                <div className="space-y-1">
                  {entries.map((descriptor) => (
                    <button
                      key={descriptor.type}
                      type="button"
                      onClick={() => handleSelect(descriptor)}
                      className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent text-sm"
                    >
                      <div className="font-medium">{descriptor.name}</div>
                      <div className="text-xs text-muted-foreground line-clamp-1">
                        {descriptor.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {catalog.length === 0 && (
            <p className="text-sm text-muted-foreground">Loading catalog...</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
