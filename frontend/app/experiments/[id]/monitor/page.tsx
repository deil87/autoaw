import MonitorPageClient from "./monitor-client";

export default function MonitorPage({ params }: { params: { id: string } }) {
  return <MonitorPageClient params={params} />;
}
