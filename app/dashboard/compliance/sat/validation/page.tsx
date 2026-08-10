"use client";

import { PageHeader } from "@/components/shared";
import { CheckCircle2 } from "lucide-react";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, CheckCircle, XCircle, AlertTriangle, Search } from "lucide-react";
import { toast } from "sonner";

interface ValidationResult {
  rfc?: string;
  curp?: string;
  isValid: boolean;
  message: string;
}

export default function SATValidationPage() {
    const [rfcInput, setRfcInput] = useState("");
    const [curpInput, setCurpInput] = useState("");
    const [rfcResult, setRfcResult] = useState<ValidationResult | null>(null);
    const [curpResult, setCurpResult] = useState<ValidationResult | null>(null);
    const [validating, setValidating] = useState(false);

    const validateRFC = async () => {
        if (!rfcInput.trim()) return;
        setValidating(true);
        try {
            const res = await fetch(`/api/sat/validate?rfc=${encodeURIComponent(rfcInput)}`);
            if (res.ok) {
                const data = await res.json();
                setRfcResult(data);
            }
        } catch (e) {
            toast.error("Error al validar RFC");
        } finally {
            setValidating(false);
        }
    };

    const validateCURP = async () => {
        if (!curpInput.trim()) return;
        setValidating(true);
        try {
            const res = await fetch(`/api/sat/validate?curp=${encodeURIComponent(curpInput)}`);
            if (res.ok) {
                const data = await res.json();
                setCurpResult(data);
            }
        } catch (e) {
            toast.error("Error al validar CURP");
        } finally {
            setValidating(false);
        }
    };

    const validateRFCPost = async () => {
        if (!rfcInput.trim()) return;
        setValidating(true);
        try {
            const res = await fetch("/api/sat/validate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rfc: rfcInput }),
            });
            if (res.ok) {
                const data = await res.json();
                setRfcResult(data);
            }
        } catch (e) {
            toast.error("Error al validar RFC");
        } finally {
            setValidating(false);
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title="Validación SAT"
                description="Valida RFC y CURP de empleados para efectos fiscales"
                icon={CheckCircle2}
            />

            <Tabs defaultValue="rfc" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="rfc">RFC</TabsTrigger>
                    <TabsTrigger value="curp">CURP</TabsTrigger>
                </TabsList>

                <TabsContent value="rfc">
                    <Card>
                        <CardHeader>
                            <CardTitle>Validar RFC</CardTitle>
                            <CardDescription>
                                Formato: ABCD123456EFG (12 o 13 caracteres)
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex gap-2">
                                <Input
                                    placeholder="Ej: ROSM850518MG1"
                                    value={rfcInput}
                                    onChange={e => {
                                        setRfcInput(e.target.value.toUpperCase());
                                        setRfcResult(null);
                                    }}
                                    maxLength={13}
                                    className="font-mono"
                                />
                                <Button
                                    onClick={validateRFCPost}
                                    disabled={validating || !rfcInput.trim()}
                                >
                                    {validating ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Search className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>

                            {rfcResult && (
                                <div
                                    className={`p-4 rounded-lg border flex items-center gap-3 ${
                                        rfcResult.isValid
                                            ? "bg-green-50 border-green-200"
                                            : "bg-red-50 border-red-200"
                                    }`}
                                >
                                    {rfcResult.isValid ? (
                                        <CheckCircle className="h-5 w-5 text-green-600" />
                                    ) : (
                                        <XCircle className="h-5 w-5 text-red-600" />
                                    )}
                                    <div>
                                        <p className="font-medium font-mono">{rfcResult.rfc}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {rfcResult.message}
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div className="bg-muted p-4 rounded-lg text-sm">
                                <p className="font-medium mb-2">Formato RFC:</p>
                                <ul className="space-y-1 text-muted-foreground">
                                    <li>• 3 o 4 letras para personas morales o físicas</li>
                                    <li>• 6 dígitos para fecha de nacimiento (AAMMDD)</li>
                                    <li>• 3 caracteres alfanuméricos (homoclave)</li>
                                </ul>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="curp">
                    <Card>
                        <CardHeader>
                            <CardTitle>Validar CURP</CardTitle>
                            <CardDescription>
                                Formato: 18 caracteres alfanuméricos
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex gap-2">
                                <Input
                                    placeholder="Ej: XEXX010101HDFXXR00"
                                    value={curpInput}
                                    onChange={e => {
                                        setCurpInput(e.target.value.toUpperCase());
                                        setCurpResult(null);
                                    }}
                                    maxLength={18}
                                    className="font-mono"
                                />
                                <Button
                                    onClick={validateCURP}
                                    disabled={validating || !curpInput.trim()}
                                >
                                    {validating ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Search className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>

                            {curpResult && (
                                <div
                                    className={`p-4 rounded-lg border flex items-center gap-3 ${
                                        curpResult.isValid
                                            ? "bg-green-50 border-green-200"
                                            : "bg-red-50 border-red-200"
                                    }`}
                                >
                                    {curpResult.isValid ? (
                                        <CheckCircle className="h-5 w-5 text-green-600" />
                                    ) : (
                                        <XCircle className="h-5 w-5 text-red-600" />
                                    )}
                                    <div>
                                        <p className="font-medium font-mono">{curpResult.curp}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {curpResult.message}
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div className="bg-muted p-4 rounded-lg text-sm">
                                <p className="font-medium mb-2">Composición CURP:</p>
                                <ul className="space-y-1 text-muted-foreground">
                                    <li>• 4 letras: Nombre</li>
                                    <li>• 6 dígitos: Fecha nacimiento</li>
                                    <li>• 6 letras: Datos registro</li>
                                    <li>• 2 dígitos: Entidad + Homoclave</li>
                                </ul>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}