"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FiscalInvoiceValidator } from "@/components/finance/fiscal-invoice-validator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { statusBadgeClasses } from "@/lib/utils";
import { Receipt, FileText, AlertCircle, Loader2, CheckCircle } from "lucide-react";

interface TimbradoResult {
  uuid: string;
  status: string;
  cadenaOriginal: string;
  selloDigital: string;
  fechaTimbrado: string;
}

const EMPTY_NOMINA_FORM = {
  empleadoRfc: "",
  empleadoNombre: "",
  empleadoCurp: "",
  periodo: "",
  // Montos en pesos como texto crudo: convertir a centavos en cada tecla
  // impedía escribir decimales ("10." se volvía "10").
  totalPercepciones: "",
  totalDeducciones: "",
};

/**
 * Cómo se pinta cada estado del PAC.
 *
 * La pantalla afirmaba "TIMBRADO" fijo con el badge verde, sin mirar la
 * respuesta: un rechazo del SAT se veía idéntico a un comprobante válido. El
 * estado lo dice el PAC (`fiscal-service.mapPacStatus`), no la UI.
 */
const ESTADO_TIMBRADO: Record<
  string,
  { etiqueta: string; tono: "success" | "warning" | "destructive"; titulo: string }
> = {
  TIMBRADO: { etiqueta: "TIMBRADO", tono: "success", titulo: "Timbrado exitoso" },
  PENDIENTE: {
    etiqueta: "PENDIENTE",
    tono: "warning",
    titulo: "El PAC aún no confirma el timbre",
  },
  RECHAZADO: { etiqueta: "RECHAZADO", tono: "destructive", titulo: "El SAT rechazó el comprobante" },
  ERROR: { etiqueta: "ERROR", tono: "destructive", titulo: "El timbrado falló" },
};

function presentacionDe(status: string) {
  return (
    ESTADO_TIMBRADO[status] ?? {
      etiqueta: status || "DESCONOCIDO",
      tono: "warning" as const,
      titulo: "Estado no reconocido del comprobante",
    }
  );
}

