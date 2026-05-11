import ExperimentRedirect from "./redirect-client";

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ id: "placeholder" }];
}

export default function ExperimentPage() {
  return <ExperimentRedirect />;
}
