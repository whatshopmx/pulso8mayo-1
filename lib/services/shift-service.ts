
import { db } from "@/lib/db";
import { shiftSessions, breakLogs, branches, plannedShifts, breakComplianceRules, shiftApprovals } from "@/lib/db/schema";
import { eq, and, isNull, between, sql } from "drizzle-orm";
import { Shift, ShiftFilters, CreateShiftInput, UpdateShiftInput, BulkCreateResult, DuplicateOptions } from "@/lib/types/shifts";
import { parseISO, startOfWeek, endOfWeek, addWeeks } from "date-fns";
import { ShiftApprovalService } from "./shift-approval-service";
import { OvertimeAlertService } from "./overtime-alert-service";
import { WorkflowAssignmentService } from "./workflow-assignment-service";
import { WorkflowTriggerService } from "./workflow-trigger-service";
import { inngest } from "@/lib/inngest/client";

const DAILY_WORK_LIMIT_MINUTES = 480; // 8 hours

export interface GeolocationData {
    latitude: number;
    longitude: number;
    accuracy?: number;
    timestamp?: number;
}

export interface ShiftSessionRow {
  id: string;
  plannedShiftId: string | null;
  userId: string;
  branchId: string;
  status: string;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  checkInTime: Date | null;
  checkOutTime: Date | null;
  totalBreakMinutes: number;
  totalWorkMinutes: number;
  overtimeMinutes: number;
  checkInGeolocation: GeolocationData | null;
  checkOutGeolocation: GeolocationData | null;
  complianceFlags: Record<string, unknown> | null;
  lateMinutes: number;
  earlyDepartureMinutes: number;
  requiresApproval: boolean;
  approvedBy: string | null;
  approvedAt: Date | null;
  startedAt: Date;
  endedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClockInResult {
    success: boolean;
    session?: ShiftSessionRow;
    withinRadius: boolean;
    distance: number;
    message: string;
    lateMinutes?: number;
}

export interface DiscrepancyFlags {
    lateCheckIn: boolean;
    earlyCheckOut: boolean;
    missedBreak: boolean;
    lateMinutes: number;
    earlyDepartureMinutes: number;
    requiresApproval: boolean;
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in meters
 */
function calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

export class ShiftService {

    static async startSession(userId: string, branchId: string, geolocation?: GeolocationData) {
        // Check if active session exists
        const active = await db.query.shiftSessions.findFirst({
            where: and(
                eq(shiftSessions.userId, userId),
                eq(shiftSessions.status, 'ACTIVE')
            )
        });

        if (active) throw new Error("User already has an active session");

        return await db.insert(shiftSessions).values({
            userId,
            branchId,
            status: 'ACTIVE',
            startedAt: new Date(),
            checkInGeolocation: geolocation ? {
                latitude: geolocation.latitude,
                longitude: geolocation.longitude,
                accuracy: geolocation.accuracy,
                timestamp: geolocation.timestamp || Date.now()
            } : null,
            checkInTime: geolocation ? new Date() : new Date()
        }).returning();
    }

