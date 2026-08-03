import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { employeeOnboarding, onboardingSteps, employeeOffboarding, users } from '@/lib/db/schema';
import { eq, and, desc, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantAuth } from '@/lib/api/with-auth';

// Onboarding validation schema — userId and companyId from session
const onboardingSchema = z.object({
  branchId: z.string().optional(),
  startDate: z.string(),
  targetEndDate: z.string().optional(),
  assignedBuddyId: z.string().optional(),
  assignedMentorId: z.string().optional(),
  notes: z.string().optional(),
  hrNotes: z.string().optional(),
});

// Offboarding validation schema — userId and companyId from session
const offboardingSchema = z.object({
  branchId: z.string().optional(),
  reason: z.enum([
    'VOLUNTARY_RESIGNATION',
    'TERMINATION_WITH_CAUSE',
    'TERMINATION_WITHOUT_CAUSE',
    'CONTRACT_EXPIRED',
    'RETIREMENT',
    'DEATH',
    'MUTUAL_AGREEMENT',
    'OTHER'
  ]),
  reasonDetails: z.string().optional(),
  resignationDate: z.string().optional(),
  lastWorkingDay: z.string(),
  finalPayDate: z.string().optional(),
  accruedVacationDays: z.number().optional(),
  vacationPay: z.number().optional(),
  seniorityBonus: z.number().optional(),
  severancePay: z.number().optional(),
  finalPayAmount: z.number().optional(),
  deductions: z.number().optional(),
  assetsToReturn: z.array(z.string()).optional(),
  exitInterviewNotes: z.string().optional(),
  hrNotes: z.string().optional(),
  notes: z.string().optional(),
});

// GET - Get onboarding/offboarding records
export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const type = searchParams.get('type'); // 'onboarding' or 'offboarding'

    const result: any = {};

    // Get onboarding records — always scoped to authenticated tenant
    if (!type || type === 'onboarding') {
      const onboardingConditions: SQL[] = [];
      
      if (userId) {
        onboardingConditions.push(eq(employeeOnboarding.userId, userId));
      }
      // Always filter by authenticated tenant
      onboardingConditions.push(eq(employeeOnboarding.companyId, auth.tenantId));

      const onboardings = await db
        .select()
        .from(employeeOnboarding)
        .where(onboardingConditions.length > 0 ? and(...onboardingConditions) : undefined)
        .orderBy(desc(employeeOnboarding.startDate));

      // Get steps for each onboarding
      for (const onboarding of onboardings) {
        const steps = await db
          .select()
          .from(onboardingSteps)
          .where(eq(onboardingSteps.onboardingId, onboarding.id))
          .orderBy(onboardingSteps.dueDate);

        (onboarding as any).steps = steps;
      }

      result.onboardings = onboardings;
    }

    // Get offboarding records
    if (!type || type === 'offboarding') {
      const offboardingConditions: SQL[] = [];
      
      if (userId) {
        offboardingConditions.push(eq(employeeOffboarding.userId, userId));
      }
      // Always filter by authenticated tenant
      offboardingConditions.push(eq(employeeOffboarding.companyId, auth.tenantId));

      const offboardings = await db
        .select()
        .from(employeeOffboarding)
        .where(offboardingConditions.length > 0 ? and(...offboardingConditions) : undefined)
        .orderBy(desc(employeeOffboarding.createdAt));

      result.offboardings = offboardings;
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error fetching onboarding/offboarding records:', error);
    return NextResponse.json(
      { error: 'Failed to fetch records' },
      { status: 500 }
    );
  }
});

