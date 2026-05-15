import MonitorPageClient from "./monitor-client";

export const generateStaticParams = () => [{ id: '_' }];


export default function MonitorPage({ params }: { params: { id: string } }) {
  return <MonitorPageClient params={params} />;
}
