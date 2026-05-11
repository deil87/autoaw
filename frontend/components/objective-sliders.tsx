"use client";
import React from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import type { ObjectiveWeights } from "@/lib/types";

interface Props {
  value: ObjectiveWeights;
  onChange: (weights: ObjectiveWeights) => void;
}

export function ObjectiveSliders({ value, onChange }: Props) {
  const set = (key: keyof ObjectiveWeights) => (vals: number | readonly number[]) => {
    const arr = Array.isArray(vals) ? (vals as readonly number[]) : [vals as number];
    const raw = arr[0] / 100;
    const rest = 1 - raw;
    const others = (["quality", "cost", "speed"] as const).filter((k) => k !== key);
    const sum = value[others[0]] + value[others[1]];
    const scale = sum > 0 ? rest / sum : 0.5;
    onChange({
      ...value,
      [key]: raw,
      [others[0]]: Math.round(value[others[0]] * scale * 100) / 100,
      [others[1]]: Math.round(value[others[1]] * scale * 100) / 100,
    });
  };

  return (
    <div className="space-y-4">
      {(["quality", "cost", "speed"] as const).map((key) => (
        <div key={key}>
          <div className="flex justify-between mb-1">
            <Label className="capitalize">{key}</Label>
            <span className="text-sm text-muted-foreground">{Math.round(value[key] * 100)}%</span>
          </div>
          <Slider
            min={0}
            max={100}
            step={5}
            value={[Math.round(value[key] * 100)]}
            onValueChange={set(key)}
          />
        </div>
      ))}
    </div>
  );
}
