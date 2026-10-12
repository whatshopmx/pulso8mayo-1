"use client";

import { useState, useCallback, useEffect } from "react";
import {
  getDefaultTemplates,
  applyBulkOperation,
  previewBulkOperation,
} from "@/app/actions/shifts";
import { BulkShiftOperation, ApplyTemplateResult, TemplatePreview, ShiftTemplate } from "@/lib/types/shifts";

export interface UseShiftTemplatesReturn {
  templates: Omit<ShiftTemplate, "id" | "createdAt" | "updatedAt">[];
  applyTemplate: (operation: BulkShiftOperation) => Promise<ApplyTemplateResult>;
  previewTemplate: (operation: BulkShiftOperation) => Promise<TemplatePreview[]>;
  isApplying: boolean;
  applicationResult: ApplyTemplateResult | null;
  isLoading: boolean;
  error: string | null;
  reloadTemplates: () => Promise<void>;
}

export function useShiftTemplates(branchId?: string, loadCatalog = true): UseShiftTemplatesReturn {
  const [isApplying, setIsApplying] = useState(false);
  const [applicationResult, setApplicationResult] = useState<ApplyTemplateResult | null>(null);

  const [templates, setTemplates] = useState<UseShiftTemplatesReturn["templates"]>([]);
  const [isLoading, setIsLoading] = useState(loadCatalog);
  const [error, setError] = useState<string | null>(null);
  const reloadTemplates = useCallback(async () => {
    setIsLoading(true); setError(null);
    try { setTemplates(await getDefaultTemplates()); }
    catch { setTemplates([]); setError("No pudimos cargar las plantillas."); }
    finally { setIsLoading(false); }
  }, []);
  useEffect(() => { if (loadCatalog) void reloadTemplates(); }, [reloadTemplates, loadCatalog]);

  const applyTemplate = useCallback(
    async (operation: BulkShiftOperation): Promise<ApplyTemplateResult> => {
      setIsApplying(true);
      try {
        const result = await applyBulkOperation(operation);
        setApplicationResult(result);
        return result;
      } finally {
        setIsApplying(false);
      }
    },
    []
  );

  const previewTemplate = useCallback(
    async (operation: BulkShiftOperation): Promise<TemplatePreview[]> => {
      return previewBulkOperation(operation);
    },
    []
  );

  return {
    templates: templates.map((template) => ({ ...template, branchId: branchId ?? "" })),
    applyTemplate,
    previewTemplate,
    isApplying,
    applicationResult,
    isLoading, error, reloadTemplates,
  };
}
