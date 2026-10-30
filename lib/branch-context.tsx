"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { resolveBranchPreference } from './rbac/resource-scope';
import type { Role } from './permissions';

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
  const initialPreference = resolveBranchPreference(userRole as Role, userBranchId, initialBranches.map(b => b.id), initialBranchId);
  const isBranchScoped = initialPreference.fixed;

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
  const initialIdValido = initialPreference.selectedBranchId;

  const [selectedBranchId, setSelectedBranchIdState] = useState<string | null>(initialIdValido);
  const [branches, setBranchesState] = useState<Branch[]>(() => initialBranches.filter(b => initialPreference.branchIds.includes(b.id)));
  const [isLoading] = useState(false);
  const effectivePreference = resolveBranchPreference(userRole as Role, userBranchId, branches.map(b => b.id), selectedBranchId);
  const effectiveBranchId = effectivePreference.selectedBranchId;
  const selectedBranch = branches.find(b => b.id === effectiveBranchId) || null;

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
    const preference = resolveBranchPreference(userRole as Role, userBranchId, branches.map(b => b.id), branchId);
    const effectiveId = preference.selectedBranchId;
    // A partir de aquí, `null` quiere decir "todas" y no "aún no se sabe".
    setSelectedBranchIdState(effectiveId);

    if (effectiveId) {
      escribirCookie(BRANCH_COOKIE_NAME, effectiveId);
      borrarCookie(BRANCH_SCOPE_COOKIE_NAME);
    } else {
      borrarCookie(BRANCH_COOKIE_NAME);
      if (preference.fixed) borrarCookie(BRANCH_SCOPE_COOKIE_NAME);
      else escribirCookie(BRANCH_SCOPE_COOKIE_NAME, BRANCH_SCOPE_ALL);
    }
  }, [userRole, userBranchId, branches]);

  // Set branches list
  const setBranches = useCallback((newBranches: Branch[]) => {
    const preference = resolveBranchPreference(userRole as Role, userBranchId, newBranches.map(b => b.id));
    const visible = newBranches.filter(b => preference.branchIds.includes(b.id));
    // No encadenar estado/efecto por una nueva referencia del mismo catálogo.
    setBranchesState(previous => previous.length === visible.length && previous.every((b, i) => b.id === visible[i].id && b.name === visible[i].name) ? previous : visible);

    // La asignación de sesión, nunca newBranches[0], fija el alcance.
  }, [userRole, userBranchId]);

  // El servidor ya resolvió la preferencia. El efecto solo sincroniza cookies;
  // no restaura autoridad ni dispara nuevos renders desde cookies obsoletas.
  useEffect(() => {
    if (isBranchScoped) {
      borrarCookie(BRANCH_SCOPE_COOKIE_NAME);
      if (effectiveBranchId) escribirCookie(BRANCH_COOKIE_NAME, effectiveBranchId);
      else borrarCookie(BRANCH_COOKIE_NAME);
      return;
    }
    const branchId = leerCookie(BRANCH_COOKIE_NAME);
    // Misma guarda que el `initialBranchId`: una cookie vieja puede nombrar
    // una sucursal que ya no existe, y restaurarla es reponer el callejón sin
    // salida en cada carga.
    if (branchId && !branches.some(b => b.id === branchId)) {
      borrarCookie(BRANCH_COOKIE_NAME);
    }
  }, [isBranchScoped, effectiveBranchId, branches]);

  return (
    <BranchContext.Provider value={{
      selectedBranchId: effectiveBranchId,
      selectedBranch,
      branches,
      setSelectedBranchId,
      setBranches,
      isLoading,
      isBranchScoped,
      userBranchId: isBranchScoped ? effectiveBranchId : userBranchId
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
