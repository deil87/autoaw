"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ModelDef {
  id: string;
  label: string;
  note?: string; // e.g. RAM hint for local models
}

const CLOUD_MODELS: ModelDef[] = [
  { id: "gpt-4o-mini", label: "GPT-4o mini", note: "OpenAI" },
  { id: "gpt-4o", label: "GPT-4o", note: "OpenAI" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 nano", note: "OpenAI" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", note: "OpenAI" },
  { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", note: "Anthropic" },
  { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", note: "Anthropic" },
  { id: "amazon.nova-micro-v1:0", label: "Nova Micro", note: "AWS Bedrock" },
  { id: "amazon.nova-lite-v1:0", label: "Nova Lite", note: "AWS Bedrock" },
  { id: "meta.llama3-1-8b-instruct-v1:0", label: "Llama 3.1 8B", note: "AWS Bedrock" },
  { id: "meta.llama3-2-3b-instruct-v1:0", label: "Llama 3.2 3B", note: "AWS Bedrock" },
  { id: "meta.llama3-2-1b-instruct-v1:0", label: "Llama 3.2 1B", note: "AWS Bedrock" },
];

const OPEN_SOURCE_MODELS: ModelDef[] = [
  { id: "llama3.1:8b", label: "Llama 3.1 8B", note: "~5 GB" },
  { id: "llama3.2:3b", label: "Llama 3.2 3B", note: "~2 GB" },
  { id: "llama3.2:1b", label: "Llama 3.2 1B", note: "~1.3 GB" },
  { id: "qwen2.5:7b", label: "Qwen 2.5 7B", note: "~4.5 GB" },
  { id: "qwen2.5:3b", label: "Qwen 2.5 3B", note: "~2 GB" },
  { id: "phi4-mini", label: "Phi-4 mini", note: "~2.5 GB" },
  { id: "gemma3:4b", label: "Gemma 3 4B", note: "~3 GB" },
  { id: "gemma3:1b", label: "Gemma 3 1B", note: "~1 GB" },
  { id: "mistral:7b", label: "Mistral 7B", note: "~4 GB" },
  { id: "smollm2:1.7b", label: "SmolLM2 1.7B", note: "~1 GB" },
];

type Tab = "cloud" | "opensource";

interface ModelPickerProps {
  value: string[];
  onChange: (models: string[]) => void;
}

function ModelToggle({
  model,
  selected,
  onToggle,
}: {
  model: ModelDef;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors w-full",
        selected
          ? "border-primary bg-primary/5 text-foreground"
          : "border-border hover:bg-accent text-muted-foreground hover:text-foreground"
      )}
    >
      <span className="font-medium">{model.label}</span>
      {model.note && (
        <span className="text-xs text-muted-foreground shrink-0">{model.note}</span>
      )}
    </button>
  );
}

export function ModelPicker({ value, onChange }: ModelPickerProps) {
  const [tab, setTab] = useState<Tab>("cloud");

  const toggle = (id: string) => {
    if (value.includes(id)) {
      // Keep at least one model selected
      if (value.length > 1) onChange(value.filter((m) => m !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const models = tab === "cloud" ? CLOUD_MODELS : OPEN_SOURCE_MODELS;
  const selectedCount = value.length;

  return (
    <div className="space-y-3">
      {/* Tab switcher */}
      <div className="flex gap-1 rounded-md border p-1 bg-muted/40 w-fit">
        {(["cloud", "opensource"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded px-3 py-1 text-sm font-medium transition-colors",
              tab === t
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "cloud" ? "☁️ Cloud" : "🦙 Open Source"}
          </button>
        ))}
      </div>

      {tab === "opensource" && (
        <p className="text-xs text-muted-foreground">
          Requires{" "}
          <a
            href="https://ollama.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Ollama
          </a>{" "}
          running locally. Pull a model first:{" "}
          <code className="bg-muted px-1 rounded text-xs">ollama pull llama3.1:8b</code>
        </p>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        {models.map((m) => (
          <ModelToggle
            key={m.id}
            model={m}
            selected={value.includes(m.id)}
            onToggle={() => toggle(m.id)}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {selectedCount} model{selectedCount !== 1 ? "s" : ""} selected for evolution.{" "}
        {value.length > 0 && (
          <span className="flex flex-wrap gap-1 mt-1">
            {value.map((id) => (
              <Badge key={id} variant="secondary" className="text-xs font-normal">
                {id}
              </Badge>
            ))}
          </span>
        )}
      </p>
    </div>
  );
}
