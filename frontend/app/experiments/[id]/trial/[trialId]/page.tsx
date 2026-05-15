import TrialClient from "./trial-client";

export const generateStaticParams = () => [{ id: '_', trialId: '_' }];


export default function TrialPage({ params }: { params: { id: string; trialId: string } }) {
  return <TrialClient params={params} />;
}
