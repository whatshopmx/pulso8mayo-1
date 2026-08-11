"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { addBatch, recordUsage } from "@/app/actions/inventory-transactions";
import { format } from "date-fns";
import { PackagePlus, MinusCircle, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { formatQty } from "@/lib/utils";

interface Props {
  item: any;
  batches: any[];
  movements: any[];
  priceHistory: any[];
  totalStock: number;
  branchId: string;
}

const STATUS_TRANSLATIONS: Record<string, string> = {
  AVAILABLE: "Disponible",
  EXPIRED: "Vencido",
  QUARANTINE: "Cuarentena",
};

const MOVEMENT_TRANSLATIONS: Record<string, string> = {
  RECEIVE: "Recepción",
  USAGE: "Consumo/Uso",
  WASTE: "Merma",
  ADJUSTMENT: "Ajuste",
  TRANSFER_IN: "Transf. Entrada",
  TRANSFER_OUT: "Transf. Salida",
};

export function StockManager({ item, batches, movements, priceHistory, totalStock }: Props) {
    const [isReceiveOpen, setIsReceiveOpen] = useState(false);
    const [isUsageOpen, setIsUsageOpen] = useState(false);

    return (
        <div className="space-y-6">
            {/* Header Stats */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Stock Total</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalStock} {item.unit}</div>
                        <p className="text-xs text-muted-foreground">
                            En esta sucursal
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Lotes Activos</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{batches.filter(b => b.status === 'AVAILABLE').length}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
                <Dialog open={isReceiveOpen} onOpenChange={setIsReceiveOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <PackagePlus className="w-4 h-4 mr-2" />
                            Recibir Stock
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Recibir Inventario</DialogTitle>
                        </DialogHeader>
                        <form action={async (formData) => {
                            await addBatch(item.id, formData);
                            setIsReceiveOpen(false);
                        }} className="space-y-4">
                            <div className="space-y-2">
                                <Label>Cantidad ({item.unit})</Label>
                                <Input type="number" name="quantity" required min="1" />
                            </div>
                            <div className="space-y-2">
                                <Label>Número de Lote</Label>
                                <Input name="lotNumber" placeholder="L-2024-001" />
                            </div>
                            <div className="space-y-2">
                                <Label>Fecha de Caducidad</Label>
                                <Input type="date" name="expirationDate" />
                            </div>
                            <Button type="submit" className="w-full">Guardar Entrada</Button>
                        </form>
                    </DialogContent>
                </Dialog>

                <Dialog open={isUsageOpen} onOpenChange={setIsUsageOpen}>
                    <DialogTrigger asChild>
                        <Button variant="secondary">
                            <MinusCircle className="w-4 h-4 mr-2" />
                            Registrar Uso/Merma
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Registrar Salida</DialogTitle>
                        </DialogHeader>
                        <form action={async (formData) => {
                            await recordUsage(item.id, formData);
                            setIsUsageOpen(false);
                        }} className="space-y-4">
                            <div className="space-y-2">
                                <Label>Lote (Opcional)</Label>
                                <select name="batchId" className="w-full border rounded p-2 text-sm bg-background">
                                    <option value="">Cualquiera / FIFO</option>
                                    {batches.filter(b => b.status === 'AVAILABLE').map(b => (
                                        <option key={b.id} value={b.id}>
                                            {b.lotNumber} (Q: {formatQty(b.currentQuantity)}) - Exp: {b.expirationDate ? format(b.expirationDate, 'dd/MM/yyyy') : 'N/A'}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <Label>Cantidad a descontar ({item.unit})</Label>
                                <Input type="number" name="quantity" required min="1" max={totalStock} />
                            </div>
                            <div className="space-y-2">
                                <Label>Motivo</Label>
                                <Input name="reason" placeholder="Producción, Merma, etc." />
                            </div>
                            <Button type="submit" variant="destructive" className="w-full">Registrar Salida</Button>
                        </form>
</DialogContent>
      </Dialog>

      <Link href={`/dashboard/inventory/waste?item=${item.id}`}>
        <Button variant="outline" className="border-amber-200 hover:bg-amber-50 hover:text-amber-900">
          <AlertTriangle className="w-4 h-4 mr-2 text-amber-600" />
          Registrar Merma
        </Button>
      </Link>
    </div>

    <Tabs defaultValue="batches" className="w-full">
                <TabsList>
                    <TabsTrigger value="batches">Lotes</TabsTrigger>
                    <TabsTrigger value="movements">Historial de Movimientos</TabsTrigger>
                    <TabsTrigger value="prices">Historial de Costos</TabsTrigger>
                </TabsList>

                <TabsContent value="batches">
                    <Card>
                        <CardHeader><CardTitle>Lotes en Inventario</CardTitle></CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Lote</TableHead>
                                        <TableHead>Cantidad Actual</TableHead>
                                        <TableHead>Ingreso</TableHead>
                                        <TableHead>Caducidad</TableHead>
                                        <TableHead>Estado</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {batches.map((batch) => (
                                        <TableRow key={batch.id}>
                                            <TableCell className="font-medium">{batch.lotNumber || 'Sin Lote'}</TableCell>
                                            <TableCell>{formatQty(batch.currentQuantity)} {item.unit}</TableCell>
                                            <TableCell>{batch.receivedAt ? format(new Date(batch.receivedAt), 'dd/MM/yyyy') : '-'}</TableCell>
                                            <TableCell>{batch.expirationDate ? format(new Date(batch.expirationDate), 'dd/MM/yyyy') : '-'}</TableCell>
                                            <TableCell>
                                                <Badge variant={batch.status === 'AVAILABLE' ? 'default' : 'destructive'}>
                                                    {STATUS_TRANSLATIONS[batch.status] || batch.status}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {batches.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center text-muted-foreground">
                                                No hay lotes registrados.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="movements">
                    <Card>
                        <CardHeader><CardTitle>Últimos Movimientos</CardTitle></CardHeader>
                        <CardContent>
                            {/* Placeholder for movement history - needs to be passed in or fetched */}
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Tipo</TableHead>
                                        <TableHead>Cambio</TableHead>
                                        <TableHead>Motivo</TableHead>
                                        <TableHead>Usuario</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {movements.map((mov) => (
                                        <TableRow key={mov.id}>
                                            <TableCell>{format(new Date(mov.timestamp), "dd/MM/yyyy HH:mm")}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline">{MOVEMENT_TRANSLATIONS[mov.type] || mov.type}</Badge>
                                            </TableCell>
                                            <TableCell className={mov.quantityChange > 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                                                {mov.quantityChange > 0 ? "+" : ""}{formatQty(mov.quantityChange)}
                                            </TableCell>
                                            <TableCell>{mov.reason || "-"}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground truncate max-w-[100px]">{mov.performedBy}</TableCell>
                                        </TableRow>
                                    ))}
                                    {movements.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center text-muted-foreground p-4">
                                                No hay movimientos registrados.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="prices">
                    <Card>
                        <CardHeader><CardTitle>Historial de Precios / Costos</CardTitle></CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Costo Anterior</TableHead>
                                        <TableHead>Nuevo Costo</TableHead>
                                        <TableHead>Modificado Por</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {priceHistory.map((ph, idx) => (
                                        <TableRow key={ph.id || idx}>
                                            <TableCell>{format(new Date(ph.changedAt), "dd/MM/yyyy HH:mm")}</TableCell>
                                            <TableCell>
                                                {ph.previousCost ? `$${(ph.previousCost / 100).toFixed(2)}` : "-"}
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                ${(ph.newCost / 100).toFixed(2)}
                                            </TableCell>
                                            <TableCell>{ph.changedByName || "Desconocido"}</TableCell>
                                        </TableRow>
                                    ))}
                                    {priceHistory.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={4} className="text-center text-muted-foreground">
                                                No hay historial de cambios de precio.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
