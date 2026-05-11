"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DatasetUpload } from "@/components/dataset-upload";

interface DatasetRow {
  dataset_id: string;
  records: number | null;
}

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDatasets = async () => {
    setLoading(true);
    try {
      const list = await api.datasets.list();
      const rows = await Promise.all(
        list.map(async ({ dataset_id }) => {
          try {
            const records = await api.datasets.get(dataset_id);
            return { dataset_id, records: records.length };
          } catch {
            return { dataset_id, records: null };
          }
        })
      );
      setDatasets(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDatasets();
  }, []);

  const handleUploaded = (datasetId: string, records: number) => {
    setDatasets((prev) => {
      const exists = prev.find((d) => d.dataset_id === datasetId);
      if (exists) {
        return prev.map((d) =>
          d.dataset_id === datasetId ? { ...d, records } : d
        );
      }
      return [...prev, { dataset_id: datasetId, records }];
    });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Datasets</h1>

      <div className="rounded-lg border p-4 space-y-2">
        <h2 className="text-sm font-semibold">Upload Dataset</h2>
        <p className="text-xs text-muted-foreground">
          JSON file must be an array of objects with <code>input</code> and{" "}
          <code>expected</code> fields.
        </p>
        <DatasetUpload onUploaded={handleUploaded} />
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Dataset ID</th>
              <th className="text-right px-4 py-2 font-medium">Records</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && datasets.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-muted-foreground">
                  No datasets yet. Upload one above.
                </td>
              </tr>
            )}
            {datasets.map((d) => (
              <tr key={d.dataset_id} className="border-t">
                <td className="px-4 py-2 font-mono">{d.dataset_id}</td>
                <td className="px-4 py-2 text-right text-muted-foreground">
                  {d.records ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
