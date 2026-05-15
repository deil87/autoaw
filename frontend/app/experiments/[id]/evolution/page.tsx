import { EvolutionClient } from "./evolution-client";

export const generateStaticParams = () => [{ id: '_' }];


export default function EvolutionPage({
  params,
}: {
  params: { id: string };
}) {
  return <EvolutionClient experimentId={params.id} />;
}
