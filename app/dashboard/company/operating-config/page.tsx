"use client";

import { useEffect, useState } from "react";
import {
  OperatingConfigForm,
  type OperatingConfigValues,
} from "@/components/company/operating-config-form";
import { OperatingConfigSkeleton } from "@/components/company/operating-config-skeleton";
import { Sliders } from "lucide-react";

export default function OperatingConfigPage() {
  const [config, setConfig] = useState<OperatingConfigValues | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchConfig() {
      setLoading(true);
      try {
        const res = await fetch("/api/company/operating-config");
        const json = await res.json();
        if (res.ok && json.success) {
          setConfig(json.data);
        }
      } catch (err) {
        console.error("Failed to load tenant operating config:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchConfig();
  }, []);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Sliders className="h-6 w-6 text-foreground" /> Modelo Operativo del Grupo
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configura la arquitectura funcional entre corporativo y sucursales, los límites de autorización y las metas financieras.
        </p>
      </div>

      {loading ? (
        <OperatingConfigSkeleton />
      ) : (
        <OperatingConfigForm initialConfig={config} />
      )}
    </div>
  );
}
