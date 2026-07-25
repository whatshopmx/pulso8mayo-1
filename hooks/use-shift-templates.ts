"use client";

import { useState, useCallback } from "react";
import {
  getTemplatesForBranch,
  applyBulkOperation,
  previewBulkOperation,
} from "@/app/actions/shifts";
import { DEFAULT_TEMPLATES } from "@/lib/services";
import { Shift, BulkShiftOperation, ApplyTemplateResult, TemplatePreview, ShiftTemplate } from "@/lib/types/shifts";

export interface UseShiftTemplatesReturn {
  templates: Omit<ShiftTemplate, "id" | "createdAt" | "updatedAt">[];
  applyTemplate: (operation: BulkShiftOperation) => Promise<ApplyTemplateResult>;
  previewTemplate: (operation: BulkShiftOperation) => Promise<TemplatePreview[]>;
  isApplying: boolean;
  applicationResult: ApplyTemplateResult | null;
}

export function useShiftTemplates(branchId?: string): UseShiftTemplatesReturn {
  const [isApplying, setIsApplying] = useState(false);
  const [applicationResult, setApplicationResult] = useState<ApplyTemplateResult | null>(null);

  // Get templates for branch
  const templates = DEFAULT_TEMPLATES;

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
    templates,
    applyTemplate,
    previewTemplate,
    isApplying,
    applicationResult,
  };
}
