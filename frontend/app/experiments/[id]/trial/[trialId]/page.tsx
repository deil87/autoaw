import TrialClient from "./trial-client";

export const generateStaticParams = () => [{ id: '_', trialId: '_' }];

export default function TrialPage() {
  return <TrialClient />;
}
