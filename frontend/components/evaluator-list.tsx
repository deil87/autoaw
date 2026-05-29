"use client";
import { useState } from "react";
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
import { Wand2, Loader2, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import type { EvaluatorConfig, EvaluatorTypeDescriptor, EvaluatorParamSpec } from "@/lib/types";

// ── RubricEditor ─────────────────────────────────────────────────────────────

function RubricEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [mode, setMode] = useState<"json" | "import">("json");
  const [importText, setImportText] = useState("");
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState<{ rubric_json: string; dimensions: string[]; notes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleParse() {
    if (!importText.trim()) return;
    setLoading(true);
    setError(null);
    setParsed(null);
    try {
      const result = await api.rubric.parse(importText);
      setParsed(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Parse failed");
    } finally {
      setLoading(false);
    }
  }

  function handleUse() {
    if (!parsed) return;
    onChange(parsed.rubric_json);
    setMode("json");
    setParsed(null);
    setImportText("");
  }

  if (mode === "import") {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Paste rubric text, CSV, or table</span>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground underline"
            onClick={() => { setMode("json"); setError(null); setParsed(null); }}
          >
            ← Back to JSON
          </button>
        </div>
        <Textarea
          className="text-sm font-mono"
          rows={8}
          placeholder={"Criteria,4 - Excellent,3 - Good,2 - Developing,1 - Poor\n1. Accuracy,\"All facts are correct\",\"Minor errors\",\"Several errors\",\"Mostly wrong\""}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="gap-1.5"
          disabled={loading || !importText.trim()}
          onClick={handleParse}
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
          {loading ? "Parsing…" : "Parse with AI"}
        </Button>
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
        {parsed && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
              <CheckCircle2 size={13} />
              Parsed {parsed.dimensions.length} dimension{parsed.dimensions.length !== 1 ? "s" : ""}: {parsed.dimensions.join(", ")}
            </div>
            {parsed.notes.length > 0 && (
              <p className="text-xs text-muted-foreground">{parsed.notes.join(" ")}</p>
            )}
            <pre className="text-xs bg-background rounded border p-2 overflow-auto max-h-40 whitespace-pre-wrap">{parsed.rubric_json}</pre>
            <Button type="button" size="sm" onClick={handleUse} className="gap-1.5">
              <CheckCircle2 size={13} />
              Use this rubric
            </Button>
          </div>
        )}
      </div>
    );
  }

  // JSON mode (default)
  return (
    <div className="space-y-1">
      <Textarea
        className="text-sm font-mono"
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setMode("import")}
      >
        <Wand2 size={11} />
        Import from text or table…
      </button>
    </div>
  );
}

// ── ParamEditor ───────────────────────────────────────────────────────────────

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
    if (spec.name === "rubric") {
      return <RubricEditor value={strVal} onChange={(v) => onChange(v)} />;
    }
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
