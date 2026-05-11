import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Experiment } from "@/lib/types";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  running: "default",
  completed: "default",
  failed: "destructive",
  cancelled: "secondary",
};

export function ExperimentCard({ experiment }: { experiment: Experiment }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <CardTitle className="text-base">{experiment.name}</CardTitle>
          <Badge variant={STATUS_VARIANT[experiment.status] ?? "secondary"}>
            {experiment.status}
          </Badge>
        </div>
        <CardDescription className="text-xs text-muted-foreground">
          {new Date(experiment.created_at).toLocaleString()}
        </CardDescription>
      </CardHeader>
      <CardFooter className="gap-2">
        <Link href={`/experiments/${experiment.id}/monitor`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Monitor</Link>
        <Link href={`/experiments/${experiment.id}/leaderboard`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>Leaderboard</Link>
      </CardFooter>
    </Card>
  );
}
