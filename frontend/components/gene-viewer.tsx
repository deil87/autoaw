"use client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Gene } from "@/lib/types";

export function GeneViewer({ gene }: { gene: Gene }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-muted-foreground">{gene.id}</span>
        <Badge variant="outline">{gene.topology}</Badge>
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold text-sm">Agents</h3>
        {gene.agents.map((agent) => (
          <Card key={agent.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <span className="capitalize font-medium">{agent.role}</span>
                <Badge variant="secondary" className="text-xs">{agent.model}</Badge>
                <span className="text-xs text-muted-foreground ml-auto">temp: {agent.temperature}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{agent.system_prompt}</p>
              {agent.tools.length > 0 && (
                <div className="flex gap-1 mt-2">
                  {agent.tools.map((t) => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {gene.agents.length === 0 && (
          <p className="text-sm text-muted-foreground">No agents defined.</p>
        )}
      </div>

      <div>
        <h3 className="font-semibold text-sm mb-2">Raw JSON</h3>
        <pre className="bg-muted p-4 rounded-md text-xs overflow-auto max-h-64">
          {JSON.stringify(gene, null, 2)}
        </pre>
      </div>
    </div>
  );
}
