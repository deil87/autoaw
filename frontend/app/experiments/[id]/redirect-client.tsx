"use client";
import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

export default function ExperimentRedirect() {
  const router = useRouter();
  const id = usePathname().split("/")[2];
  useEffect(() => {
    router.replace(`/experiments/${id}/monitor`);
  }, [router, id]);
  return null;
}
