import { NotificationDispatcher, NotificationPayload, NotificationEventType, NotificationChannel } from "@/lib/services/notification-dispatcher";

export interface RoutingRule {
    eventType: NotificationEventType;
    priority: "low" | "normal" | "high" | "critical";
    channels: NotificationChannel[];
    retryAttempts: number;
    retryDelayMs: number;
    businessHoursOnly: boolean;
}

export interface RoutingDecision {
    shouldSend: boolean;
    channels: NotificationChannel[];
    priority: string;
    retryConfig: {
        attempts: number;
        delayMs: number;
    };
    reason?: string;
}

// Routing rules configuration
const routingRules: Record<NotificationEventType, RoutingRule> = {
    workflow_assignment: {
        eventType: "workflow_assignment",
        priority: "normal",
        channels: ["whatsapp", "email", "in-app"],
        retryAttempts: 3,
        retryDelayMs: 5000,
        businessHoursOnly: false
    },
    workflow_due_soon: {
        eventType: "workflow_due_soon",
        priority: "normal",
        channels: ["whatsapp", "in-app"],
        retryAttempts: 2,
        retryDelayMs: 3000,
        businessHoursOnly: false
    },
    workflow_overdue: {
        eventType: "workflow_overdue",
        priority: "high",
        channels: ["whatsapp", "email", "in-app"],
        retryAttempts: 3,
        retryDelayMs: 2000,
        businessHoursOnly: false
    },
    incident: {
        eventType: "incident",
        priority: "critical",
        channels: ["whatsapp", "email", "in-app"],
        retryAttempts: 5,
        retryDelayMs: 1000,
        businessHoursOnly: false
    },
    stock_alert: {
        eventType: "stock_alert",
        priority: "high",
        channels: ["whatsapp", "email", "in-app"],
        retryAttempts: 3,
        retryDelayMs: 2000,
        businessHoursOnly: true
    },
    shift_reminder: {
        eventType: "shift_reminder",
        priority: "low",
        channels: ["whatsapp", "in-app"],
        retryAttempts: 2,
        retryDelayMs: 5000,
        businessHoursOnly: true
    },
    schedule_change: {
        eventType: "schedule_change",
        priority: "normal",
        channels: ["whatsapp", "email", "in-app"],
        retryAttempts: 3,
        retryDelayMs: 3000,
        businessHoursOnly: false
    },
  document_expiration: {
    eventType: "document_expiration",
    priority: "high",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 2000,
    businessHoursOnly: false
  },
  shift_approval_request: {
    eventType: "shift_approval_request",
    priority: "normal",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 3000,
    businessHoursOnly: false
  },
  shift_approval_decision: {
    eventType: "shift_approval_decision",
    priority: "normal",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 2,
    retryDelayMs: 3000,
    businessHoursOnly: false
  },
  stock_count_variance: {
    eventType: "stock_count_variance",
    priority: "high",
    channels: ["whatsapp", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 2000,
    businessHoursOnly: true
  },
  shift_change_request: {
    eventType: "shift_change_request",
    priority: "normal",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 3000,
    businessHoursOnly: false
  },
  shift_change_decision: {
    eventType: "shift_change_decision",
    priority: "normal",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 2,
    retryDelayMs: 3000,
    businessHoursOnly: false
  },
  employee_absence: {
    eventType: "employee_absence",
    priority: "high",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 2000,
    businessHoursOnly: false
  },
  announcement_broadcast: {
    eventType: "announcement_broadcast",
    priority: "normal",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 3000,
    businessHoursOnly: false
  },
  training_assigned: {
    eventType: "training_assigned",
    priority: "normal",
    channels: ["whatsapp", "email", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 3000,
    businessHoursOnly: false
  },
  imss_deadline: {
    eventType: "imss_deadline",
    priority: "high",
    channels: ["whatsapp", "in-app"],
    retryAttempts: 3,
    retryDelayMs: 2000,
    businessHoursOnly: false
  }
};

export class NotificationRouter {
    /**
     * Route notification to appropriate channels
     */
    static async route(payload: NotificationPayload): Promise<RoutingDecision> {
        const rule = routingRules[payload.eventType];

        if (!rule) {
            return {
                shouldSend: false,
                channels: [],
                priority: "normal",
                retryConfig: {
                    attempts: 0,
                    delayMs: 0
                },
                reason: `No routing rule found for event type: ${payload.eventType}`
            };
        }

        // Check business hours if required
        if (rule.businessHoursOnly && !this.isBusinessHours()) {
            return {
                shouldSend: true,
                channels: ["in-app"], // Only send in-app notification outside business hours
                priority: rule.priority,
                retryConfig: {
                    attempts: rule.retryAttempts,
                    delayMs: rule.retryDelayMs
                },
                reason: "Outside business hours - only in-app notification sent"
            };
        }

        // Check for critical notifications - always send through all channels
        if (rule.priority === "critical") {
            return {
                shouldSend: true,
                channels: rule.channels,
                priority: rule.priority,
                retryConfig: {
                    attempts: rule.retryAttempts,
                    delayMs: rule.retryDelayMs
                }
            };
        }

        // Normal routing
        return {
            shouldSend: true,
            channels: rule.channels,
            priority: rule.priority,
            retryConfig: {
                attempts: rule.retryAttempts,
                delayMs: rule.retryDelayMs
            }
        };
    }

    /**
     * Send notification with routing
     */
    static async sendWithRouting(payload: NotificationPayload): Promise<void> {
        const decision = await this.route(payload);

        if (!decision.shouldSend) {
            console.log("Notification not sent:", decision.reason);
            return;
        }

        // Create modified payload based on routing decision
        const routingPayload = {
            ...payload,
            metadata: {
                ...payload.metadata,
                routingPriority: decision.priority,
                routedChannels: decision.channels
            }
        };

        // Send through dispatcher
        await NotificationDispatcher.sendNotification(routingPayload);
    }

    /**
     * Send batch notifications with routing
     */
    static async sendBatchWithRouting(payloads: NotificationPayload[]): Promise<void> {
        // Group by priority
        const grouped = this.groupByPriority(payloads);

        // Send critical first
        if (grouped.critical) {
            await Promise.all(
                grouped.critical.map(payload => this.sendWithRouting(payload))
            );
        }

        // Then high priority
        if (grouped.high) {
            await Promise.all(
                grouped.high.map(payload => this.sendWithRouting(payload))
            );
        }

        // Then normal
        if (grouped.normal) {
            await Promise.all(
                grouped.normal.map(payload => this.sendWithRouting(payload))
            );
        }

        // Finally low priority
        if (grouped.low) {
            await Promise.all(
                grouped.low.map(payload => this.sendWithRouting(payload))
            );
        }
    }

    /**
     * Check if current time is within business hours
     */
    private static isBusinessHours(): boolean {
        const now = new Date();
        const day = now.getDay(); // 0 = Sunday, 6 = Saturday
        const hour = now.getHours();

        // Monday to Friday, 9 AM to 6 PM
        return day >= 1 && day <= 5 && hour >= 9 && hour < 18;
    }

    /**
     * Group payloads by priority
     */
    private static groupByPriority(payloads: NotificationPayload[]): {
        critical?: NotificationPayload[];
        high?: NotificationPayload[];
        normal?: NotificationPayload[];
        low?: NotificationPayload[];
    } {
        const grouped: any = {};

        payloads.forEach(payload => {
            const rule = routingRules[payload.eventType];
            if (!rule) return;

            if (!grouped[rule.priority]) {
                grouped[rule.priority] = [];
            }

            grouped[rule.priority].push(payload);
        });

        return grouped;
    }

    /**
     * Get routing rules
     */
    static getRoutingRules(): Record<NotificationEventType, RoutingRule> {
        return routingRules;
    }

    /**
     * Get routing rule for specific event type
     */
    static getRoutingRule(eventType: NotificationEventType): RoutingRule | undefined {
        return routingRules[eventType];
    }

    /**
     * Update routing rule (for runtime configuration)
     */
    static updateRoutingRule(eventType: NotificationEventType, updates: Partial<RoutingRule>): void {
        if (routingRules[eventType]) {
            routingRules[eventType] = {
                ...routingRules[eventType],
                ...updates
            };
        }
    }
}
