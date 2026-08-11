"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Announcement {
  id: string;
  title: string;
  content: string;
  communicationType: string;
  createdAt: Date;
}

interface CollapsibleAnnouncementsProps {
  announcements: Announcement[];
  titleLabel: string;
  announcementLabel: string;
  notificationLabel: string;
  messageLabel: string;
}

export function CollapsibleAnnouncements({
  announcements,
  titleLabel,
  announcementLabel,
  notificationLabel,
  messageLabel,
}: CollapsibleAnnouncementsProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!announcements || announcements.length === 0) return null;

  return (
    <section aria-label={titleLabel} className="bg-card border border-border rounded-xl overflow-hidden transition-all duration-300">
      <div className="px-6 py-4 flex items-center justify-between bg-muted/20 border-b border-border">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">{titleLabel} ({announcements.length})</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="h-8 px-2 text-xs gap-1 hover:bg-muted/80 transition-colors"
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              <span>Ocultar</span>
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              <span>Ver anuncios</span>
            </>
          )}
        </Button>
      </div>

      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden ${
          isExpanded ? "max-h-[1000px] opacity-100 p-6" : "max-h-0 opacity-0 p-0 border-t-0"
        }`}
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {announcements.map((announcement) => (
            <div
              key={announcement.id}
              className="bg-muted/30 border border-border/80 rounded-xl p-4 relative overflow-hidden group hover:bg-muted/50 transition-all duration-200 hover:border-primary/20"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary">
                  {announcement.communicationType === 'ANNOUNCEMENT' 
                    ? announcementLabel 
                    : announcement.communicationType === 'NOTIFICATION' 
                      ? notificationLabel 
                      : messageLabel}
                </span>
              </div>
              <h4 className="font-bold text-base mb-1 group-hover:text-primary transition-colors">{announcement.title}</h4>
              <p className="text-sm text-muted-foreground line-clamp-3 group-hover:text-foreground/90 transition-colors leading-relaxed">
                {announcement.content}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
