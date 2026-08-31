"use client";

import { Bell, Check, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from "@/hooks/use-notifications";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import Link from "next/link";

export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } =
    useNotifications();

  const recent = notifications.slice(0, 10);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 rounded-full px-1 text-[10px] font-bold flex items-center justify-center"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
          <span className="sr-only">Notificaciones</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notificaciones</span>
          {unreadCount > 0 && (
            <button
              onClick={() => markAllAsRead()}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <CheckCheck className="h-3 w-3" />
              Marcar todo leído
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recent.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Sin notificaciones
          </div>
        ) : (
          recent.map((n) => (
            <DropdownMenuItem
              key={n.id}
              className={`flex flex-col items-start gap-1 py-2 px-3 cursor-pointer ${
                !n.read ? "bg-muted/50" : ""
              }`}
              onClick={() => {
                if (!n.read) markAsRead(n.id);
              }}
              asChild
            >
              <div>
                {n.actionUrl ? (
                  <Link href={n.actionUrl} className="block w-full">
                    <NotificationContent notification={n} />
                  </Link>
                ) : (
                  <NotificationContent notification={n} />
                )}
              </div>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="justify-center text-sm text-muted-foreground">
          <Link href="/dashboard/notifications">Ver todas</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationContent({
  notification: n,
}: {
  notification: {
    title: string;
    message: string;
    read: boolean;
    createdAt: string;
  };
}) {
  return (
    <div className="flex items-start gap-2 w-full">
      {!n.read && (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-none truncate">{n.title}</p>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
          {n.message}
        </p>
        <p className="text-[10px] text-muted-foreground mt-1">
          {formatDistanceToNow(new Date(n.createdAt), {
            addSuffix: true,
            locale: es,
          })}
        </p>
      </div>
      {!n.read && <Check className="h-3 w-3 shrink-0 mt-1 text-muted-foreground" />}
    </div>
  );
}
