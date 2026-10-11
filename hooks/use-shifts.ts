"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getShifts,
  createShift,
  updateShift,
  deleteShift,
  publishShifts as publishShiftsAction,
  duplicateShifts as duplicateShiftsAction,
} from "@/app/actions/shifts";
import { Shift, ShiftFilters, CreateShiftInput } from "@/lib/types/shifts";

export interface UseShiftsReturn {
  shifts: Shift[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  createShift: (data: CreateShiftInput) => Promise<Shift>;
  updateShift: (id: string, data: Partial<CreateShiftInput>) => Promise<Shift>;
  deleteShift: (id: string) => Promise<void>;
  publishShifts: (shiftIds: string[]) => Promise<void>;
  duplicateShifts: (shiftIds: string[], targetWeekStart: Date) => Promise<Shift[]>;
  isCreating: boolean;
  isUpdating: boolean;
  isDeleting: boolean;
  isPublishing: boolean;
  isDuplicating: boolean;
  refetch: () => Promise<void>;
}

export function useShifts(filters: ShiftFilters = {}): UseShiftsReturn {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const latestRequest = useRef(0);
  const filterKey = JSON.stringify(filters);
  const [resolvedFilters, setResolvedFilters] = useState<string | null>(null);

  const fetchShifts = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setIsLoading(true);
    setIsError(false);
    setError(null);
    try {
      const data = await getShifts(JSON.parse(filterKey) as ShiftFilters);
      if (requestId !== latestRequest.current) return;
      setShifts(data);
    } catch (err) {
      if (requestId !== latestRequest.current) return;
      setIsError(true);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (requestId === latestRequest.current) {
        setResolvedFilters(filterKey);
        setIsLoading(false);
      }
    }
  }, [filterKey]);

  useEffect(() => {
    const requestCounter = latestRequest;
    fetchShifts();
    // Las acciones no admiten AbortSignal: ignorar las lecturas anteriores
    // impide exportar un filtro viejo y actualizar una vista desmontada.
    return () => { requestCounter.current++; };
  }, [fetchShifts]);

  const handleCreate = useCallback(
    async (data: CreateShiftInput): Promise<Shift> => {
      setIsCreating(true);
      try {
        const result = await createShift(data);
        await fetchShifts();
        return result;
      } finally {
        setIsCreating(false);
      }
    },
    [fetchShifts]
  );

  const handleUpdate = useCallback(
    async (id: string, data: Partial<CreateShiftInput>): Promise<Shift> => {
      setIsUpdating(true);
      try {
        const result = await updateShift(id, data);
        await fetchShifts();
        return result;
      } finally {
        setIsUpdating(false);
      }
    },
    [fetchShifts]
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      setIsDeleting(true);
      try {
        await deleteShift(id);
        await fetchShifts();
      } finally {
        setIsDeleting(false);
      }
    },
    [fetchShifts]
  );

  const handlePublish = useCallback(
    async (shiftIds: string[]): Promise<void> => {
      setIsPublishing(true);
      try {
        await publishShiftsAction(shiftIds);
        await fetchShifts();
      } finally {
        setIsPublishing(false);
      }
    },
    [fetchShifts]
  );

  const handleDuplicate = useCallback(
    async (shiftIds: string[], targetWeekStart: Date): Promise<Shift[]> => {
      setIsDuplicating(true);
      try {
        const result = await duplicateShiftsAction(shiftIds, targetWeekStart);
        await fetchShifts();
        return result;
      } finally {
        setIsDuplicating(false);
      }
    },
    [fetchShifts]
  );

  return {
    shifts: resolvedFilters === filterKey ? shifts : [],
    isLoading: isLoading || resolvedFilters !== filterKey,
    isError: resolvedFilters === filterKey && isError,
    error: resolvedFilters === filterKey ? error : null,
    createShift: handleCreate,
    updateShift: handleUpdate,
    deleteShift: handleDelete,
    publishShifts: handlePublish,
    duplicateShifts: handleDuplicate,
    isCreating,
    isUpdating,
    isDeleting,
    isPublishing,
    isDuplicating,
    refetch: fetchShifts,
  };
}