    static async clockInWithGeolocation(
        userId: string,
        branchId: string,
        geolocation: GeolocationData
    ): Promise<ClockInResult> {
        try {
            // Get branch location
            const branch = await db.query.branches.findFirst({
                where: eq(branches.id, branchId)
            });

            if (!branch) {
                return {
                    success: false,
                    withinRadius: false,
                    distance: 0,
                    message: "Sucursal no encontrada"
                };
            }

            // Parse branch location
            const branchLocation = branch.location as any;
            if (!branchLocation?.latitude || !branchLocation?.longitude) {
                return {
                    success: false,
                    withinRadius: false,
                    distance: 0,
                    message: "Ubicación de sucursal no configurada"
                };
            }

            // Calculate distance
            const distance = calculateDistance(
                geolocation.latitude,
                geolocation.longitude,
                branchLocation.latitude,
                branchLocation.longitude
            );

            // Default radius: 100 meters (can be configured per branch)
            const allowedRadius = branchLocation.radius || 100;
            const withinRadius = distance <= allowedRadius;

            if (!withinRadius) {
                return {
                    success: false,
                    withinRadius: false,
                    distance: Math.round(distance),
                    message: `Estás a ${Math.round(distance)}m de la sucursal. El radio permitido es de ${allowedRadius}m.`
                };
            }

            // Check for scheduled shift and calculate lateness
            const today = new Date().toISOString().split('T')[0];
            const scheduledShift = await db.query.plannedShifts.findFirst({
                where: and(
                    eq(plannedShifts.userId, userId),
                    eq(plannedShifts.shiftDate, today),
                    eq(plannedShifts.branchId, branchId)
                )
            });

            let lateMinutes = 0;
            let message = `Check-in exitoso. Distancia: ${Math.round(distance)}m`;

            if (scheduledShift) {
                const scheduledTime = new Date(`${today}T${scheduledShift.startTime}`);
                const actualTime = new Date();
                const diffMs = actualTime.getTime() - scheduledTime.getTime();
                lateMinutes = Math.max(0, Math.floor(diffMs / 60000));

                if (lateMinutes > 0) {
                    message += `. Llegada ${lateMinutes} min tarde`;
                }
            }

            // Start session with geolocation
            const [session] = await this.startSession(userId, branchId, geolocation);

            // Update session with scheduled times and discrepancy flags
            if (scheduledShift) {
                await db.update(shiftSessions).set({
                    plannedShiftId: scheduledShift.id,
                    scheduledStartTime: scheduledShift.startTime,
                    scheduledEndTime: scheduledShift.endTime,
                    lateMinutes,
                    complianceFlags: {
                        lateCheckIn: lateMinutes > 0,
                        earlyCheckOut: false,
                        missedBreak: false
                    }
                }).where(eq(shiftSessions.id, session.id));
            }

    return {
      success: true,
      session: session as unknown as ShiftSessionRow,
      withinRadius: true,
      distance: Math.round(distance),
      message,
      lateMinutes
    };
        } catch (error) {
            console.error("Error in clock-in with geolocation:", error);
            return {
                success: false,
                withinRadius: false,
                distance: 0,
                message: "Error al realizar check-in"
            };
        }
    }

    static async clockInV2(userId: string, branchId: string, timestamp: Date) {
        // Wrapper for legacy startSession, ensures timestamp is respected if needed
        // For now, just call startSession
        try {
            const [session] = await this.startSession(userId, branchId);
            return session;
        } catch (e: unknown) {
            // Return null if already active to handle gracefully in workflow
            if (e instanceof Error && e.message.includes("already has an active")) return null;
            throw e;
        }
    }

