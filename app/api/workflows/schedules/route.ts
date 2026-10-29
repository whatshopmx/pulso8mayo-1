import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { WorkflowScheduleService } from '@/lib/services/workflow-schedule-service';
import { createScheduleSchema, scheduleFiltersSchema } from '@/lib/validations/workflow-scheduling';
import { apiResponse, apiError } from '@/lib/api/response';

/**
 * GET /api/workflows/schedules
 * List schedules for a branch with optional filters
 */
export async function GET(request: NextRequest) {
    try {
        const session = await auth.api.getSession({ headers: request.headers });

        if (!session?.user) {
            return apiError('Unauthorized', 401);
        }

        const { searchParams } = new URL(request.url);
        const branchId = searchParams.get('branchId');

        if (!branchId) {
            return apiError('branchId is required', 400);
        }

        // Un parámetro ausente no es un filtro nulo: se omite para que el
        // schema `.optional()` lo acepte y la lista cargue sin filtros.
        const filters: Record<string, unknown> = {};

        const isActiveParam = searchParams.get('isActive');
        if (isActiveParam !== null) {
            // Un valor distinto de true/false se pasa tal cual para que el
            // schema lo rechace con detalle en vez de ignorarlo en silencio.
            filters.isActive = isActiveParam === 'true' ? true : isActiveParam === 'false' ? false : isActiveParam;
        }

        const frequencyParam = searchParams.get('frequency');
        if (frequencyParam !== null) {
            filters.frequency = frequencyParam;
        }

        const assignmentTypeParam = searchParams.get('assignmentType');
        if (assignmentTypeParam !== null) {
            filters.assignmentType = assignmentTypeParam;
        }

        // Validate filters
        const validatedFilters = scheduleFiltersSchema.safeParse(filters);
        if (!validatedFilters.success) {
            return apiError('Invalid filters', 400, validatedFilters.error.issues);
        }

        const schedules = await WorkflowScheduleService.getSchedules(branchId, validatedFilters.data);

        return apiResponse(schedules);

    } catch (error) {
        console.error('Error fetching schedules:', error);
        return apiError('Failed to fetch schedules', 500);
    }
}

/**
 * POST /api/workflows/schedules
 * Create a new schedule
 */
export async function POST(request: NextRequest) {
    try {
        const session = await auth.api.getSession({ headers: request.headers });

        if (!session?.user) {
            return apiError('Unauthorized', 401);
        }

        const body = await request.json();

        // Validate input
        const validated = createScheduleSchema.safeParse(body);
        if (!validated.success) {
            return apiError('Validation failed', 400, validated.error.issues);
        }

        // Convert date strings to Date objects
        const data = {
            ...validated.data,
            startDate: new Date(validated.data.startDate),
            endDate: validated.data.endDate ? new Date(validated.data.endDate) : undefined,
            createdBy: session.user.id,
        };

        const schedule = await WorkflowScheduleService.createSchedule(data);

        return apiResponse(schedule, 201);

    } catch (error) {
        console.error('Error creating schedule:', error);
        return apiError('Failed to create schedule', 500);
    }
}
