import ExperimentRedirect from "./redirect-client";

export const generateStaticParams = () => [{ id: '_' }];


export default function ExperimentPage() {
  return <ExperimentRedirect />;
}
