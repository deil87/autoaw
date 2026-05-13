"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TopologyGraph } from "@/components/topology-graph";
import type { Agent, Gene } from "@/lib/types";

const EDGE_TYPE_PILL: Record<string, string> = {
  sequential:  "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  broadcast:   "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  reduce:      "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  conditional: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
};

function AgentDetail({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <span className="capitalize font-medium">{agent.role}</span>
          <Badge variant="secondary" className="text-xs">{agent.model}</Badge>
          <span className="text-xs text-muted-foreground">temp: {agent.temperature}</span>
          <button
            onClick={onClose}
            className="ml-auto text-muted-foreground hover:text-foreground text-base leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </CardTitle>
        <p className="text-xs text-muted-foreground font-mono">{agent.id}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1">System Prompt</p>
          <p className="text-sm whitespace-pre-wrap">{agent.system_prompt}</p>
        </div>
        {agent.tools.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Tools</p>
            <div className="flex gap-1 flex-wrap">
              {agent.tools.map((t) => (
                <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function GeneViewer({ gene }: { gene: Gene }) {
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-muted-foreground">{gene.id}</span>
        <Badge variant="outline">{gene.topology}</Badge>
      </div>

      {/* Graph */}
      <TopologyGraph
        gene={gene}
        onSelectAgent={setSelectedAgent}
        selectedAgentId={selectedAgent?.id ?? null}
      />

      {/* Legend */}
      <div className="flex flex-wrap gap-2 text-xs">
        {Object.entries(EDGE_TYPE_PILL).map(([type, cls]) => (
          <span key={type} className={`px-2 py-0.5 rounded-full font-medium ${cls}`}>{type}</span>
        ))}
        <span className="text-muted-foreground self-center">— click a node to inspect</span>
      </div>

      {/* Agent detail panel */}
      {selectedAgent && (
        <AgentDetail agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}

      {/* Raw JSON */}
      <div>
        <h3 className="font-semibold text-sm mb-2">Raw JSON</h3>
        <pre className="bg-muted p-4 rounded-md text-xs overflow-auto max-h-64">
          {JSON.stringify(gene, null, 2)}
        </pre>
      </div>
    </div>
  );
}
