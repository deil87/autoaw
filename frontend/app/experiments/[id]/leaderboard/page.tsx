import LeaderboardPageClient from "./leaderboard-client";

export default function LeaderboardPage({ params }: { params: { id: string } }) {
  return <LeaderboardPageClient params={params} />;
}
