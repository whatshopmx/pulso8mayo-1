"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageContainer } from "@/components/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, AlertTriangle, FileText } from "lucide-react";
import { toast } from "sonner";

interface Claim {
  claim: {
    id: string;
    claimNumber: string;
    status: string;
    type: string;
    description: string | null;
    totalAmount: number | null;
    resolution: string | null;
    resolvedBy: string | null;
    resolvedAt: string | null;
    createdAt: string;
    supplierId: string;
    invoiceId: string | null;
    branchId: string;
  };
  supplierName: string | null;
  invoiceFolio: string | null;
}

const statusColors: Record<string, string> = {
  OPEN: "bg-yellow-100 text-yellow-800 border-yellow-200",
  IN_PROGRESS: "bg-blue-100 text-blue-800 border-blue-200",
  RESOLVED: "bg-green-100 text-green-800 border-green-200",
  CLOSED: "bg-gray-100 text-gray-800 border-gray-200",
};

const typeLabels: Record<string, string> = {
  SHORTAGE: "Faltante",
  DAMAGE: "Daño",
  PRICE_DIFFERENCE: "Diferencia de Precio",
  QUALITY: "Calidad",
};

export default function ClaimsPage() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [newStatus, setNewStatus] = useState("");
  const [resolution, setResolution] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    loadClaims();
  }, []);

  const loadClaims = async () => {
    try {
      const res = await fetch("/api/inventory/claims");
      const data = await res.json();
      if (data.success) {
        setClaims(data.claims || []);
      }
    } catch {
      toast.error("Error al cargar reclamos");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedClaim || !newStatus) return;
    setIsUpdating(true);
    try {
      const res = await fetch(`/api/inventory/claims/${selectedClaim.claim.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, resolution: resolution || undefined }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      toast.success("Reclamo actualizado");
      setSelectedClaim(null);
      setNewStatus("");
      setResolution("");
      loadClaims();
    } catch (error: any) {
      toast.error(error.message || "Error al actualizar reclamo");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Reclamos a Proveedor"
        description="Gestiona reclamos por faltantes, daños, diferencias de precio o calidad"
      />

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : claims.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-sm">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
              <p>No hay reclamos registrados</p>
              <p className="text-xs mt-1">Los reclamos se generan automáticamente desde facturas con discrepancias.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reclamo</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Factura</TableHead>
                  <TableHead>Monto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Creado</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.map(({ claim, supplierName, invoiceFolio }) => (
                  <TableRow key={claim.id}>
                    <TableCell className="font-mono text-xs font-medium">{claim.claimNumber}</TableCell>
                    <TableCell>{supplierName || "—"}</TableCell>
                    <TableCell>{typeLabels[claim.type] || claim.type}</TableCell>
                    <TableCell className="font-mono text-xs">{invoiceFolio || "—"}</TableCell>
                    <TableCell>{claim.totalAmount ? `$${(claim.totalAmount / 100).toFixed(2)}` : "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColors[claim.status] || ""}>
                        {claim.status === "OPEN" ? "Abierto" : claim.status === "IN_PROGRESS" ? "En Proceso" : claim.status === "RESOLVED" ? "Resuelto" : "Cerrado"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(claim.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedClaim({ claim, supplierName, invoiceFolio });
                          setNewStatus(claim.status);
                          setResolution(claim.resolution || "");
                        }}
                      >
                        <FileText className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedClaim} onOpenChange={(open) => !open && setSelectedClaim(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reclamo {selectedClaim?.claim.claimNumber}</DialogTitle>
            <DialogDescription>
              {selectedClaim && typeLabels[selectedClaim.claim.type]} — {selectedClaim.supplierName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <p className="text-sm font-medium">Descripción</p>
              <p className="text-sm text-muted-foreground">{selectedClaim?.claim.description || "Sin descripción"}</p>
            </div>
            {selectedClaim?.claim.totalAmount && (
              <div>
                <p className="text-sm font-medium">Monto del reclamo</p>
                <p className="text-sm font-mono">${(selectedClaim.claim.totalAmount / 100).toFixed(2)}</p>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">Estado</label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPEN">Abierto</SelectItem>
                  <SelectItem value="IN_PROGRESS">En Proceso</SelectItem>
                  <SelectItem value="RESOLVED">Resuelto</SelectItem>
                  <SelectItem value="CLOSED">Cerrado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Resolución / Notas</label>
              <Textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Describe cómo se resolvió el reclamo..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedClaim(null)}>Cancelar</Button>
            <Button onClick={handleUpdate} disabled={isUpdating}>
              {isUpdating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Actualizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
