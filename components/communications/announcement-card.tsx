'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pin, PinOff, Trash2, Edit, Megaphone, Bell, Mail, Briefcase, Users } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface AnnouncementCardProps {
  announcement: {
    id: string;
    title: string;
    content: string;
    communicationType: string;
    targetType: string;
    status: string;
    isPinned: boolean;
    sentAt: string | null;
    createdAt: string;
    authorName: string | null;
    readCount: number;
    totalRecipients: number;
    targetRoles: string[] | null;
  };
  onPin?: (id: string, pinned: boolean) => void;
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
  highlight?: string;
}

function highlightText(text: string, query?: string): React.ReactNode {
  if (!query || !query.trim()) return text;
  const q = query.trim();
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  const lowerQ = q.toLowerCase();
  return parts.map((part, i) =>
    part.toLowerCase() === lowerQ ? (
      <mark key={i} className="bg-yellow-200 rounded px-0.5 text-foreground">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export function AnnouncementCard({ announcement, onPin, onDelete, onEdit, highlight }: AnnouncementCardProps) {
  const typeConfig: Record<string, { icon: any; label: string; color: string }> = {
    ANNOUNCEMENT: { icon: Megaphone, label: 'Anuncio', color: 'bg-blue-100 text-blue-800' },
    NOTIFICATION: { icon: Bell, label: 'Notificación', color: 'bg-amber-100 text-amber-800' },
    MESSAGE: { icon: Mail, label: 'Mensaje', color: 'bg-green-100 text-green-800' },
    POLICY: { icon: Briefcase, label: 'Política', color: 'bg-purple-100 text-purple-800' },
  };

  const roleLabels: Record<string, string> = {
    ADMIN: 'Admin',
    GERENTE: 'Gerentes',
    SUPERVISOR: 'Supervisores',
    EMPLEADO: 'Empleados',
  };

  const targetLabels: Record<string, string> = {
    COMPANY: 'Toda la Empresa',
    BRANCH: 'Sucursal',
    DEPARTMENT: 'Departamento',
    INDIVIDUAL: 'Individual',
  };

  const config = typeConfig[announcement.communicationType] || typeConfig.ANNOUNCEMENT;
  const Icon = config.icon;

  return (
    <Card className={`transition-all hover:shadow-md ${announcement.isPinned ? 'border-primary border-2' : ''}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {announcement.isPinned && <Pin className="h-4 w-4 text-primary" />}
            <CardTitle className="text-lg">{highlightText(announcement.title, highlight)}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Badge className={config.color} variant="secondary">
              <Icon className="h-3 w-3 mr-1" />
              {config.label}
            </Badge>
            <div className="flex flex-col items-end gap-1">
              <Badge variant="outline" className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {targetLabels[announcement.targetType]}
              </Badge>
              {announcement.targetRoles && announcement.targetRoles.length > 0 && (
                <div className="flex gap-1 flex-wrap justify-end">
                  {announcement.targetRoles.map(role => (
                    <span key={role} className="text-[10px] bg-muted px-1.5 py-0.5 rounded border">
                      {roleLabels[role] || role}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap mb-4 line-clamp-3">
          {highlightText(announcement.content, highlight)}
        </p>
        <div className="flex items-center justify-between">
            <span>Por: {announcement.authorName || 'Sistema'}</span>
            <span>
              {format(new Date(announcement.sentAt || announcement.createdAt), 'dd MMM yyyy HH:mm', { locale: es })}
            </span>
          </div>
          
          <div className="flex items-center gap-3">
            {announcement.totalRecipients > 0 && (
              <div className="flex flex-col items-end gap-1 min-w-[120px]">
                <div className="flex justify-between w-full text-[10px] font-medium">
                  <span>Alcance</span>
                  <span>{Math.round((announcement.readCount / announcement.totalRecipients) * 100)}%</span>
                </div>
                <div className="w-full bg-muted h-1 rounded-full overflow-hidden">
                  <div 
                    className="bg-primary h-full transition-all duration-500" 
                    style={{ width: `${(announcement.readCount / announcement.totalRecipients) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {announcement.readCount} de {announcement.totalRecipients} leídos
                </span>
              </div>
            )}
            
            <div className="flex items-center gap-1">
            {onPin && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onPin(announcement.id, !announcement.isPinned)}
                title={announcement.isPinned ? 'Desfijar' : 'Fijar'}
              >
                {announcement.isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              </Button>
            )}
            {onEdit && (
              <Button variant="ghost" size="sm" onClick={() => onEdit(announcement.id)}>
                <Edit className="h-4 w-4" />
              </Button>
            )}
            {onDelete && (
              <Button variant="ghost" size="sm" onClick={() => onDelete(announcement.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
