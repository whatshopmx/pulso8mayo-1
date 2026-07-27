"use client";

import { useState, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { 
    Camera as CameraIcon, 
    Scan, 
    CheckCircle, 
    AlertCircle, 
    X, 
    Flashlight,
    RefreshCcw
} from "lucide-react";
import { toast } from "sonner";

interface BarcodeScannerProps {
    onScan: (barcode: string) => void;
    onClose: () => void;
}

export function BarcodeScannerComponent({ onScan, onClose }: BarcodeScannerProps) {
    const [isScanning, setIsScanning] = useState(false);
    const [hasPermission, setHasPermission] = useState<boolean | null>(null);
    const [torchOn, setTorchOn] = useState(false);
    const [lastScanned, setLastScanned] = useState<string>("");
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const requestPermissions = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' }
            });
            setHasPermission(true);
            stream.getTracks().forEach(track => track.stop());
            startScanning();
        } catch {
            setHasPermission(false);
            toast.error("Permiso de cámara denegado. Por favor, habilita el acceso a la cámara en la configuración de tu dispositivo.");
        }
    }, []);

    const startScanning = useCallback(async () => {
        try {
            setIsScanning(true);
            
            if (typeof navigator !== 'undefined' && 'mediaDevices' in navigator) {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' }
                });
                
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    streamRef.current = stream;
                }
                
                startBrowserScanning();
            }
        } catch (error) {
            console.error("Start scanning error:", error);
            toast.error("Error al iniciar la cámara");
            setIsScanning(false);
        }
    }, []);

    const startBrowserScanning = useCallback(() => {
        if ('BarcodeDetector' in window) {
            // @ts-expect-error - BarcodeDetector not in lib.dom types
            const barcodeDetector = new window.BarcodeDetector({
                formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code']
            });

            const detectBarcode = async () => {
                if (videoRef.current && isScanning) {
                    try {
                        const barcodes = await barcodeDetector.detect(videoRef.current);
                        if (barcodes.length > 0) {
                            handleBarcodeDetected(barcodes[0].rawValue);
                        }
                    } catch (error) {
                        console.error("Detection error:", error);
                    }
                    
                    requestAnimationFrame(detectBarcode);
                }
            };

            detectBarcode();
        } else {
            toast.info("Tu navegador no soporta detección automática. Usa un dispositivo móvil o ingresa el código manualmente.");
        }
    }, [isScanning]);

    const handleBarcodeDetected = useCallback((value: string) => {
        if (value && value !== lastScanned) {
            setLastScanned(value);
            toast.success(`Código escaneado: ${value}`);
            onScan(value);
            stopScanning();
        }
    }, [lastScanned, onScan]);

    const stopScanning = useCallback(() => {
        setIsScanning(false);
        
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
    }, []);

    const toggleTorch = useCallback(async () => {
        toast.info("Control de flash no disponible en navegador");
    }, []);

    const cleanup = useCallback(() => {
        stopScanning();
        setHasPermission(null);
    }, [stopScanning]);

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Escanear Código de Barras</DialogTitle>
                    <DialogDescription>
                        Apunta la cámara al código de barras del producto.
                    </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4">
                    {hasPermission === false && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                                Se requiere acceso a la cámara para escanear códigos.
                            </AlertDescription>
                        </Alert>
                    )}
                    
                    <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                        {isScanning ? (
                            <>
                                <video 
                                    ref={videoRef}
                                    autoPlay 
                                    playsInline
                                    muted
                                    className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-64 h-32 border-2 border-white/50 rounded-lg" />
                                </div>
                            </>
                        ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted text-muted-foreground">
                                <CameraIcon className="h-12 w-12 mb-2" />
                                <p>Cámara no activa</p>
                            </div>
                        )}
                    </div>
                    
                    {lastScanned && (
                        <Alert>
                            <CheckCircle className="h-4 w-4" />
                            <AlertDescription>
                                Último escaneado: <Badge variant="outline">{lastScanned}</Badge>
                            </AlertDescription>
                        </Alert>
                    )}
                </div>
                
                <DialogFooter className="flex gap-2">
                    {!isScanning ? (
                        <>
                            <Button variant="outline" onClick={onClose}>
                                <X className="h-4 w-4 mr-2" />
                                Cancelar
                            </Button>
                            <Button onClick={hasPermission === null ? requestPermissions : startScanning}>
                                <Scan className="h-4 w-4 mr-2" />
                                Escanear
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button variant="outline" onClick={toggleTorch}>
                                <Flashlight className="h-4 w-4 mr-2" />
                                Flash
                            </Button>
                            <Button variant="destructive" onClick={stopScanning}>
                                <X className="h-4 w-4 mr-2" />
                                Detener
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}