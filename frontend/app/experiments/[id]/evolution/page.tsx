import { EvolutionClient } from "./evolution-client";

export const generateStaticParams = () => [{ id: '_' }];

export default function EvolutionPage() {
  return <EvolutionClient />;
}
