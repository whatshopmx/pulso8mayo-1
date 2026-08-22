"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

import {
  BRANCH_COOKIE_MAX_AGE,
  BRANCH_COOKIE_NAME,
  BRANCH_SCOPE_ALL,
  BRANCH_SCOPE_COOKIE_NAME,
} from "./branch-cookies";

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
  /**
   * `GERENTE` y `SUPERVISOR`: el servidor les fija la sucursal y **ignora** la
   * que pidan (`lib/branch-scope.ts:85`). Lo expone el contexto para que el
   * control del encabezado deje de ofrecerles un menú que no hace nada (AD-B8).
   */
  isBranchScoped: boolean;
  /** La sucursal que la sesión les asignó. `null` en un alcance `NONE`. */
  userBranchId: string | null;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

function escribirCookie(nombre: string, valor: string) {
  document.cookie = `${nombre}=${valor}; path=/; max-age=${BRANCH_COOKIE_MAX_AGE}`;
}

function borrarCookie(nombre: string) {
  document.cookie = `${nombre}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function leerCookie(nombre: string): string | null {
  const encontrada = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${nombre}=`));
  return encontrada ? encontrada.split("=")[1] || null : null;
}

export function BranchProvider({
  children,
  initialBranchId,
  initialBranches = [],
  initialScopeChosen = false,
  userRole,
  userBranchId = null,
}: {
  children: React.ReactNode;
  initialBranchId?: string | null;
  initialBranches?: Branch[];
  /** El servidor ya vio `pulso_branch_scope=all`: el alcance es una elección. */
  initialScopeChosen?: boolean;
  userRole?: string;
  userBranchId?: string | null;
}) {
  // El mismo criterio que `components/nav-company.tsx:55`. No se importa
  // `isBranchScopedRole` de `lib/branch-scope.ts` porque ese módulo importa
  // `db`, y esto es un componente cliente.
  const isBranchScoped = userRole === "GERENTE" || userRole === "SUPERVISOR";

  /**
   * Un alcance inicial sólo cuenta si la sucursal **existe**.
   *
   * `app/dashboard/layout.tsx` resuelve `cookie ?? session.user.branchId`, y
   * ninguno de los dos garantiza que la sucursal siga viva: una sucursal que se
   * dio de baja, un usuario reasignado, una cookie de hace un mes. Cuando el id
   * cuelga, **toda pantalla con alcance pide datos de una sucursal fantasma** y
   * contesta "La sucursal seleccionada no existe para esta empresa" — un callejón
   * sin salida del que el usuario no puede salir, porque el control del
   * encabezado ni siquiera sabe qué mostrar como seleccionado.
   *
   * Un id que no está en la lista no es un alcance: se descarta y se cae a la
   * autoselección de siempre, que es exactamente el caso "todavía no se sabe".
   */
  const initialIdValido =
    initialBranchId && initialBranches.some((b) => b.id === initialBranchId)
      ? initialBranchId
      : null;

  const [selectedBranchId, setSelectedBranchIdState] = useState<string | null>(initialIdValido);
  const [branches, setBranchesState] = useState<Branch[]>(initialBranches);
  const [isLoading] = useState(false);
  /**
   * ¿El usuario ya eligió alcance con sus propias manos?
   *
   * Sin esto, `null` significaba dos cosas incompatibles: "todavía no se sabe" y
   * "todas las sucursales". Ver `setBranches`.
   *
   * Nace en `true` cuando el servidor encontró `pulso_branch_scope=all`: ahí la
   * elección es de una visita anterior y hay que respetarla, no volver a
   * sugerir.
   */
  const [alcanceElegido, setAlcanceElegido] = useState(initialScopeChosen);

  // Get selected branch object
  const selectedBranch = branches.find(b => b.id === selectedBranchId) || null;

  /**
   * Guardar el alcance necesita **dos** cookies, no una.
   *
   * "Todas" borraba `pulso_selected_branch` y ya. Al recargar, esa ausencia era
   * indistinguible de "el usuario nunca eligió", y `setBranches` reponía la
   * primera sucursal: el usuario elegía la cadena entera, recargaba y la
   * pantalla volvía a una sucursal sola sin decir nada.
   *
   * `pulso_branch_scope=all` es lo que hace decible ese "sí elegí, y elegí
   * todas". Va aparte a propósito: ver `lib/branch-cookies.ts`.
   */
  const setSelectedBranchId = useCallback((branchId: string | null) => {
    // A partir de aquí, `null` quiere decir "todas" y no "aún no se sabe".
    setAlcanceElegido(true);
    setSelectedBranchIdState(branchId);

    if (branchId) {
      escribirCookie(BRANCH_COOKIE_NAME, branchId);
      borrarCookie(BRANCH_SCOPE_COOKIE_NAME);
    } else {
      borrarCookie(BRANCH_COOKIE_NAME);
      escribirCookie(BRANCH_SCOPE_COOKIE_NAME, BRANCH_SCOPE_ALL);
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
    // rama reponía la primera sucursal.
    //
    // `isBranchScoped` es la condición nueva (AD-B7). Para un ADMIN o
    // SUPER_ADMIN la ausencia de elección significa **"Todas"**, que es lo que
    // el servidor ya aplica: `lib/branch-scope.ts:82` devuelve `kind: "ALL"`
    // cuando un rol no fijado no pide sucursal. Elegir `branches[0]` era el
    // cliente inventando una sucursal —la que la consulta devolvió primero— y
    // presentándola como si fuera la de la casa. Para GERENTE y SUPERVISOR la
    // sugerencia se queda: su sucursal es su universo entero.
    if (isBranchScoped && !alcanceElegido && !selectedBranchId && newBranches.length > 0) {
      setSelectedBranchIdState(newBranches[0].id);
    }
  }, [selectedBranchId, alcanceElegido, isBranchScoped]);

  // Load branch from cookie on mount
  useEffect(() => {
    // El servidor ya resolvió el alcance y lo pasó por props. Esto es la red
    // para cuando el proveedor se monta sin ellos.
    if (alcanceElegido || selectedBranchId) return;

    if (leerCookie(BRANCH_SCOPE_COOKIE_NAME) === BRANCH_SCOPE_ALL) {
      setAlcanceElegido(true);
      return;
    }

    const branchId = leerCookie(BRANCH_COOKIE_NAME);
    // Misma guarda que el `initialBranchId`: una cookie vieja puede nombrar
    // una sucursal que ya no existe, y restaurarla es reponer el callejón sin
    // salida en cada carga.
    if (branchId && branches.some(b => b.id === branchId)) {
      setSelectedBranchIdState(branchId);
    }
  }, []);

  return (
    <BranchContext.Provider value={{
      selectedBranchId,
      selectedBranch,
      branches,
      setSelectedBranchId,
      setBranches,
      isLoading,
      isBranchScoped,
      userBranchId
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
