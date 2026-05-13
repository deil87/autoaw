import { EvolutionClient } from "./evolution-client";

export default function EvolutionPage({
  params,
}: {
  params: { id: string };
}) {
  return <EvolutionClient experimentId={params.id} />;
}
