"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Upload, X, Loader2 } from "lucide-react";
import { usePhotoUpload } from "@/components/shared/use-photo-upload";
import { CameraCapture } from "@/components/shared/camera-capture";

interface ProductPhotoUploadProps {
  currentPhotoUrl?: string | null;
  onPhotoChange: (url: string | null) => void;
}

export function ProductPhotoUpload({ currentPhotoUrl, onPhotoChange }: ProductPhotoUploadProps) {
  const [preview, setPreview] = useState<string | null>(currentPhotoUrl || null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const { uploadPhotos, uploading } = usePhotoUpload();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const results = await uploadPhotos([file]);
      if (results[0]) {
        setPreview(results[0].url);
        onPhotoChange(results[0].url);
      }
    } catch {
      // error handled by hook
    }
  };

  const handleCameraCapture = async (files: File[]) => {
    if (files.length === 0) return;
    try {
      const results = await uploadPhotos(files);
      if (results[0]) {
        setPreview(results[0].url);
        onPhotoChange(results[0].url);
      }
    } catch {
      // error handled by hook
    }
  };

  const handleRemove = () => {
    setPreview(null);
    onPhotoChange(null);
  };

  return (
    <div className="space-y-2">
      <Label>Foto del Producto</Label>
      <div className="flex items-center gap-4">
        {preview ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="Producto"
              className="h-24 w-24 object-cover rounded-lg border"
            />
            <button
              type="button"
              onClick={handleRemove}
              className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="h-24 w-24 rounded-lg border-2 border-dashed flex items-center justify-center text-muted-foreground">
            <Camera className="h-8 w-8" />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Button type="button" variant="outline" size="sm" disabled={uploading} className="relative">
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            Subir Foto
            <input
              type="file"
              accept="image/*"
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={handleFileSelect}
              disabled={uploading}
            />
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setCameraOpen(true)}>
            <Camera className="h-4 w-4 mr-2" />
            Tomar Foto
          </Button>
        </div>
      </div>
      <input type="hidden" name="photoUrl" value={preview || ""} />
      <CameraCapture
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onConfirm={handleCameraCapture}
        maxPhotos={1}
      />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">{children}</label>;
}
