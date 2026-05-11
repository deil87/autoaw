import TrialPageClient from "./trial-client";

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ id: "placeholder", geneId: "placeholder" }];
}

export default function TrialPage({ params }: { params: { id: string; geneId: string } }) {
  return <TrialPageClient params={params} />;
}