/** Pesos escritos por el usuario → centavos enteros. Devuelve 0 si no es un número. */
function pesosToCents(raw: string): number {
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export default function FiscalPage() {
  const [nominaForm, setNominaForm] = useState(EMPTY_NOMINA_FORM);
  const [timbrando, setTimbrando] = useState(false);
  const [timbradoResult, setTimbradoResult] = useState<TimbradoResult | null>(null);
  const [timbradoError, setTimbradoError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** Timbrado que ya existía para este RFC y período, recuperado del servidor. */
  const [timbradoPrevio, setTimbradoPrevio] = useState<TimbradoResult | null>(null);
  const [buscandoPrevio, setBuscandoPrevio] = useState(false);

  const percepcionesCents = pesosToCents(nominaForm.totalPercepciones);
  const deduccionesCents = pesosToCents(nominaForm.totalDeducciones);

  const rfc = nominaForm.empleadoRfc.trim();
  const periodo = nominaForm.periodo.trim();

  // El comprobante ya no vive sólo en el estado de React: al escribir RFC y
  // período se pregunta al servidor si ese par ya está timbrado. Es lo que hace
  // que recargar la página no borre el comprobante y que no se ofrezca gastar
  // otro folio por algo que ya se timbró.
  useEffect(() => {
    if (!rfc || !periodo) {
      setTimbradoPrevio(null);
      return;
    }

    // Debounce + AbortController: se teclea letra por letra, y sin cancelar la
    // anterior una respuesta lenta puede pisar a una más nueva.
    const control = new AbortController();
    const timer = setTimeout(async () => {
      setBuscandoPrevio(true);
      try {
        const res = await fetch(
          `/api/finance/fiscal/timbrar-nomina?empleadoRfc=${encodeURIComponent(rfc)}&periodo=${encodeURIComponent(periodo)}`,
          { signal: control.signal }
        );
        const json = await res.json();
        if (res.ok && json.success) setTimbradoPrevio(json.data ?? null);
      } catch (err) {
        // Un abort es lo normal al seguir tecleando, no un fallo que reportar.
        if ((err as Error)?.name !== "AbortError") {
          console.error("No se pudo consultar el timbrado previo:", err);
        }
      } finally {
        if (!control.signal.aborted) setBuscandoPrevio(false);
      }
    }, 400);

    return () => {
      control.abort();
      clearTimeout(timer);
    };
  }, [rfc, periodo]);

  /** El comprobante a mostrar: el recién timbrado o el que ya existía. */
  const comprobante = timbradoResult ?? timbradoPrevio;
  /** Sólo un timbrado válido cierra el período; un rechazo se puede reintentar. */
  const yaTimbrado = comprobante?.status === "TIMBRADO";

  // Un timbrado exitoso consume un folio ante el SAT y solo se revierte con una
  // cancelación formal: el formulario queda bloqueado hasta que se pida
  // explícitamente uno nuevo, para que un segundo clic no lo duplique.
  const isLocked = yaTimbrado;

  const canTimbrar =
    !timbrando &&
    !isLocked &&
    !buscandoPrevio &&
    rfc !== "" &&
    nominaForm.empleadoNombre.trim() !== "" &&
    periodo !== "" &&
    percepcionesCents > 0;

  const handleNominaChange = (field: keyof typeof EMPTY_NOMINA_FORM, value: string) => {
    setNominaForm((prev) => ({ ...prev, [field]: value }));
    setTimbradoError(null);
    // Un rechazo deja el formulario abierto para reintentar (a diferencia de un
    // timbre válido, que lo bloquea). Si no se limpia aquí, al cambiar de RFC o
    // período seguiría en pantalla el resultado del comprobante anterior.
    setTimbradoResult(null);
  };

  const resetNominaForm = () => {
    setNominaForm(EMPTY_NOMINA_FORM);
    setTimbradoResult(null);
    setTimbradoPrevio(null);
    setTimbradoError(null);
  };

  const handleTimbrar = async () => {
    setConfirmOpen(false);
    setTimbrando(true);
    setTimbradoError(null);
    setTimbradoResult(null);
    try {
      const res = await fetch("/api/finance/fiscal/timbrar-nomina", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...nominaForm,
          totalPercepciones: percepcionesCents,
          totalDeducciones: deduccionesCents,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setTimbradoResult(json.data);
      } else {
        setTimbradoError(json?.error || "Error al timbrar la nómina.");
      }
    } catch (err) {
      console.error("Timbrar nomina error:", err);
      setTimbradoError("Error de conexión al timbrar la nómina.");
    } finally {
      setTimbrando(false);
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Receipt className="h-7 w-7 text-primary" /> Fiscal y Facturación
        </h1>
        <p className="text-sm text-muted-foreground">
          Validación de facturas CFDI ante el SAT y timbrado de nómina vía FiscalAPI.
        </p>
      </div>

      <Tabs defaultValue="validar" className="space-y-4">
        <TabsList>
          <TabsTrigger value="validar" className="gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Validar Factura
          </TabsTrigger>
          <TabsTrigger value="nomina" className="gap-1.5">
            <Receipt className="w-3.5 h-3.5" />
            Timbrado Nómina
          </TabsTrigger>
        </TabsList>

        <TabsContent value="validar">
          <FiscalInvoiceValidator />
        </TabsContent>

        <TabsContent value="nomina">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Receipt className="w-4 h-4" />
                Timbrar CFDI de Nómina
              </CardTitle>
              <CardDescription className="text-xs">
                Genera el timbrado fiscal de un comprobante de nómina. Requiere FiscalAPI configurado.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* `htmlFor`/`id` en los cuatro: dos de los seis campos ya lo tenían y
                    cuatro no, dentro de la misma tarjeta. */}
                <div className="space-y-1.5">
                  <Label htmlFor="nomina-rfc" className="text-xs">RFC del Empleado</Label>
                  <Input
                    id="nomina-rfc"
                    className="h-8 text-xs"
                    disabled={isLocked}
                    placeholder="Ej: XAXX010101000"
                    value={nominaForm.empleadoRfc}
                    onChange={(e) => handleNominaChange("empleadoRfc", e.target.value.toUpperCase())}
                    maxLength={13}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nomina-nombre" className="text-xs">Nombre del Empleado</Label>
                  <Input
                    id="nomina-nombre"
                    className="h-8 text-xs"
                    disabled={isLocked}
                    placeholder="Nombre completo"
                    value={nominaForm.empleadoNombre}
                    onChange={(e) => handleNominaChange("empleadoNombre", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nomina-curp" className="text-xs">CURP (opcional)</Label>
                  <Input
                    id="nomina-curp"
                    className="h-8 text-xs"
                    disabled={isLocked}
                    placeholder="CURP"
                    value={nominaForm.empleadoCurp}
                    onChange={(e) => handleNominaChange("empleadoCurp", e.target.value.toUpperCase())}
                    maxLength={18}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nomina-periodo" className="text-xs">Período</Label>
                  <Input
                    id="nomina-periodo"
                    className="h-8 text-xs"
                    disabled={isLocked}
                    placeholder="Ej: 2026-08-Q1"
                    value={nominaForm.periodo}
                    onChange={(e) => handleNominaChange("periodo", e.target.value)}
                    aria-describedby="nomina-periodo-help"
                  />
                  {/* La nómina en México corre por quincenas; un campo libre con
                      ejemplo mensual invitaba a capturar el período equivocado. */}
                  <p id="nomina-periodo-help" className="text-xs text-muted-foreground">
                    Quincena que se está pagando (Q1 = 1–15, Q2 = 16–fin de mes).
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="total-percepciones" className="text-xs">Total Percepciones ($ MXN)</Label>
                  <Input
                    id="total-percepciones"
                    className="h-8 text-xs"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={nominaForm.totalPercepciones}
                    disabled={isLocked}
                    onChange={(e) => handleNominaChange("totalPercepciones", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="total-deducciones" className="text-xs">Total Deducciones ($ MXN)</Label>
                  <Input
                    id="total-deducciones"
                    className="h-8 text-xs"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={nominaForm.totalDeducciones}
                    disabled={isLocked}
                    onChange={(e) => handleNominaChange("totalDeducciones", e.target.value)}
                  />
                </div>
              </div>

              {isLocked ? (
                <Button onClick={resetNominaForm} className="w-full" size="sm" variant="outline">
                  <Receipt className="w-4 h-4 mr-2" /> Timbrar otra nómina
                </Button>
              ) : (
                <Button
                  onClick={() => setConfirmOpen(true)}
                  disabled={!canTimbrar}
                  className="w-full"
                  size="sm"
                >
                  {timbrando ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Receipt className="w-4 h-4 mr-2" />
                  )}
                  {timbrando ? "Timbrando..." : "Timbrar Nómina"}
                </Button>
              )}

              {timbradoError && (
                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  {timbradoError}
                </div>
              )}

              {comprobante && (
                <div className="border rounded-md p-4 space-y-3 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">
                      {presentacionDe(comprobante.status).titulo}
                    </span>
                    <Badge
                      variant="outline"
                      className={`gap-1 ${statusBadgeClasses(presentacionDe(comprobante.status).tono)}`}
                    >
                      {comprobante.status === "TIMBRADO" ? (
                        <CheckCircle className="w-3 h-3" />
                      ) : (
                        <AlertCircle className="w-3 h-3" />
                      )}
                      {presentacionDe(comprobante.status).etiqueta}
                    </Badge>
                  </div>

                  {/* El período ya tenía comprobante antes de abrir la pantalla: se
                      avisa en vez de ofrecer gastar otro folio por lo mismo. */}
                  {!timbradoResult && yaTimbrado && (
                    <div className="text-xs text-muted-foreground">
                      Este período ya fue timbrado para este RFC. No hace falta volver a
                      timbrarlo: hacerlo consumiría otro folio por el mismo comprobante.
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">UUID: </span>
                      <span className="font-mono font-medium">{comprobante.uuid || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Fecha de Timbrado: </span>
                      <span>{new Date(comprobante.fechaTimbrado).toLocaleString("es-MX")}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Cadena Original: </span>
                      <span className="font-mono text-xs break-all">{comprobante.cadenaOriginal || "—"}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Timbrar presenta un comprobante ante el SAT y consume un folio; deshacerlo
          exige una cancelación formal. Es la acción menos reversible del módulo. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Timbrar este CFDI de nómina?</AlertDialogTitle>
            <AlertDialogDescription>
              El comprobante se presenta ante el SAT y consume un timbre. Revertirlo requiere una
              cancelación formal.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <dl className="rounded-md bg-muted/50 px-3 py-2 text-xs space-y-1">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Empleado</dt>
              <dd className="font-medium text-right">
                {nominaForm.empleadoNombre} ({nominaForm.empleadoRfc})
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Período</dt>
              <dd className="font-medium">{nominaForm.periodo}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Percepciones</dt>
              <dd className="font-semibold">
                {(percepcionesCents / 100).toLocaleString("es-MX", {
                  style: "currency",
                  currency: "MXN",
                })}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Deducciones</dt>
              <dd className="font-semibold">
                {(deduccionesCents / 100).toLocaleString("es-MX", {
                  style: "currency",
                  currency: "MXN",
                })}
              </dd>
            </div>
          </dl>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={timbrando}
              onClick={(e) => {
                e.preventDefault();
                handleTimbrar();
              }}
            >
              {timbrando ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Sí, timbrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
