"use client";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { BenchmarkDescriptor } from "@/lib/types";

interface BenchmarkInfo {
  headline: string;
  datasource: string;
  tools: string;
  howItWorks: string;
}

const BENCHMARK_INFO: Record<string, BenchmarkInfo> = {
  "swe-bench": {
    headline: "Requires a Live Linux Container (Docker)",
    datasource:
      "A real Git repository (like sympy or scikit-learn) cloned at a specific historic commit.",
    tools: "Bash, git, pip, and Python testing frameworks (pytest).",
    howItWorks:
      "The agent uses tools to search the codebase, edits physical files on the container's disk, and runs the actual test suite via the terminal. The evaluation harness then checks if the unit tests pass on that live container.",
  },
  workbench: {
    headline: "Requires Stateful Databases & APIs",
    datasource:
      "Live-mocked SQLite/PostgreSQL databases filled with hundreds of fake customer records, order histories, and calendar events.",
    tools: "API endpoints like cancel_meeting(), update_crm_status(), or send_email().",
    howItWorks:
      "The agent must query the data sources to find context and execute tools that change the system's state. The benchmark grades the agent by inspecting the database after the agent is done to see if the correct rows were updated or deleted.",
  },
  "tau-bench": {
    headline: "Requires Stateful Databases & APIs",
    datasource:
      "Live-mocked SQLite/PostgreSQL databases filled with hundreds of fake customer records, order histories, and calendar events.",
    tools: "API endpoints like cancel_meeting(), update_crm_status(), or send_email().",
    howItWorks:
      "The agent must query the data sources to find context and execute tools that change the system's state. The benchmark grades the agent by inspecting the database after the agent is done to see if the correct rows were updated or deleted.",
  },
  gaia: {
    headline: "Requires a File System and Multi-Modal Tools",
    datasource:
      "Large attachments (40-page PDFs, Excel spreadsheets, images, audio files).",
    tools:
      "Web browsers, Python code execution environments (to write scripts to calculate math or parse CSVs), and file readers.",
    howItWorks:
      "An agent might have to write a Python script to extract data from page 12 of a PDF, search the web to cross-reference a name found in that data, and then calculate a final math formula.",
  },
  agentbench: {
    headline: "Requires Multi-Environment Runtimes",
    datasource:
      "A live operating system, web shopping interfaces, or text-based game environments (like ALFWorld).",
    tools: "Standard I/O text interfaces where the agent inputs bash commands or web-clicks.",
    howItWorks:
      "AgentBench functions like a video game engine for LLMs, evaluating agents across diverse live environments simultaneously.",
  },
};

interface BenchmarkCardProps {
  benchmark: BenchmarkDescriptor;
  onSelect: (b: BenchmarkDescriptor) => void;
  comingSoon?: boolean;
}

export function BenchmarkCard({ benchmark, onSelect, comingSoon }: BenchmarkCardProps) {
  const info = BENCHMARK_INFO[benchmark.id];

  return (
    <div className={`border rounded-lg p-4 space-y-2 bg-card${comingSoon ? " opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-1.5 min-w-0">
          <div className="min-w-0">
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
          {info && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`More info about ${benchmark.name}`}
                >
                  <Info className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" className="w-80 text-xs space-y-2">
                <p className="font-semibold text-sm">{info.headline}</p>
                <div>
                  <span className="font-medium">Data source: </span>
                  {info.datasource}
                </div>
                <div>
                  <span className="font-medium">Tools: </span>
                  {info.tools}
                </div>
                <div>
                  <span className="font-medium">How it works: </span>
                  {info.howItWorks}
                </div>
              </PopoverContent>
            </Popover>
          )}
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