    static async endSession(userId: string, geolocation?: GeolocationData) {
        const session = await db.query.shiftSessions.findFirst({
            where: and(
                eq(shiftSessions.userId, userId),
                eq(shiftSessions.status, 'ACTIVE')
            )
        });

        if (!session) throw new Error("No active session found");

        const endTime = new Date();
        const startTime = new Date(session.startedAt);
        const durationMs = endTime.getTime() - startTime.getTime();
        const totalDurationMinutes = Math.floor(durationMs / 60000);

        // Calculate total break time
        const breakTime = session.totalBreakMinutes || 0;

        const workMinutes = totalDurationMinutes - breakTime;
        
        // Calculate overtime
        const dailyLimit = DAILY_WORK_LIMIT_MINUTES;
        const overtime = workMinutes > dailyLimit ? workMinutes - dailyLimit : 0;

        // Check for early departure
        let earlyDepartureMinutes = 0;
        if (session.scheduledEndTime) {
            const scheduledEnd = new Date(`${session.startedAt.toISOString().split('T')[0]}T${session.scheduledEndTime}`);
            const diffMs = scheduledEnd.getTime() - endTime.getTime();
            earlyDepartureMinutes = Math.max(0, Math.floor(diffMs / 60000));
        }

        // Build compliance flags
        const complianceFlags = {
            lateCheckIn: (session.lateMinutes || 0) > 0,
            earlyCheckOut: earlyDepartureMinutes > 0,
            missedBreak: breakTime === 0 && workMinutes > 300, // No break in 5+ hour shift
            overtime: overtime > 0
        };

        // Determine if approval is required
        const requiresApproval = overtime > 0 || earlyDepartureMinutes > 30 || (session.lateMinutes || 0) > 30;

        const [updatedSession] = await db.update(shiftSessions).set({
            status: 'COMPLETED',
            endedAt: endTime,
            checkOutTime: endTime,
            checkOutGeolocation: geolocation ? {
                latitude: geolocation.latitude,
                longitude: geolocation.longitude,
                accuracy: geolocation.accuracy,
                timestamp: geolocation.timestamp || Date.now()
            } : null,
            totalWorkMinutes: workMinutes,
            overtimeMinutes: overtime,
            earlyDepartureMinutes,
            complianceFlags,
            requiresApproval,
            approvedBy: requiresApproval ? null : session.approvedBy,
            approvedAt: requiresApproval ? null : session.approvedAt
        }).where(eq(shiftSessions.id, session.id)).returning();

        // Create approval request if needed
        if (requiresApproval && overtime > 0) {
            try {
                await ShiftApprovalService.detectOvertimeRequiringApproval(session.id, overtime);
                // Send overtime alert to managers
                await OvertimeAlertService.checkAndAlertOvertime(session.id);
            } catch (error) {
                console.error("Error creating overtime approval:", error);
            }
        }

        return updatedSession;
    }

    static async startBreak(userId: string) {
        const session = await db.query.shiftSessions.findFirst({
            where: and(
                eq(shiftSessions.userId, userId),
                eq(shiftSessions.status, 'ACTIVE')
            )
        });

        if (!session) throw new Error("No active session found");

        // Check if already on break
        const activeBreak = await db.query.breakLogs.findFirst({
            where: and(
                eq(breakLogs.sessionId, session.id),
                isNull(breakLogs.endTime)
            )
        });

        if (activeBreak) throw new Error("Already on break");

        return await db.insert(breakLogs).values({
            sessionId: session.id,
            startTime: new Date(),
            type: 'MEAL'
        }).returning();
    }

    static async endBreak(userId: string) {
        const session = await db.query.shiftSessions.findFirst({
            where: and(
                eq(shiftSessions.userId, userId),
                eq(shiftSessions.status, 'ACTIVE')
            )
        });

        if (!session) throw new Error("No active session found");

        const activeBreak = await db.query.breakLogs.findFirst({
            where: and(
                eq(breakLogs.sessionId, session.id),
                isNull(breakLogs.endTime)
            )
        });

        if (!activeBreak) throw new Error("No active break found");

        const endTime = new Date();
        const durationMs = endTime.getTime() - activeBreak.startTime.getTime();
        const durationMinutes = Math.floor(durationMs / 60000);

        const [log] = await db.update(breakLogs).set({
            endTime,
            durationMinutes
        }).where(eq(breakLogs.id, activeBreak.id)).returning();

        // Update total break minutes in session
        const currentBreakTotal = session.totalBreakMinutes || 0;
        await db.update(shiftSessions).set({
            totalBreakMinutes: currentBreakTotal + durationMinutes
        }).where(eq(shiftSessions.id, session.id));

        return log;
    }

