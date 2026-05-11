"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface Props {
  onUploaded: (datasetId: string, records: number) => void;
}

export function DatasetUpload({ onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async () => {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await api.datasets.upload(file);
      onUploaded(result.dataset_id, result.records);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-end gap-3">
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="dataset-file">
          JSON file
        </label>
        <input
          id="dataset-file"
          ref={inputRef}
          type="file"
          accept=".json"
          className="block text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-secondary file:text-secondary-foreground hover:file:bg-secondary/80 cursor-pointer"
        />
      </div>
      <Button onClick={handleUpload} disabled={uploading} type="button">
        {uploading ? "Uploading…" : "Upload"}
      </Button>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
