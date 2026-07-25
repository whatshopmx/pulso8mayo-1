
"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { BuilderStepType, StepCategory, getStepCategory, normalizeStepType, normalizeOptions, STEP_TYPE_DISPLAY } from '@/lib/workflow-type-map';

export type StepType = BuilderStepType;
export type { StepCategory };
export { getStepCategory, normalizeStepType, normalizeOptions, STEP_TYPE_DISPLAY };

export interface AIVerificationConfig {
    enabled: boolean;
    prompt?: string;
    threshold?: number;
    expectedConditions?: string[];
    autoFillField?: string;
}


export interface ValidationConfig {
    min?: number;
    max?: number;
    minTime?: string;
    maxTime?: string;
    radiusMeters?: number;
    message?: string;
}

export interface ConditionalBranch {
    id: string;
    condition: string;
    targetStepId: string;
}

export interface RemediationStep {
    instruction: string;
    waitSeconds: number;
    verification?: {
        type: string;
        targetCondition: string;
    };
}

export interface EscalationStep {
    level: number;
    triggerAfterMinutes: number;
    triggerCondition: string;
    notifyRoles: string[];
    channel: string;
    message: string;
    includeData?: Record<string, any>;
}

export interface RemediationProtocol {
    enabled: boolean;
    type: string;
    maxAttempts: number;
    timeoutMinutes: number;
    steps: RemediationStep[];
}

export interface RuleAction {
    type: string;
    delay?: number;
    message?: string;
    priority?: string;
    assignTo?: string;
    item?: string;
    quantity?: number;
}

export interface LogicRule {
    id: string;
    name?: string;
    condition: string;
    severity: 'PASS' | 'WARNING' | 'HIGH' | 'CRITICAL';
    message: string;
    remediationProtocol?: RemediationProtocol;
    escalationChain?: EscalationStep[];
    actions?: RuleAction[];
}

export interface WorkflowStep {
    id: string;
    type: StepType;
    title: string;
    description?: string;
    category?: string;
    required: boolean;
    config?: any;
    aiVerification?: AIVerificationConfig;
    validation?: ValidationConfig;
    logicRules?: LogicRule[];
    options?: string[];
    placeholder?: string;
    defaultValue?: string;
    readOnly?: boolean;
    branches?: ConditionalBranch[];
    conditionalLogic?: Record<string, any>;
    actions?: string[] | RuleAction[];
}

interface TemplateMeta {
  id?: string;
  name: string;
  description?: string;
  category?: string;
}

interface BuilderContextType {
  steps: WorkflowStep[];
  selectedStepId: string | null;
  addStep: (type: StepType) => void;
  updateStep: (id: string, updates: Partial<WorkflowStep>) => void;
  removeStep: (id: string) => void;
  selectStep: (id: string | null) => void;
  moveStep: (activeId: string, overId: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  templateMeta: TemplateMeta;
  updateTemplateMeta: (updates: Partial<TemplateMeta>) => void;
}

const BuilderContext = createContext<BuilderContextType | undefined>(undefined);

const MAX_HISTORY = 50;

export function BuilderProvider({ children, initialSteps = [], initialMeta }: { children: ReactNode, initialSteps?: WorkflowStep[], initialMeta?: Partial<TemplateMeta> }) {

  const [steps, setSteps] = useState<WorkflowStep[]>(initialSteps);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [templateMeta, setTemplateMeta] = useState<TemplateMeta>({
    name: initialMeta?.name || "",
    description: initialMeta?.description,
    category: initialMeta?.category,
    id: initialMeta?.id,
  });

  // Undo/redo history
  const [history, setHistory] = useState<WorkflowStep[][]>([]);
  const [future, setFuture] = useState<WorkflowStep[][]>([]);

  const pushHistory = (currentSteps: WorkflowStep[]) => {
    setHistory(prev => {
      const next = [...prev, JSON.parse(JSON.stringify(currentSteps))];
      return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
    });
    setFuture([]); // Clear redo stack on new action
  };

  const undo = () => {
    setHistory(prev => {
      if (prev.length === 0) return prev;
      const newHistory = [...prev];
      const previousState = newHistory.pop()!;
      setFuture(f => [...f, JSON.parse(JSON.stringify(steps))]);
      setSteps(previousState);
      setSelectedStepId(null);
      return newHistory;
    });
  };

  const redo = () => {
    setFuture(prev => {
      if (prev.length === 0) return prev;
      const newFuture = [...prev];
      const nextState = newFuture.pop()!;
      setHistory(h => [...h, JSON.parse(JSON.stringify(steps))]);
      setSteps(nextState);
      setSelectedStepId(null);
      return newFuture;
    });
  };

  const canUndo = history.length > 0;
  const canRedo = future.length > 0;

  // Sync initialSteps prop changes with state (e.g. when navigating between templates)
  useEffect(() => {
    setSteps(initialSteps);
    setSelectedStepId(null);
    setHistory([]);
    setFuture([]);
  }, [initialSteps]);

  const updateTemplateMeta = (updates: Partial<TemplateMeta>) => {
    setTemplateMeta(prev => ({ ...prev, ...updates }));
  };

    const addStep = (type: StepType) => {
        const newStep: WorkflowStep = {
            id: uuidv4(),
            type,
            title: `Nuevo paso de ${type}`,
            required: false,
            config: {}
        };
        pushHistory(steps);
        setSteps(prev => [...prev, newStep]);
        setSelectedStepId(newStep.id);
    };

    const updateStep = (id: string, updates: Partial<WorkflowStep>) => {
        pushHistory(steps);
        setSteps(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    };

    const removeStep = (id: string) => {
        pushHistory(steps);
        setSteps(prev => prev.filter(s => s.id !== id));
        if (selectedStepId === id) setSelectedStepId(null);
    };

    const selectStep = (id: string | null) => {
        setSelectedStepId(id);
    };

    const moveStep = (activeId: string, overId: string) => {
        pushHistory(steps);
        setSteps((items) => {
            const oldIndex = items.findIndex(i => i.id === activeId);
            const newIndex = items.findIndex(i => i.id === overId);

            const newItems = [...items];
            const [movedItem] = newItems.splice(oldIndex, 1);
            newItems.splice(newIndex, 0, movedItem);
            return newItems;
        });
    };

  return (
    <BuilderContext.Provider value={{ steps, selectedStepId, addStep, updateStep, removeStep, selectStep, moveStep, undo, redo, canUndo, canRedo, templateMeta, updateTemplateMeta }}>
      {children}
    </BuilderContext.Provider>
  );
}

export const useBuilder = () => {
    const context = useContext(BuilderContext);
    if (!context) throw new Error("useBuilder must be used within BuilderProvider");
    return context;
};
