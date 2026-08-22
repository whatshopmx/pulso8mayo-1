"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

interface Branch {
  id: string;
  name: string;
}

interface BranchContextType {
  selectedBranchId: string | null;
  selectedBranch: Branch | null;
  branches: Branch[];
  setSelectedBranchId: (branchId: string | null) => void;
  setBranches: (branches: Branch[]) => void;
  isLoading: boolean;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

const BRANCH_COOKIE_NAME = "pulso_selected_branch";

export function BranchProvider({ 
  children, 
  initialBranchId,
  initialBranches = []
}: { 
  children: React.ReactNode;
  initialBranchId?: string | null;
  initialBranches?: Branch[];
}) {
  const [selectedBranchId, setSelectedBranchIdState] = useState<string | null>(initialBranchId || null);
  const [branches, setBranchesState] = useState<Branch[]>(initialBranches);
  const [isLoading, setIsLoading] = useState(false);
  /**
   * ¿El usuario ya eligió alcance con sus propias manos?
   *
   * Sin esto, `null` significaba dos cosas incompatibles: "todavía no se sabe" y
   * "todas las sucursales". Ver `setBranches`.
   */
  const [alcanceElegido, setAlcanceElegido] = useState(false);

  // Get selected branch object
  const selectedBranch = branches.find(b => b.id === selectedBranchId) || null;

  // Set branch ID and save to cookie
  const setSelectedBranchId = useCallback((branchId: string | null) => {
    // A partir de aquí, `null` quiere decir "todas" y no "aún no se sabe".
    setAlcanceElegido(true);
    setSelectedBranchIdState(branchId);
    
    // Save to cookie for server-side access
    if (branchId) {
      document.cookie = `${BRANCH_COOKIE_NAME}=${branchId}; path=/; max-age=${60 * 60 * 24 * 30}`; // 30 days
    } else {
      document.cookie = `${BRANCH_COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }, []);

  // Set branches list
  const setBranches = useCallback((newBranches: Branch[]) => {
    setBranchesState(newBranches);

    // Sugerencia inicial, no corrección: se elige la primera sucursal sólo
    // mientras el usuario no haya dicho nada.
    //
    // Antes bastaba `!selectedBranchId`, y eso hacía que **"Todas" nunca
    // aguantara**. `setBranches` es un `useCallback` que depende de
    // `selectedBranchId`, así que cada cambio de alcance le da identidad nueva;
    // el efecto de `components/nav-company.tsx:62` lo tiene en sus dependencias
    // y vuelve a llamarlo; y al llegar con `selectedBranchId === null` esta
    // rama reponía la primera sucursal. El usuario elegía la cadena entera y la
    // pantalla rebotaba a una sucursal sola, sin decir nada. Se notó al medir
    // las peticiones del consolidado de Caja Chica (A17), pero afecta a todas
    // las pantallas que usan `BranchScopeControl`.
    if (!alcanceElegido && !selectedBranchId && newBranches.length > 0) {
      setSelectedBranchIdState(newBranches[0].id);
    }
  }, [selectedBranchId, alcanceElegido]);

  // Load branch from cookie on mount
  useEffect(() => {
    const cookies = document.cookie.split(';');
    const branchCookie = cookies.find(c => c.trim().startsWith(`${BRANCH_COOKIE_NAME}=`));
    if (branchCookie) {
      const branchId = branchCookie.split('=')[1];
      if (branchId && !selectedBranchId) {
        setSelectedBranchIdState(branchId);
      }
    }
  }, []);

  return (
    <BranchContext.Provider value={{
      selectedBranchId,
      selectedBranch,
      branches,
      setSelectedBranchId,
      setBranches,
      isLoading
    }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const context = useContext(BranchContext);
  if (context === undefined) {
    throw new Error("useBranch must be used within a BranchProvider");
  }
  return context;
}

// Helper to get branch cookie value (for server-side)
export function getBranchCookieHeader(): string {
  return BRANCH_COOKIE_NAME;
}
