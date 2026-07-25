"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRightLeft, Loader2 } from "lucide-react";

interface Conversion {
  id: string;
  fromUnit: string;
  toUnit: string;
  factor: number;
  description?: string | null;
}

export function UnitConversionCalculator() {
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromUnit, setFromUnit] = useState("");
  const [toUnit, setToUnit] = useState("");
  const [quantity, setQuantity] = useState("");
  const [result, setResult] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/inventory/conversions")
      .then((res) => res.json())
      .then((data) => {
        setConversions(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const uniqueUnits = [...new Set(conversions.flatMap((c) => [c.fromUnit, c.toUnit]))].sort();

  const availableToUnits = conversions
    .filter((c) => c.fromUnit === fromUnit)
    .map((c) => c.toUnit);

  const handleConvert = () => {
    if (!fromUnit || !toUnit || !quantity) return;
    const conversion = conversions.find(
      (c) => c.fromUnit === fromUnit && c.toUnit === toUnit
    );
    if (conversion) {
      setResult(Number(quantity) * conversion.factor);
    } else {
      const reverse = conversions.find(
        (c) => c.fromUnit === toUnit && c.toUnit === fromUnit
      );
      if (reverse) {
        setResult(Number(quantity) / reverse.factor);
      } else {
        setResult(null);
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ArrowRightLeft className="h-5 w-5" />
          Convertir Unidades
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>De</Label>
            <Select value={fromUnit} onValueChange={(v) => { setFromUnit(v); setResult(null); }}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                {uniqueUnits.map((unit) => (
                  <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>A</Label>
            <Select
              value={toUnit}
              onValueChange={(v) => { setToUnit(v); setResult(null); }}
              disabled={!fromUnit}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                {availableToUnits.map((unit) => (
                  <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Cantidad</Label>
          <Input
            type="number"
            min="0"
            step="any"
            placeholder="Ej: 2"
            value={quantity}
            onChange={(e) => { setQuantity(e.target.value); setResult(null); }}
          />
        </div>

        <Button
          onClick={handleConvert}
          disabled={!fromUnit || !toUnit || !quantity || fromUnit === toUnit}
          className="w-full"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Convertir
        </Button>

        {result !== null && (
          <div className="text-center p-3 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">Resultado</p>
            <p className="text-2xl font-bold">
              {result.toFixed(2)} {toUnit}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
