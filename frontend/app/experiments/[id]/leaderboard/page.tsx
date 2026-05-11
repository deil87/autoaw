import LeaderboardPageClient from "./leaderboard-client";

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ id: "placeholder" }];
}

export default function LeaderboardPage({ params }: { params: { id: string } }) {
  return <LeaderboardPageClient params={params} />;
}
