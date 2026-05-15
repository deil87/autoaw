import LeaderboardPageClient from "./leaderboard-client";

export const generateStaticParams = () => [{ id: '_' }];


export default function LeaderboardPage({ params }: { params: { id: string } }) {
  return <LeaderboardPageClient params={params} />;
}
