"use client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { EvaluatorConfig, EvaluatorTypeDescriptor, EvaluatorParamSpec } from "@/lib/types";

interface ParamEditorProps {
  spec: EvaluatorParamSpec;
  value: unknown;
  onChange: (val: unknown) => void;
}

function ParamEditor({ spec, value, onChange }: ParamEditorProps) {
  const strVal = String(value ?? spec.default ?? "");

  if (spec.type === "select") {
    return (
      <Select value={strVal} onValueChange={(v) => onChange(v)}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(spec.options ?? []).map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (spec.type === "textarea") {
    return (
      <Textarea
        className="text-sm"
        rows={3}
        value={strVal}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (spec.type === "number") {
    return (
      <Input
        type="number"
        className="h-8 text-sm"
        value={strVal}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    );
  }

  // default: string
  return (
    <Input
      className="h-8 text-sm"
      value={strVal}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

interface EvaluatorListProps {
  evaluators: EvaluatorConfig[];
  catalog: EvaluatorTypeDescriptor[];
  onChange: (evaluators: EvaluatorConfig[]) => void;
}

export function EvaluatorList({ evaluators, catalog, onChange }: EvaluatorListProps) {
  const descriptorMap = Object.fromEntries(catalog.map((e) => [e.type, e]));

  if (evaluators.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No evaluators added. Click &apos;+ Add Evaluator&apos; to choose from the catalog.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {evaluators.map((ev, index) => {
        const descriptor = descriptorMap[ev.type];
        const displayName = descriptor?.name ?? ev.type;
        const params = descriptor?.params ?? [];

        const handleParamChange = (paramName: string, val: unknown) => {
          onChange(
            evaluators.map((e, i) =>
              i === index ? { ...e, params: { ...e.params, [paramName]: val } } : e
            )
          );
        };

        const handleRemove = () => {
          onChange(evaluators.filter((_, i) => i !== index));
        };

        return (
          <div key={index} className="border rounded-md p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{displayName}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={handleRemove}
              >
                Remove
              </Button>
            </div>
            {params.length > 0 && (
              <div className="space-y-2">
                {params.map((spec) => (
                  <div key={spec.name}>
                    <Label className="text-xs mb-1 block">
                      {spec.label}
                      {spec.required && <span className="text-destructive ml-0.5">*</span>}
                    </Label>
                    {spec.description && (
                      <p className="text-xs text-muted-foreground mb-1">{spec.description}</p>
                    )}
                    <ParamEditor
                      spec={spec}
                      value={ev.params[spec.name]}
                      onChange={(val) => handleParamChange(spec.name, val)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
