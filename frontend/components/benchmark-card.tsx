"use client";
import { Button } from "@/components/ui/button";
import type { BenchmarkDescriptor } from "@/lib/types";

interface BenchmarkCardProps {
  benchmark: BenchmarkDescriptor;
  onSelect: (b: BenchmarkDescriptor) => void;
  comingSoon?: boolean;
}

export function BenchmarkCard({ benchmark, onSelect, comingSoon }: BenchmarkCardProps) {
  return (
    <div className={`border rounded-lg p-4 space-y-2 bg-card${comingSoon ? " opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-base">{benchmark.name}</h3>
          <p className="text-sm text-muted-foreground">{benchmark.description}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {benchmark.task_count} tasks &middot;{" "}
            <a
              href={benchmark.paper_url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              paper
            </a>
          </p>
        </div>
        {comingSoon ? (
          <span className="text-xs font-medium px-2 py-1 rounded-full bg-muted text-muted-foreground whitespace-nowrap">
            Coming Soon
          </span>
        ) : (
          <Button size="sm" onClick={() => onSelect(benchmark)}>
            Use this benchmark
          </Button>
        )}
      </div>
    </div>
  );
}
