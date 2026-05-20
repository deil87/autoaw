import LeaderboardPageClient from "./leaderboard-client";

export const generateStaticParams = () => [{ id: '_' }];

export default function LeaderboardPage() {
  return <LeaderboardPageClient />;
}
