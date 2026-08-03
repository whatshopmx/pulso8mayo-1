"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Plus } from "lucide-react";

interface SalesCutUploadProps {
  branches: { id: string; name: string }[];
  onSuccess?: () => void;
  onUploadSuccess?: () => void;
}

export function SalesCutUpload({ branches, onSuccess, onUploadSuccess }: SalesCutUploadProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [isManual, setIsManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [branchId, setBranchId] = useState<string>("");
  const [shift, setShift] = useState<"MATUTINO" | "VESPERTINO" | "COMPLETO">("MATUTINO");
  const [businessDate, setBusinessDate] = useState<string>(
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" })
  );

  // Manual form fields
  const [totalSales, setTotalSales] = useState<string>("");
  const [cashSales, setCashSales] = useState<string>("");
  const [cardSales, setCardSales] = useState<string>("");
  const [otherPayments, setOtherPayments] = useState<string>("");
  const [ticketCount, setTicketCount] = useState<string>("");

  const resetForm = () => {
    setFile(null);
    setBranchId(branches[0]?.id || "");
    setShift("MATUTINO");
    setBusinessDate(new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }));
    setTotalSales("");
    setCashSales("");
    setCardSales("");
    setOtherPayments("");
    setTicketCount("");
  };

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
        // Manual entry (POST to /api/sales/cuts)
        const total = parseFloat(totalSales);
        if (isNaN(total) || total <= 0) {
          toast({ title: "Error", description: "La venta total debe ser mayor a 0", variant: "destructive" });
          setLoading(false);
          return;
        }

        const cashVal = cashSales ? parseFloat(cashSales) : null;
        const cardVal = cardSales ? parseFloat(cardSales) : null;
        const otherVal = otherPayments ? parseFloat(otherPayments) : null;
        const ticketsVal = ticketCount ? parseInt(ticketCount, 10) : null;

        const body = {
          branchId,
          businessDate,
          shift,
          channel: "TOTAL",
          totalSales: Math.round(total * 100), // in cents
          cashSales: cashVal !== null ? Math.round(cashVal * 100) : null,
          cardSales: cardVal !== null ? Math.round(cardVal * 100) : null,
          otherPayments: otherVal !== null ? Math.round(otherVal * 100) : null,
          ticketCount: ticketsVal && !isNaN(ticketsVal) ? ticketsVal : null,
        };

        const res = await fetch("/api/sales/cuts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error?.message || data.error || "Error al guardar el corte");
        }

        toast({
          title: data.data.status === "PENDING_REVIEW" ? "Corte guardado con observaciones" : "Corte guardado exitosamente",
          description: data.data.status === "PENDING_REVIEW" 
            ? `Corte guardado pero con observaciones: ${data.data.validationNotes}`
            : "El corte manual ha sido registrado exitosamente.",
        });

        if (onSuccess) onSuccess();
        if (onUploadSuccess) onUploadSuccess();
        setOpen(false);
      } else {
        // File upload (POST to /api/sales/cuts/upload)
        if (!file) {
          toast({ title: "Error", description: "Selecciona un archivo (.xlsx o .csv)", variant: "destructive" });
          setLoading(false);
          return;
        }

        const formData = new FormData();
        formData.append("file", file);
        formData.append("branchId", branchId);
        formData.append("shift", shift);
        if (businessDate) {
          formData.append("businessDate", businessDate);
        }

        const res = await fetch("/api/sales/cuts/upload", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error?.message || data.error || "Error al procesar el archivo");
        }

        toast({
          title: data.data.status === "PENDING_REVIEW" ? "Corte cargado con observaciones" : "Corte cargado exitosamente",
          description: data.data.status === "PENDING_REVIEW" 
            ? `El corte fue cargado pero quedó PENDIENTE DE REVISIÓN: ${data.data.validationNotes || ""}`
            : `Corte procesado con éxito. Canales ingestados: ${data.data.cuts?.map((c: { channel: string }) => c.channel).join(", ")}`,
        });

        if (onSuccess) onSuccess();
        if (onUploadSuccess) onUploadSuccess();
        setOpen(false);
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
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Registrar Corte de Ventas
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Registrar Corte de Caja</DialogTitle>
          <DialogDescription>
            Carga el reporte de tu POS (.xlsx o .csv) o ingresa los totales manualmente.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-2 p-1 bg-muted rounded-md mb-2">
            <Button
              type="button"
              variant={!isManual ? "secondary" : "ghost"}
              className="flex-1 text-sm py-1 h-8"
              onClick={() => setIsManual(false)}
            >
              Carga de Archivo POS
            </Button>
            <Button
              type="button"
              variant={isManual ? "secondary" : "ghost"}
              className="flex-1 text-sm py-1 h-8"
              onClick={() => setIsManual(true)}
            >
              Registro Manual
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
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
            <div className="space-y-1">
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
          </div>

          <div className="space-y-1">
            <Label htmlFor="date">Fecha Operativa</Label>
            <Input
              type="date"
              id="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
            />
          </div>

          {!isManual ? (
            <div className="space-y-2 border-2 border-dashed border-muted rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:border-primary/50 transition">
              <input
                type="file"
                accept=".xlsx,.xls,.xlsm,.csv,.txt"
                id="file-input"
                className="hidden"
                onChange={handleFileChange}
              />
              <label htmlFor="file-input" className="w-full h-full flex flex-col items-center justify-center cursor-pointer space-y-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {file ? file.name : "Selecciona o arrastra el reporte del POS"}
                </span>
                <span className="text-xs text-muted-foreground">
                  Formatos soportados: Excel (.xlsx, .xlsm) y CSV
                </span>
              </label>
            </div>
          ) : (
            <div className="space-y-3 p-3 bg-muted/40 rounded-lg border">
              <div className="space-y-1">
                <Label htmlFor="totalSales">Venta Total (MXN)*</Label>
                <Input
                  type="number"
                  step="0.01"
                  id="totalSales"
                  placeholder="0.00"
                  value={totalSales}
                  onChange={(e) => setTotalSales(e.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="cashSales" className="text-xs">Efectivo (MXN)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    id="cashSales"
                    placeholder="0.00"
                    value={cashSales}
                    onChange={(e) => setCashSales(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cardSales" className="text-xs">Tarjeta (MXN)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    id="cardSales"
                    placeholder="0.00"
                    value={cardSales}
                    onChange={(e) => setCardSales(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="otherPayments" className="text-xs">Otros (MXN)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    id="otherPayments"
                    placeholder="0.00"
                    value={otherPayments}
                    onChange={(e) => setOtherPayments(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="ticketCount">Número de Tickets</Label>
                <Input
                  type="number"
                  id="ticketCount"
                  placeholder="Ej. 120"
                  value={ticketCount}
                  onChange={(e) => setTicketCount(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {!isManual ? "Subir y Procesar" : "Registrar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
