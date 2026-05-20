import MonitorPageClient from "./monitor-client";

export const generateStaticParams = () => [{ id: '_' }];

export default function MonitorPage() {
  return <MonitorPageClient />;
}
