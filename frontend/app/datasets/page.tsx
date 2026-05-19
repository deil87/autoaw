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
    <div>
      <div className="exp-list-head" style={{ marginBottom: 24 }}>
        <div>
          <h1>Datasets</h1>
          {!loading && (
            <div className="sub">{datasets.length} dataset{datasets.length !== 1 ? "s" : ""}</div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div>
            <div className="card-title">Upload dataset</div>
            <div className="card-subtitle">
              JSON array of objects with <code className="mono">input</code> and <code className="mono">expected</code> fields
            </div>
          </div>
        </div>
        <div className="card-body">
          <DatasetUpload onUploaded={handleUploaded} />
        </div>
      </div>

      <div className="card">
        <table className="t">
          <thead>
            <tr>
              <th>Dataset ID</th>
              <th className="num">Records</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={2} style={{ padding: "24px 12px", textAlign: "center", color: "var(--faint)" }}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && datasets.length === 0 && (
              <tr>
                <td colSpan={2} style={{ padding: "24px 12px", textAlign: "center", color: "var(--faint)" }}>
                  No datasets yet. Upload one above.
                </td>
              </tr>
            )}
            {datasets.map((d) => (
              <tr key={d.dataset_id}>
                <td className="mono">{d.dataset_id}</td>
                <td className="num">{d.records ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
