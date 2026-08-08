"use client";

import { useEffect, useState } from "react";
import {
  OperatingConfigForm,
  type OperatingConfigValues,
} from "@/components/company/operating-config-form";
import { Settings2, Loader2 } from "lucide-react";

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
          <Settings2 className="h-7 w-7 text-primary" /> Modelo Operativo del Grupo (Fase 11)
        </h1>
        <p className="text-sm text-muted-foreground">
          Configura las 7 dimensiones estructurales de la empresa y los umbrales financieros de autonomía corporativa.
        </p>
      </div>

      {loading ? (
        <div className="py-12 flex justify-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando configuración operativa...
        </div>
      ) : (
        <OperatingConfigForm initialConfig={config} />
      )}
    </div>
  );
}
