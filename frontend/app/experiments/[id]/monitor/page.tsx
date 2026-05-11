import MonitorPageClient from "./monitor-client";

export const dynamicParams = false;

export function generateStaticParams() {
  return [{ id: "placeholder" }];
}

export default function MonitorPage({ params }: { params: { id: string } }) {
  return <MonitorPageClient params={params} />;
}
