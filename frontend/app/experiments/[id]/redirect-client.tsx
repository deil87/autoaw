"use client";
import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";

export default function ExperimentRedirect() {
  const router = useRouter();
  const params = useParams();
  useEffect(() => {
    router.replace(`/experiments/${params.id}/monitor`);
  }, [router, params.id]);
  return null;
}