    /**
     * Check for breaks that should be taken but haven't been
     */
    static async checkMissedBreaks(userId: string) {
        const activeSession = await db.query.shiftSessions.findFirst({
            where: and(
                eq(shiftSessions.userId, userId),
                eq(shiftSessions.status, 'ACTIVE')
            )
        });

        if (!activeSession) return null;

        const startTime = new Date(activeSession.startedAt);
        const now = new Date();
        const workMinutes = Math.floor((now.getTime() - startTime.getTime()) / 60000);

        // Get break rules — first look up the branch to get its companyId
        const branch = await db.query.branches.findFirst({
            where: eq(branches.id, activeSession.branchId),
            columns: { companyId: true }
        });

        const rules = await db.query.breakComplianceRules.findFirst({
            where: eq(breakComplianceRules.companyId, branch?.companyId || activeSession.branchId)
        });

        const maxContinuousWork = rules?.maxContinuousWork || 300; // 5 hours default

        if (workMinutes > maxContinuousWork) {
            // Get breaks taken
            const breaks = await db.query.breakLogs.findMany({
                where: and(
                    eq(breakLogs.sessionId, activeSession.id),
                    eq(breakLogs.endTime, null)
                )
            });

            if (breaks.length === 0) {
                // No breaks taken - flag as missed
                const currentFlags = activeSession.complianceFlags as any || {};
                await db.update(shiftSessions).set({
                    complianceFlags: {
                        ...currentFlags,
                        missedBreak: true
                    }
                }).where(eq(shiftSessions.id, activeSession.id));

                return {
                    sessionId: activeSession.id,
                    workMinutes,
                    maxContinuousWork,
                    missed: true
                };
            }
        }

        return null;
    }

    /**
     * Register emergency departure for an employee:
     * - Ends active shift session with early departure flags
     * - Creates shift approval request of type EARLY_DEPARTURE
     * - Reassigns all active workflow tasks to available peers/supervisors
     * - Triggers system event EMERGENCY_DEPARTURE and dispatches Inngest event
     */
    static async registerEmergencyDeparture(data: {
        userId: string;
        branchId: string;
        companyId: string;
        reason: string;
        requestedBy?: string;
        targetUserId?: string;
        notes?: string;
    }) {
        const { userId, branchId, companyId, reason, requestedBy, targetUserId, notes } = data;

        // 1. Close active session if exists
        let activeSession = await db.query.shiftSessions.findFirst({
            where: and(
                eq(shiftSessions.userId, userId),
                eq(shiftSessions.status, 'ACTIVE')
            )
        });

        let closedSession = null;
        if (activeSession) {
            closedSession = await this.endSession(userId);
        }

        // 2. Create Shift Approval for EARLY_DEPARTURE
        const approvalTitle = `Salida de Emergencia: ${reason}`;
        const approval = await ShiftApprovalService.createApproval({
            companyId,
            branchId,
            approvalType: 'EARLY_DEPARTURE',
            requestedBy: requestedBy || userId,
            requestedFor: userId,
            title: approvalTitle,
            reason: reason,
            description: notes,
            shiftSessionId: activeSession?.id
        });

        // 3. Reassign active pending workflows
        const reassignmentResult = await WorkflowAssignmentService.reassignUserPendingWorkflows(
            userId,
            branchId,
            targetUserId,
            requestedBy
        );

        // 4. Trigger system event for workflows
        const launchedWorkflows = await WorkflowTriggerService.handleEvent(branchId, 'EMERGENCY_DEPARTURE', {
            userId,
            branchId,
            companyId,
            reason,
            sessionId: activeSession?.id,
            reassignedCount: reassignmentResult.reassignedCount,
            newAssigneeId: reassignmentResult.targetUserId
        });

        // 5. Dispatch Inngest event
        try {
            await inngest.send({
                name: "employee/emergency.departure",
                data: {
                    userId,
                    branchId,
                    companyId,
                    reason,
                    notes,
                    requestedBy: requestedBy || userId,
                    sessionId: activeSession?.id,
                    reassignedCount: reassignmentResult.reassignedCount,
                    targetUserId: reassignmentResult.targetUserId,
                    approvalId: approval.id,
                }
            });
        } catch (inngestErr) {
            console.error("[ShiftService] Failed to dispatch Inngest emergency departure event:", inngestErr);
        }

        return {
            success: true,
            approval,
            closedSession,
            reassignmentResult,
            launchedWorkflowsCount: launchedWorkflows.length
        };
    }
}
