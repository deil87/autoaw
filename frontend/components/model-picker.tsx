"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ModelDef {
  id: string;
  label: string;
  note?: string;       // RAM hint (open source) or provider name (cloud)
  quality?: string;    // quality descriptor vs gpt-4o-mini
}

const CLOUD_MODELS: ModelDef[] = [
  { id: "gpt-4o-mini",                    label: "GPT-4o mini",       note: "OpenAI" },
  { id: "gpt-4o",                          label: "GPT-4o",            note: "OpenAI" },
  { id: "gpt-4.1-nano",                    label: "GPT-4.1 nano",      note: "OpenAI" },
  { id: "gpt-4.1-mini",                    label: "GPT-4.1 mini",      note: "OpenAI" },
  { id: "claude-3-5-haiku-20241022",       label: "Claude 3.5 Haiku",  note: "Anthropic" },
  { id: "claude-3-5-sonnet-20241022",      label: "Claude 3.5 Sonnet", note: "Anthropic" },
  { id: "amazon.nova-micro-v1:0",          label: "Nova Micro",        note: "Bedrock" },
  { id: "amazon.nova-lite-v1:0",           label: "Nova Lite",         note: "Bedrock" },
  { id: "meta.llama3-1-8b-instruct-v1:0", label: "Llama 3.1 8B",      note: "Bedrock" },
  { id: "meta.llama3-2-3b-instruct-v1:0", label: "Llama 3.2 3B",      note: "Bedrock" },
  { id: "meta.llama3-2-1b-instruct-v1:0", label: "Llama 3.2 1B",      note: "Bedrock" },
];

const OPEN_SOURCE_MODELS: ModelDef[] = [
  // Ranked by multilingual + structured-output performance
  { id: "command-r",      label: "Command R",       note: "~20 GB",  quality: "best multilingual" },
  { id: "command-r-plus", label: "Command R+",      note: "~60 GB",  quality: "best multilingual" },
  { id: "mistral-nemo",   label: "Mistral Nemo 12B", note: "~7 GB",  quality: "≈ gpt-4o-mini" },
  { id: "llama3.1:8b",    label: "Llama 3.1 8B",    note: "~5 GB",  quality: "≈ gpt-4o-mini" },
  { id: "mistral:v0.3",   label: "Mistral 7B v0.3", note: "~4 GB",  quality: "slightly below" },
  { id: "mistral:latest", label: "Mistral 7B",      note: "~4 GB",  quality: "slightly below" },
  { id: "qwen2.5:7b",     label: "Qwen 2.5 7B",     note: "~4.5 GB", quality: "≈ gpt-4o-mini" },
  { id: "phi4-mini",      label: "Phi-4 mini",      note: "~2.5 GB", quality: "slightly below" },
  { id: "gemma3:4b",      label: "Gemma 3 4B",      note: "~3 GB",  quality: "slightly below" },
  { id: "llama3.2:3b",    label: "Llama 3.2 3B",    note: "~2 GB",  quality: "fast / cheap" },
  { id: "qwen2.5:3b",     label: "Qwen 2.5 3B",     note: "~2 GB",  quality: "fast / cheap" },
  { id: "gemma3:1b",      label: "Gemma 3 1B",      note: "~1 GB",  quality: "simple tasks" },
  { id: "llama3.2:1b",    label: "Llama 3.2 1B",    note: "~1.3 GB", quality: "simple tasks" },
  { id: "smollm2:1.7b",   label: "SmolLM2 1.7B",    note: "~1 GB",  quality: "simple tasks" },
];

type Tab = "cloud" | "opensource";

interface ModelPickerProps {
  value: string[];
  onChange: (models: string[]) => void;
}

function QualityBadge({ quality }: { quality: string }) {
  const color =
    quality.startsWith("≈")
      ? "text-green-600 bg-green-50 border-green-200"
      : quality.startsWith("slightly")
      ? "text-yellow-600 bg-yellow-50 border-yellow-200"
      : "text-muted-foreground bg-muted/50 border-border";
  return (
    <span className={cn("text-xs border rounded px-1.5 py-0.5 shrink-0", color)}>
      {quality}
    </span>
  );
}

function ModelToggle({
  model,
  selected,
  onToggle,
  showQuality,
}: {
  model: ModelDef;
  selected: boolean;
  onToggle: () => void;
  showQuality?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors w-full",
        selected
          ? "border-primary bg-primary/5 text-foreground"
          : "border-border hover:bg-accent text-muted-foreground hover:text-foreground"
      )}
    >
      <span className="font-medium flex-1 min-w-0">{model.label}</span>
      {showQuality && model.quality && <QualityBadge quality={model.quality} />}
      {model.note && (
        <span className="text-xs text-muted-foreground shrink-0 font-mono">{model.note}</span>
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
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Auto-pulled when you start an experiment. Requires{" "}
            <a
              href="https://ollama.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Ollama
            </a>{" "}
            running locally (<code className="bg-muted px-1 rounded text-xs">ollama serve</code>).
          </p>
          <div className="flex gap-3 px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <span className="flex-1">Model</span>
            <span className="w-28 text-right">vs gpt-4o-mini</span>
            <span className="w-14 text-right">RAM</span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {models.map((m) => (
          <ModelToggle
            key={m.id}
            model={m}
            selected={value.includes(m.id)}
            onToggle={() => toggle(m.id)}
            showQuality={tab === "opensource"}
          />
        ))}
      </div>

      <div className="text-xs text-muted-foreground">
        {selectedCount} model{selectedCount !== 1 ? "s" : ""} selected for evolution.
        {value.length > 0 && (
          <span className="flex flex-wrap gap-1 mt-1">
            {value.map((id) => (
              <Badge key={id} variant="secondary" className="text-xs font-normal">
                {id}
              </Badge>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
