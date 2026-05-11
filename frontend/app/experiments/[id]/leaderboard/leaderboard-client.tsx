"use client";
import { useEffect, useState } from "react";
import { TrialTable } from "@/components/trial-table";
import { api } from "@/lib/api";
import type { Trial } from "@/lib/types";

export default function LeaderboardPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [trials, setTrials] = useState<Trial[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.trials.list(id).then((data) => setTrials(data)).finally(() => setLoading(false));
  }, [id]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Leaderboard</h1>
      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : trials.length === 0 ? (
        <p className="text-muted-foreground">No trials yet.</p>
      ) : (
        <TrialTable trials={trials} experimentId={id} />
      )}
    </div>
  );
}
