"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { formatCents } from "@/lib/utils";
import { computeCashVariance, cashVarianceToneClass } from "@/lib/sales/cash-variance";
import { Loader2, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";

function pesosToCents(raw: string): number | null {
  if (raw.trim() === "") return null;
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

interface Props {
  branches: { id: string; name: string }[];
}

export function SalesCutUploadPageClient({ branches }: Props) {
  const { toast } = useToast();
  const router = useRouter();
  
  const [isManual, setIsManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  
  const [branchId, setBranchId] = useState<string>(branches[0]?.id || "");
  const [shift, setShift] = useState<"MATUTINO" | "VESPERTINO" | "COMPLETO">("MATUTINO");
  const [businessDate, setBusinessDate] = useState<string>(
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" })
  );

  const [totalSales, setTotalSales] = useState<string>("");
  const [cashSales, setCashSales] = useState<string>("");
  const [cardSales, setCardSales] = useState<string>("");
  const [otherPayments, setOtherPayments] = useState<string>("");
  const [cashCounted, setCashCounted] = useState<string>("");
  const [ticketCount, setTicketCount] = useState<string>("");

  const totalCents = pesosToCents(totalSales);
  const cashCents = pesosToCents(cashSales);
  const cardCents = pesosToCents(cardSales);
  const otherCents = pesosToCents(otherPayments);
  const countedCents = pesosToCents(cashCounted);

  const anyPaymentEntered = cashCents !== null || cardCents !== null || otherCents !== null;
  const paymentsSum = (cashCents ?? 0) + (cardCents ?? 0) + (otherCents ?? 0);
  const paymentsGap = totalCents !== null && anyPaymentEntered ? paymentsSum - totalCents : null;
  const paymentsOutOfTolerance =
    totalCents !== null && paymentsGap !== null
      ? Math.abs(paymentsGap) > Math.round(totalCents * 0.02)
      : false;

  const arqueo = computeCashVariance({ cashSales: cashCents, cashCountedCents: countedCents });
  const arqueoMissing = cashCents !== null && cashCents > 0 && countedCents === null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId) {
      toast({ title: "Error", description: "Selecciona una sucursal", variant: "destructive" });
      return;
    }
    if (!businessDate) {
      toast({ title: "Error", description: "Selecciona una fecha operativa", variant: "destructive" });
      return;
    }

    setLoading(true);

    try {
      if (isManual) {
        if (totalCents === null || totalCents <= 0) {
          toast({ title: "Error", description: "La venta total debe ser mayor a 0", variant: "destructive" });
          setLoading(false);
          return;
        }

        if (arqueoMissing) {
          toast({
            title: "Falta el arqueo",
            description: "Captura el efectivo contado en caja cuando declaras ventas en efectivo.",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }

        const ticketsVal = ticketCount ? parseInt(ticketCount, 10) : null;
        const body = {
          branchId,
          businessDate,
          shift,
          channel: "TOTAL",
          totalSales: totalCents,
          cashSales: cashCents,
          cardSales: cardCents,
          otherPayments: otherCents,
          cashCountedCents: countedCents,
          ticketCount: ticketsVal && !isNaN(ticketsVal) ? ticketsVal : null,
        };

        const res = await fetch("/api/sales/cuts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || data.error || "Error al guardar el corte");

        toast({
          title: data.data.status === "PENDING_REVIEW" ? "Corte guardado con observaciones" : "Corte guardado exitosamente",
          description: data.data.status === "PENDING_REVIEW" 
            ? `Corte guardado pero con observaciones: ${data.data.validationNotes}`
            : "El corte manual ha sido registrado exitosamente.",
        });

        router.push("/dashboard/sales/cuts");
      } else {
        if (!file) {
          toast({ title: "Error", description: "Selecciona un archivo (.xlsx o .csv)", variant: "destructive" });
          setLoading(false);
          return;
        }

        const formData = new FormData();
        formData.append("file", file);
        formData.append("branchId", branchId);
        formData.append("shift", shift);
        if (businessDate) formData.append("businessDate", businessDate);

        const res = await fetch("/api/sales/cuts/upload", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || data.error || "Error al procesar el archivo");

        toast({
          title: data.data.status === "PENDING_REVIEW" ? "Corte cargado con observaciones" : "Corte cargado exitosamente",
          description: data.data.status === "PENDING_REVIEW" 
            ? `El corte fue cargado pero quedó PENDIENTE DE REVISIÓN: ${data.data.validationNotes || ""}`
            : `Corte procesado con éxito. Canales ingestados: ${data.data.cuts?.map((c: { channel: string }) => c.channel).join(", ")}`,
        });

        router.push("/dashboard/sales/cuts");
      }
    } catch (err: unknown) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : "Error al cargar el corte de ventas";
      toast({
        title: "Error de Ingesta",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8 bg-card border rounded-xl p-8 shadow-sm">
      <div className="flex gap-2 p-1 bg-muted rounded-md mb-2 max-w-sm">
        <Button
          type="button"
          variant={!isManual ? "secondary" : "ghost"}
          className="flex-1 text-sm py-1 h-10"
          onClick={() => setIsManual(false)}
        >
          Carga de Archivo POS
        </Button>
        <Button
          type="button"
          variant={isManual ? "secondary" : "ghost"}
          className="flex-1 text-sm py-1 h-10"
          onClick={() => setIsManual(true)}
        >
          Registro Manual
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-1.5">
          <Label htmlFor="branch">Sucursal</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger id="branch">
              <SelectValue placeholder="Selecciona..." />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="shift">Turno</Label>
          <Select value={shift} onValueChange={(v) => setShift(v as "MATUTINO" | "VESPERTINO" | "COMPLETO")}>
            <SelectTrigger id="shift">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MATUTINO">Matutino</SelectItem>
              <SelectItem value="VESPERTINO">Vespertino</SelectItem>
              <SelectItem value="COMPLETO">Completo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="date">Fecha Operativa</Label>
          <Input
            type="date"
            id="date"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
          />
        </div>
      </div>

      {!isManual ? (
        <div className="space-y-4">
          <Label>Archivo de Ventas (Excel o CSV)</Label>
          <div className="border-2 border-dashed border-muted rounded-xl p-12 flex flex-col items-center justify-center text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition bg-muted/10 group">
            <input
              type="file"
              accept=".xlsx,.xls,.xlsm,.csv,.txt"
              id="file-input"
              className="hidden"
              onChange={handleFileChange}
            />
            <label htmlFor="file-input" className="w-full h-full flex flex-col items-center justify-center cursor-pointer space-y-4">
              <div className="p-4 rounded-full bg-background border shadow-sm group-hover:scale-105 transition-transform duration-300">
                <Upload className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <span className="text-base font-semibold block text-foreground">
                  {file ? file.name : "Selecciona o arrastra el reporte del POS aquí"}
                </span>
                <span className="text-sm text-muted-foreground block">
                  Formatos soportados: Excel (.xlsx, .xlsm) y CSV
                </span>
              </div>
            </label>
          </div>
        </div>
      ) : (
        <div className="space-y-6 p-6 bg-muted/30 rounded-xl border">
          <h3 className="font-semibold text-lg border-b pb-2">Desglose de Ventas</h3>
          <div className="space-y-2">
            <Label htmlFor="totalSales" className="text-base">Venta Total (MXN)*</Label>
            <Input
              type="number"
              step="0.01"
              id="totalSales"
              placeholder="0.00"
              className="text-lg h-12 font-medium bg-background"
              value={totalSales}
              onChange={(e) => setTotalSales(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            <div className="space-y-2">
              <Label htmlFor="cashSales">Efectivo (MXN)</Label>
              <Input
                type="number"
                step="0.01"
                id="cashSales"
                placeholder="0.00"
                className="bg-background"
                value={cashSales}
                onChange={(e) => setCashSales(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cardSales">Tarjeta (MXN)</Label>
              <Input
                type="number"
                step="0.01"
                id="cardSales"
                placeholder="0.00"
                className="bg-background"
                value={cardSales}
                onChange={(e) => setCardSales(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="otherPayments">Otros (MXN)</Label>
              <Input
                type="number"
                step="0.01"
                id="otherPayments"
                placeholder="0.00"
                className="bg-background"
                value={otherPayments}
                onChange={(e) => setOtherPayments(e.target.value)}
              />
            </div>
          </div>

          {paymentsGap !== null && (
            <div className={`p-4 rounded-lg border ${paymentsOutOfTolerance ? 'bg-destructive/10 border-destructive/20 text-destructive' : 'bg-muted border-border text-muted-foreground'}`}>
              <p className="flex items-start gap-2 text-sm font-medium">
                {paymentsOutOfTolerance ? (
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 shrink-0 text-success" />
                )}
                <span>
                  Formas de pago:{" "}
                  <span className="font-semibold tabular-nums">{formatCents(paymentsSum)}</span> vs.
                  total <span className="font-semibold tabular-nums">{formatCents(totalCents ?? 0)}</span>
                  {paymentsGap !== 0 && (
                    <>
                      {" "}·{" "}
                      <span className="font-semibold tabular-nums">
                        {paymentsGap > 0 ? "+" : ""}
                        {formatCents(paymentsGap)}
                      </span>
                    </>
                  )}
                  {paymentsOutOfTolerance && " — las formas de pago no cuadran con el total."}
                </span>
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t">
            <div className="space-y-2">
              <Label htmlFor="cashCounted" className="font-semibold">Efectivo contado en caja (MXN)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                id="cashCounted"
                placeholder="0.00"
                className="bg-background"
                value={cashCounted}
                onChange={(e) => setCashCounted(e.target.value)}
                aria-describedby="cashCounted-help"
              />
              <p id="cashCounted-help" className="text-xs text-muted-foreground">
                El dinero que realmente hay en la caja al cerrar.
              </p>
              
              <div className="mt-2 min-h-[40px]">
                {arqueoMissing && (
                  <p className="flex items-start gap-1.5 text-sm font-medium text-destructive">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                    Declaraste ventas en efectivo. Captura el efectivo contado.
                  </p>
                )}
                {arqueo && (
                  <p className={`text-sm font-semibold flex items-center gap-1.5 ${cashVarianceToneClass(arqueo.direction)}`}>
                    {arqueo.direction === "cuadrado"
                      ? <><CheckCircle2 className="w-4 h-4" /> Caja cuadrada.</>
                      : `${arqueo.direction === "faltante" ? "Faltan" : "Sobran"} ${formatCents(Math.abs(arqueo.varianceCents))} respecto al declarado.`}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ticketCount">Número de Tickets</Label>
              <Input
                type="number"
                id="ticketCount"
                placeholder="Ej. 120"
                className="bg-background"
                value={ticketCount}
                onChange={(e) => setTicketCount(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-6 border-t">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={loading}>
          Cancelar
        </Button>
        <Button type="submit" size="lg" className="px-8 font-semibold" disabled={loading || (isManual && arqueoMissing)}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {!isManual ? "Subir Reporte y Procesar" : "Guardar Corte Manual"}
        </Button>
      </div>
    </form>
  );
}