// POST - Create onboarding
export const POST = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const body = await request.json();
    // userId comes from the body target (who's being onboarded), not the session
    const { userId, ...restData } = body;
    const validatedData = onboardingSchema.parse(restData);

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    // Check if onboarding already exists
    const existingOnboarding = await db
      .select()
      .from(employeeOnboarding)
      .where(eq(employeeOnboarding.userId, userId))
      .limit(1);

    if (existingOnboarding && existingOnboarding.length > 0) {
      return NextResponse.json(
        { error: 'Onboarding already exists for this user' },
        { status: 409 }
      );
    }

    // Create onboarding
    const [newOnboarding] = await db
      .insert(employeeOnboarding)
      .values({
        userId,
        companyId: auth.tenantId,
        branchId: validatedData.branchId,
        startDate: new Date(validatedData.startDate),
        targetEndDate: validatedData.targetEndDate ? new Date(validatedData.targetEndDate) : null,
        assignedBuddyId: validatedData.assignedBuddyId,
        assignedMentorId: validatedData.assignedMentorId,
        status: 'IN_PROGRESS',
        notes: validatedData.notes,
        hrNotes: validatedData.hrNotes,
        createdBy: auth.user.id,
      })
      .returning();

    // Create default onboarding steps
    const defaultSteps = [
      { stepName: 'Documentación requerida', description: 'Subir documentos obligatorios', stepCategory: 'DOCUMENTS', dueDays: 3 },
      { stepName: 'Firma de contrato', description: 'Firma del contrato de trabajo', stepCategory: 'DOCUMENTS', dueDays: 1 },
      { stepName: 'Alta en IMSS', description: 'Registro en el Instituto Mexicano del Seguro Social', stepCategory: 'COMPLIANCE', dueDays: 5 },
      { stepName: 'Capacitación de seguridad', description: 'Entrenamiento en protocolos de seguridad', stepCategory: 'TRAINING', dueDays: 7 },
      { stepName: 'Asignación de equipo', description: 'Entrega de uniforme y herramientas de trabajo', stepCategory: 'SETUP', dueDays: 1 },
      { stepName: 'Introducción al equipo', description: 'Conocer al equipo de trabajo', stepCategory: 'ORIENTATION', dueDays: 3 },
    ];

    const startDate = new Date(validatedData.startDate);
    for (const step of defaultSteps) {
      const dueDate = new Date(startDate);
      dueDate.setDate(dueDate.getDate() + step.dueDays);

      await db.insert(onboardingSteps).values({
        onboardingId: newOnboarding.id,
        stepName: step.stepName,
        description: step.description,
        stepCategory: step.stepCategory,
        status: 'PENDING',
        dueDate: dueDate,
      });
    }

    return NextResponse.json({
      success: true,
      data: newOnboarding,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 422 }
      );
    }

    console.error('Error creating onboarding:', error);
    return NextResponse.json(
      { error: 'Failed to create onboarding' },
      { status: 500 }
    );
  }
});

// PATCH - Update onboarding status or complete step
export const PATCH = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const body = await request.json();
    const { onboardingId, stepId, action, notes } = body;

    if (!onboardingId || !action) {
      return NextResponse.json(
        { error: 'onboardingId and action are required' },
        { status: 400 }
      );
    }

    // Complete a step
    if (action === 'complete_step' && stepId) {
      const [updatedStep] = await db
        .update(onboardingSteps)
        .set({
          status: 'COMPLETED',
          completedDate: new Date(),
          completedBy: auth.user.id,
          notes: notes,
        })
        .where(eq(onboardingSteps.id, stepId))
        .returning();

      // Check if all required steps are completed
      const steps = await db
        .select()
        .from(onboardingSteps)
        .where(eq(onboardingSteps.onboardingId, onboardingId));

      const requiredSteps = steps.filter(s => s.stepCategory !== 'ORIENTATION'); // ORIENTATION steps are not required
      const completedRequiredSteps = requiredSteps.filter(s => s.status === 'COMPLETED');

      // Update onboarding progress
      const progressPercentage = Math.round((completedRequiredSteps.length / requiredSteps.length) * 100);
      const allRequiredCompleted = completedRequiredSteps.length === requiredSteps.length;

      await db
        .update(employeeOnboarding)
        .set({
          progressPercentage,
          status: allRequiredCompleted ? 'COMPLETED' : 'IN_PROGRESS',
          updatedAt: new Date(),
        })
        .where(eq(employeeOnboarding.id, onboardingId));

      return NextResponse.json({
        success: true,
        data: updatedStep,
        progress: progressPercentage,
      });
    }

    // Mark onboarding as completed
    if (action === 'complete_onboarding') {
      const [updatedOnboarding] = await db
        .update(employeeOnboarding)
        .set({
          status: 'COMPLETED',
          completedDate: new Date(),
          progressPercentage: 100,
          updatedAt: new Date(),
        })
        .where(eq(employeeOnboarding.id, onboardingId))
        .returning();

      // Update user status
      await db
        .update(users)
        .set({
          updatedAt: new Date(),
        })
        .where(eq(users.id, updatedOnboarding.userId));

      return NextResponse.json({
        success: true,
        data: updatedOnboarding,
      });
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error updating onboarding:', error);
    return NextResponse.json(
      { error: 'Failed to update onboarding' },
      { status: 500 }
    );
  }
});

// DELETE - Cancel onboarding
export const DELETE = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const onboardingId = searchParams.get('onboardingId');

    if (!onboardingId) {
      return NextResponse.json(
        { error: 'onboardingId is required' },
        { status: 400 }
      );
    }

    // Get the onboarding to find the user
    const [onboarding] = await db
      .select()
      .from(employeeOnboarding)
      .where(eq(employeeOnboarding.id, onboardingId))
      .limit(1);

    if (!onboarding) {
      return NextResponse.json(
        { error: 'Onboarding not found' },
        { status: 404 }
      );
    }

    // Update onboarding status to cancelled
    await db
      .update(employeeOnboarding)
      .set({
        status: 'CANCELLED',
        updatedAt: new Date(),
      })
      .where(eq(employeeOnboarding.id, onboardingId));

    return NextResponse.json({
      success: true,
      message: 'Onboarding cancelled successfully',
    });
  } catch (error) {
    console.error('Error cancelling onboarding:', error);
    return NextResponse.json(
      { error: 'Failed to cancel onboarding' },
      { status: 500 }
    );
  }
});
