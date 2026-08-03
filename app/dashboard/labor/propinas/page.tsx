"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PropinasCalculator } from "@/components/labor/propinas-calculator";
import { Coins, CheckCircle, Clock, Loader2 } from "lucide-react";

interface Branch {
  id: string;
  name: string;
}

interface PropinaHistoryItem {
  id: string;
  branchId: string;
  branchName: string;
  businessDate: string;
  shift: string;
  totalPoolCents: number;
  distributedCents: number;
  status: "CALCULATED" | "DISBURSED";
  registeredByName: string | null;
  createdAt: string;
}

export default function PropinasPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("ALL");
  const [propinas, setPropinas] = useState<PropinaHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchBranches() {
      try {
        const res = await fetch("/api/branches");
        const data = await res.json();
        const list = data.data || data.branches || (Array.isArray(data) ? data : []);
        setBranches(list);
      } catch (err) {
        console.error("Error fetching branches:", err);
      }
    }
    fetchBranches();
  }, []);

  const fetchPropinas = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL("/api/propinas", window.location.origin);
      if (selectedBranch !== "ALL") {
        url.searchParams.set("branchId", selectedBranch);
      }
      const res = await fetch(url.toString());
      const data = await res.json();
      if (res.ok && data.success) {
        setPropinas(data.data || []);
      }
    } catch (err) {
      console.error("Error fetching propinas:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedBranch]);

  useEffect(() => {
    fetchPropinas();
  }, [fetchPropinas]);

  const formatMXN = (cents: number) =>
    (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Coins className="h-7 w-7 text-amber-600" /> Distribución de Propinas Auditable (T21)
          </h1>
          <p className="text-sm text-muted-foreground">
            Cálculo proporcional por horas trabajadas (LFT Art. 346), convirtiendo flujo informal en bitácora transparente.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-48">
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger>
                <SelectValue placeholder="Todas las sucursales" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas las sucursales</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <PropinasCalculator branches={branches} onSuccess={fetchPropinas} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">Bitácora de Distribuciones Registradas</CardTitle>
          <CardDescription className="text-xs">
            Historial de pozos repartidos por fecha, turno y sucursal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 flex justify-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando bitácora de propinas...
            </div>
          ) : propinas.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-xs">
              Sin distribuciones de propina registradas.
            </div>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 text-xs">
                    <TableHead>Fecha</TableHead>
                    <TableHead>Sucursal</TableHead>
                    <TableHead>Turno</TableHead>
                    <TableHead className="text-right">Pozo Total ($)</TableHead>
                    <TableHead className="text-right">Total Distribuido</TableHead>
                    <TableHead>Estatus</TableHead>
                    <TableHead>Registrado por</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {propinas.map((item) => (
                    <TableRow key={item.id} className="hover:bg-muted/40 transition text-xs">
                      <TableCell className="font-medium whitespace-nowrap">
                        {new Date(item.businessDate + "T00:00:00").toLocaleDateString("es-MX", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </TableCell>
                      <TableCell className="font-medium">{item.branchName}</TableCell>
                      <TableCell className="capitalize">{item.shift.toLowerCase()}</TableCell>
                      <TableCell className="text-right font-bold text-amber-700">
                        {formatMXN(item.totalPoolCents)}
                      </TableCell>
                      <TableCell className="text-right font-bold text-emerald-700">
                        {formatMXN(item.distributedCents)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1 text-[10px]">
                          <CheckCircle className="w-3 h-3" /> Calculado
                        </Badge>
                      </TableCell>
                      <TableCell>{item.registeredByName || "Gerente"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
