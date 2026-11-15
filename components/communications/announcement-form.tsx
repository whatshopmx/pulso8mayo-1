'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Send, Megaphone } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface AnnouncementFormProps {
  companyId: string;
  userId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
  initialData?: any;
  announcementId?: string;
  branches?: any[];
}

export function AnnouncementForm({ companyId, userId, onSuccess, onCancel, initialData, announcementId }: AnnouncementFormProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    title: initialData?.title || '',
    content: initialData?.content || '',
    communicationType: initialData?.communicationType || 'ANNOUNCEMENT',
    targetType: initialData?.targetType || 'COMPANY',
    targetIds: initialData?.targetIds || [] as string[],
    targetRoles: initialData?.targetRoles || [] as string[],
    isPinned: initialData?.isPinned || false,
    deliveredVia: initialData?.deliveredVia || [] as string[],
  });

  const [availableBranches, setAvailableBranches] = useState<any[]>([]);
  const [availableDepartments, setAvailableDepartments] = useState<any[]>([]);
  const [estimatedReach, setEstimatedReach] = useState<number | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  const roles = [
    { id: 'ADMIN', label: 'Administradores' },
    { id: 'GERENTE', label: 'Gerentes' },
    { id: 'SUPERVISOR', label: 'Supervisores' },
    { id: 'EMPLEADO', label: 'Empleados' },
  ];

  // Fetch branches if not provided as props
  // We do it once when component mounts if targetType might need it
  useEffect(() => {
      async function loadBranches() {
      if (companyId) {
        try {
          const res = await fetch(`/api/branches?companyId=${companyId}`);
          if (res.ok) {
            const parsedData = await res.json();
            const branchesList = parsedData.data || parsedData.branches || (Array.isArray(parsedData) ? parsedData : []);
            setAvailableBranches(branchesList);
          }
        } catch (error) {
          console.error("Error loading branches", error);
        }
      }
    }

    async function loadDepartments() {
      if (companyId) {
        try {
          const res = await fetch(`/api/departments?companyId=${companyId}`);
          if (res.ok) {
            const data = await res.json();
            setAvailableDepartments(data.departments || []);
          }
        } catch (error) {
          console.error("Error loading departments", error);
        }
      }
    }

    loadBranches();
    loadDepartments();
  }, [companyId]);

  // Recalculate estimated reach when filters change
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!companyId) return;
      
      setIsCalculating(true);
      try {
        const res = await fetch('/api/communications/recipients/count', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetType: formData.targetType,
            targetIds: formData.targetIds,
            targetRoles: formData.targetRoles,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setEstimatedReach(data.count);
        }
      } catch (error) {
        console.error("Error calculating reach", error);
      } finally {
        setIsCalculating(false);
      }
    }, 500); // Debounce to avoid too many requests

    return () => clearTimeout(timer);
  }, [companyId, formData.targetType, formData.targetIds, formData.targetRoles]);

  const handleSubmit = async () => {
    if (!formData.title.trim()) {
      toast({ title: 'Error', description: 'El título es requerido', variant: 'destructive' });
      return;
    }
    if (!formData.content.trim()) {
      toast({ title: 'Error', description: 'El contenido es requerido', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const url = announcementId
        ? `/api/communications/announcements?id=${announcementId}`
        : '/api/communications/announcements';
      const method = announcementId ? 'PATCH' : 'POST';

      const body = {
        ...formData,
        companyId,
        createdBy: userId,
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast({
          title: announcementId ? 'Anuncio actualizado' : 'Anuncio publicado',
          description: announcementId
            ? 'El anuncio se actualizó correctamente'
            : 'El anuncio fue publicado exitosamente',
        });
        onSuccess?.();
      } else {
        const error = await res.json();
        toast({ title: 'Error', description: error.error || 'Error al publicar', variant: 'destructive' });
      }
    } catch (e) {
      console.error('Error saving announcement:', e);
      toast({ title: 'Error', description: 'Error de conexión', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="h-5 w-5" />
          {announcementId ? 'Editar Anuncio' : 'Nuevo Anuncio'}
        </CardTitle>
        <CardDescription>
          Publica un comunicado para tus empleados
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ann-title">Título *</Label>
          <Input
            id="ann-title"
            placeholder="Ej: Actualización de políticas de vacaciones"
            value={formData.title}
            onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ann-content">Contenido *</Label>
          <Textarea
            id="ann-content"
            placeholder="Escribe el contenido del anuncio aquí..."
            value={formData.content}
            onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
            rows={5}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select
              value={formData.communicationType}
              onValueChange={(v) => setFormData(prev => ({ ...prev, communicationType: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ANNOUNCEMENT">Anuncio</SelectItem>
                <SelectItem value="NOTIFICATION">Notificación</SelectItem>
                <SelectItem value="MESSAGE">Mensaje</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Destinatarios</Label>
            <Select
              value={formData.targetType}
              onValueChange={(v) => setFormData(prev => ({ ...prev, targetType: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="COMPANY">Toda la Empresa</SelectItem>
                <SelectItem value="BRANCH">Sucursal</SelectItem>
                <SelectItem value="DEPARTMENT">Departamento</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {formData.targetType === 'BRANCH' && (
            <div className="space-y-2 md:col-span-2 border p-3 rounded-md bg-muted/30">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Selecciona las Sucursales</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {availableBranches.map((branch: any) => (
                  <div key={branch.id} className="flex items-center space-x-2">
                    <input 
                      type="checkbox" 
                      id={`branch-${branch.id}`}
                      className="rounded border-gray-300 text-primary focus:ring-primary"
                      checked={(formData.targetIds || []).includes(branch.id)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData((prev) => {
                          const current = prev.targetIds || [];
                          return {
                            ...prev,
                            targetIds: checked 
                              ? [...current, branch.id]
                              : current.filter((id: string) => id !== branch.id)
                          }
                        });
                      }}
                    />
                    <Label htmlFor={`branch-${branch.id}`} className="font-normal text-sm cursor-pointer truncate">
                      {branch.name}
                    </Label>
                  </div>
                ))}
                {availableBranches.length === 0 && (
                  <span className="text-sm text-muted-foreground">No hay sucursales disponibles.</span>
                )}
              </div>
            </div>
          )}

          {formData.targetType === 'DEPARTMENT' && (
            <div className="space-y-2 md:col-span-2 border p-3 rounded-md bg-muted/30">
              <Label className="text-xs font-bold uppercase text-muted-foreground">Selecciona los Departamentos</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {availableDepartments.map((dept: any) => (
                  <div key={dept.id} className="flex items-center space-x-2">
                    <input 
                      type="checkbox" 
                      id={`dept-${dept.id}`}
                      className="rounded border-gray-300 text-primary focus:ring-primary"
                      checked={(formData.targetIds || []).includes(dept.id)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData((prev) => {
                          const current = prev.targetIds || [];
                          return {
                            ...prev,
                            targetIds: checked 
                              ? [...current, dept.id]
                              : current.filter((id: string) => id !== dept.id)
                          }
                        });
                      }}
                    />
                    <Label htmlFor={`dept-${dept.id}`} className="font-normal text-sm cursor-pointer truncate">
                      {dept.name}
                    </Label>
                  </div>
                ))}
                {availableDepartments.length === 0 && (
                  <span className="text-sm text-muted-foreground">No hay departamentos con empleados asignados aun.</span>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2 md:col-span-2 border p-3 rounded-md border-primary/20 bg-primary/5">
            <Label className="text-xs font-bold uppercase text-primary">Filtrar por Roles (Opcional)</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              {roles.map((role) => (
                <div key={role.id} className="flex items-center space-x-2">
                  <input 
                    type="checkbox" 
                    id={`role-${role.id}`}
                    className="rounded border-gray-300 text-primary focus:ring-primary"
                    checked={(formData.targetRoles || []).includes(role.id)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setFormData((prev) => {
                        const current = prev.targetRoles || [];
                        return {
                          ...prev,
                          targetRoles: checked 
                            ? [...current, role.id]
                            : current.filter((id: string) => id !== role.id)
                        }
                      });
                    }}
                  />
                  <Label htmlFor={`role-${role.id}`} className="font-normal text-sm cursor-pointer">
                    {role.label}
                  </Label>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Si no seleccionas ningún rol, se enviará a todos los empleados dentro del grupo seleccionado.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-secondary shadow-sm">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${estimatedReach && estimatedReach > 0 ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
            <span className="text-sm font-medium">Alcance Estimado:</span>
          </div>
          <div className="flex items-center gap-2">
            {isCalculating ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <span className="text-lg font-bold">
                {estimatedReach !== null ? estimatedReach : '0'} <span className="text-xs font-normal text-muted-foreground">empleados</span>
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex items-center space-x-2">
            <Switch
              id="pinned"
              checked={formData.isPinned}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isPinned: checked }))}
            />
            <Label htmlFor="pinned">Fijar anuncio (aparece al inicio)</Label>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="whatsapp"
              checked={formData.deliveredVia.includes('WHATSAPP')}
              onCheckedChange={(checked) => {
                setFormData(prev => {
                  const has = prev.deliveredVia.includes('WHATSAPP');
                  if (checked && !has) return { ...prev, deliveredVia: [...prev.deliveredVia, 'WHATSAPP'] };
                  if (!checked && has) return { ...prev, deliveredVia: prev.deliveredVia.filter((m: string) => m !== 'WHATSAPP') };
                  return prev;
                });
              }}
            />
            <Label htmlFor="whatsapp">Notificar también por WhatsApp</Label>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          {onCancel && (
            <Button variant="outline" onClick={onCancel} disabled={loading}>
              Cancelar
            </Button>
          )}
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {announcementId ? 'Actualizar' : 'Publicar Anuncio'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
