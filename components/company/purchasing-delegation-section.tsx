"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  usePurchaseDelegation,
  useSavePurchaseDelegation,
  type DelegationAction,
  type DelegationRule,
  type DelegationScope,
} from "@/hooks/queries/use-service-orders";
import { useBranches } from "@/hooks/queries/use-branches";
import { APPROVER_ROLES_HIERARCHY } from "@/lib/permissions";
import { Check, Info, Loader2, Plus, Save, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

/**
 * Controles de solicitud y emisión de compras (C16.2.3).
 *
 * Lo que la tarjeta promete es lo que el servidor hace, y se apoya en dos
 * decisiones que conviene no volver a tomar al revés:
 *
 *  - **La modalidad de compras no aparece aquí.** Elegir HÍBRIDO arriba no
 *    concede ni quita permisos: los responsables se eligen en esta tabla. Si
 *    alguna vez se quisiera derivarlos de la modalidad, sería una política
 *    distinta y con su propio consumidor.
 *  - **Sin reglas no es «cualquiera puede».** Significa que esta política no
 *    añade nada y sigue decidiendo el permiso de inventario de siempre. La
 *    tarjeta lo dice con esas palabras para que nadie lo lea como una puerta
 *    abierta.
 *
 * Los avisos del servidor (dos reglas que cubren lo mismo) no bloquean el
 * guardado: son legibles, no rotos, y bloquear dejaría al operador sin salida.
 */

interface FilaBorrador {
  scope: DelegationScope;
  branchId: string;
  category: string;
  requiredRole: string;
  active: boolean;
}

const FILA_VACIA: FilaBorrador = {
  scope: "COMPANY",
  branchId: "",
  category: "",
  requiredRole: "GERENTE",
  active: true,
};

const ALCANCES: Array<{ valor: DelegationScope; etiqueta: string }> = [
  { valor: "COMPANY", etiqueta: "Toda la empresa" },
  { valor: "BRANCH", etiqueta: "Una sucursal" },
  { valor: "CATEGORY", etiqueta: "Una categoría" },
];

const ROLES = Object.entries(APPROVER_ROLES_HIERARCHY)
  .sort((a, b) => b[1] - a[1])
  .map(([role]) => role);

const ACCIONES: Array<{ valor: DelegationAction; etiqueta: string; ayuda: string }> = [
  {
    valor: "REQUEST",
    etiqueta: "Solicitar",
    ayuda: "Crear una requisición o una orden en borrador.",
  },
  {
    valor: "EMIT",
    etiqueta: "Emitir",
    ayuda: "Enviar al proveedor una orden ya aprobada.",
  },
];

function reglaAFila(regla: DelegationRule): FilaBorrador {
  return {
    scope: regla.scope,
    branchId: regla.branchId ?? "",
    category: regla.category ?? "",
    requiredRole: regla.requiredRole,
    active: regla.active,
  };
}

/** Validación de la fila en cliente: la misma coherencia que exige el servidor. */
function filaARegla(fila: FilaBorrador, accion: DelegationAction): DelegationRule | { error: string } {
  if (fila.scope === "BRANCH" && !fila.branchId) {
    return { error: "Elige la sucursal que cubre esta regla." };
  }
  if (fila.scope === "CATEGORY" && fila.category.trim() === "") {
    return { error: "Escribe la categoría de los artículos que cubre esta regla." };
  }
  if (!ROLES.includes(fila.requiredRole)) {
    return { error: `Rol desconocido: "${fila.requiredRole}".` };
  }
  return {
    action: accion,
    scope: fila.scope,
    branchId: fila.scope === "BRANCH" ? fila.branchId : null,
    category: fila.scope === "CATEGORY" ? fila.category.trim() : null,
    requiredRole: fila.requiredRole,
    active: fila.active,
  };
}

function EditorDeAccion({ accion }: { accion: DelegationAction }) {
  const consulta = usePurchaseDelegation();
  const guardar = useSavePurchaseDelegation();
  const sucursales = useBranches();

  const [borrador, setBorrador] = useState<FilaBorrador[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);

  const guardadas = (consulta.data?.[accion]?.reglas ?? []) as DelegationRule[];
  const filas = borrador ?? guardadas.map(reglaAFila);
  const config = ACCIONES.find((a) => a.valor === accion)!;

  const editar = (indice: number, parcial: Partial<FilaBorrador>) => {
    setBorrador(filas.map((f, i) => (i === indice ? { ...f, ...parcial } : f)));
    setError(null);
    setMensaje(null);
  };

  const enviar = async () => {
    setError(null);
    setMensaje(null);
    setAvisos([]);
    const reglas: DelegationRule[] = [];
    for (const fila of filas) {
      const convertida = filaARegla(fila, accion);
      if ("error" in convertida) {
        setError(convertida.error);
        toast.error(convertida.error);
        return;
      }
      reglas.push(convertida);
    }
    try {
      const resultado = await guardar.mutateAsync({ accion, reglas });
      setBorrador(null);
      setAvisos(resultado.warnings ?? []);
      setMensaje(
        reglas.length === 0
          ? `Controles de ${config.etiqueta.toLowerCase()} guardados sin reglas: decide el permiso vigente.`
          : `Controles de ${config.etiqueta.toLowerCase()} guardados (${reglas.length} reglas).`,
      );
      toast.success("Controles de compras guardados");
    } catch (err) {
      // Traslapes o alcance inválido llegan aquí con el mensaje del servidor y
      // el borrador sigue en pantalla para corregirlo sin volver a escribirlo.
      setError(err instanceof Error ? err.message : "Error al guardar los controles");
      toast.error(err instanceof Error ? err.message : "Error al guardar los controles");
    }
  };

  if (consulta.isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Cargando controles…
      </div>
    );
  }

  if (consulta.error instanceof Error) {
    return (
      <Alert variant="destructive">
        <TriangleAlert className="h-4 w-4" />
        <AlertDescription>
          {consulta.error.message}
          <Button variant="outline" size="sm" className="ml-2" onClick={() => void consulta.refetch()}>
            Reintentar controles
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{config.ayuda}</p>
      <p className="text-xs text-muted-foreground">
        Hoy: {consulta.data?.[accion]?.descripcion ?? "Sin controles: decide el permiso de inventario vigente."}
      </p>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertDescription role="alert">{error}</AlertDescription>
        </Alert>
      )}
      {mensaje && (
        <p role="status" className="text-sm text-muted-foreground">
          {mensaje}
        </p>
      )}
      {avisos.length > 0 && (
        <Alert>
          <TriangleAlert className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc pl-4 space-y-0.5">
              {avisos.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
            <p className="mt-1">Se guardaron igual: son avisos, no errores.</p>
          </AlertDescription>
        </Alert>
      )}

      {filas.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Sin reglas para {config.etiqueta.toLowerCase()}. Mientras no agregues ninguna, decide el
          permiso de inventario vigente — no es una puerta abierta, es ausencia de política.
        </p>
      )}

      <fieldset className="space-y-2" disabled={guardar.isPending}>
        {filas.map((fila, indice) => (
          <div
            key={indice}
            className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center rounded-lg border border-border/60 p-2"
          >
            <Select
              value={fila.scope}
              onValueChange={(v) => editar(indice, { scope: v as DelegationScope })}
            >
              <SelectTrigger
                aria-label={`Regla ${indice + 1}: alcance`}
                className="md:col-span-3"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALCANCES.map((a) => (
                  <SelectItem key={a.valor} value={a.valor}>
                    {a.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {fila.scope === "BRANCH" && (
              <Select value={fila.branchId} onValueChange={(v) => editar(indice, { branchId: v })}>
                <SelectTrigger
                  aria-label={`Regla ${indice + 1}: sucursal`}
                  className="md:col-span-3"
                >
                  <SelectValue placeholder="Elige la sucursal" />
                </SelectTrigger>
                <SelectContent>
                  {(sucursales.data ?? []).map((b: { id: string; name: string }) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {fila.scope === "CATEGORY" && (
              <Input
                aria-label={`Regla ${indice + 1}: categoría`}
                value={fila.category}
                onChange={(e) => editar(indice, { category: e.target.value })}
                placeholder="Ej. Abarrotes"
                className="md:col-span-3"
              />
            )}

            <Select
              value={fila.requiredRole}
              onValueChange={(v) => editar(indice, { requiredRole: v })}
            >
              <SelectTrigger
                aria-label={`Regla ${indice + 1}: rol`}
                className="md:col-span-3"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((rol) => (
                  <SelectItem key={rol} value={rol}>
                    {rol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center justify-between gap-2 md:col-span-2">
              <Switch
                checked={fila.active}
                onCheckedChange={(v) => editar(indice, { active: v })}
                aria-label={`Regla ${indice + 1}: activa`}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setBorrador(filas.filter((_, i) => i !== indice));
                  setError(null);
                  setMensaje(null);
                }}
                aria-label={`Quitar regla ${indice + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </fieldset>

      <div className="flex flex-wrap gap-2 pt-2 border-t">
        <Button
          variant="outline"
          size="sm"
          disabled={guardar.isPending}
          onClick={() => {
            setBorrador([...filas, { ...FILA_VACIA }]);
            setError(null);
            setMensaje(null);
          }}
        >
          <Plus className="h-4 w-4 mr-1.5" /> Agregar regla
        </Button>
        {borrador !== null && (
          <Button
            variant="ghost"
            size="sm"
            disabled={guardar.isPending}
            onClick={() => {
              setBorrador(null);
              setError(null);
              setMensaje(null);
              setAvisos([]);
            }}
          >
            Descartar cambios
          </Button>
        )}
        <div className="ml-auto">
          <Button size="sm" onClick={enviar} disabled={guardar.isPending || borrador === null}>
            {guardar.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            Guardar controles de {config.etiqueta.toLowerCase()}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Sección de Configuración operativa que edita los controles de C16.2. El
 * catálogo la declara `aplicada` con su consumidor (`evaluarDelegacion`); el
 * distintivo sale de ahí para que la interfaz no tenga su propia verdad.
 */
export function PurchasingDelegationSection() {
  return (
    <section aria-labelledby="purchasing-delegation-title">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              <h2 id="purchasing-delegation-title" className="text-base font-semibold">
                Quién solicita y quién emite
              </h2>
            </CardTitle>
            <Badge
              variant="secondary"
              className="shrink-0 gap-1 bg-primary/15 py-0 px-1.5 text-xs font-normal tracking-tight text-primary"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              Se aplica hoy
            </Badge>
          </div>
          <CardDescription>
            Elige qué rol puede <strong>solicitar</strong> una compra y cuál puede{" "}
            <strong>emitirla</strong> al proveedor, por empresa, sucursal o categoría. Sólo un
            administrador o un rol superior puede editarlo.
          </CardDescription>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>
              La modalidad de compras de arriba describe cómo organiza el grupo y no concede
              permisos: no cambia esta tabla. Aprobar sigue siendo responsabilidad de la matriz de
              la sección anterior, y el presupuesto, el tope de emergencias y la separación entre
              solicitante y aprobador siguen aplicando igual.
            </span>
          </p>
        </CardHeader>
        <CardContent className="space-y-8">
          {ACCIONES.map((accion) => (
            <div key={accion.valor} className="space-y-2">
              <h3 className="text-sm font-semibold">{accion.etiqueta}</h3>
              <EditorDeAccion accion={accion.valor} />
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
