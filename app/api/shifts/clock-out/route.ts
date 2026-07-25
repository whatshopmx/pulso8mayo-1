import { NextRequest, NextResponse } from "next/server";
import { ShiftWorkflowService } from "@/lib/services/shift-workflow-service";
import { inngest } from "@/lib/inngest/client";
import { auth } from "@/lib/auth";

export interface ClockOutRequest {
    geolocation?: {
        latitude: number;
        longitude: number;
        accuracy?: number;
        timestamp?: number;
    };
}

export async function POST(req: NextRequest) {
    try {
        // Get authenticated user
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: "No autorizado" },
                { status: 401 }
            );
        }

        const userId = session.user.id;
        const body: ClockOutRequest = await req.json();
        const { geolocation } = body;

        // Check if user has an active session
        const activeSession = await ShiftWorkflowService.getActiveSession(userId);
        
        if (!activeSession) {
            return NextResponse.json(
                { 
                    success: false, 
                    message: "No tienes una sesión activa. Registra tu entrada primero." 
                },
                { status: 400 }
            );
        }

        await inngest.send({
            name: "shift/clock-out.requested",
            data: { userId, phoneNumber: session.user.phone || "", geolocation },
        });

        return NextResponse.json({
            success: true,
            message: "Salida registrada exitosamente",
            session: activeSession
        });
    } catch (error) {
        console.error("Error in clock-out API:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 }
        );
    }
}

export async function GET() {
    return NextResponse.json({
        description: "Clock-out endpoint with geolocation verification",
        method: "POST",
        body: {
            geolocation: {
                latitude: "number (optional)",
                longitude: "number (optional)",
                accuracy: "number (optional, in meters)",
                timestamp: "number (optional, Unix timestamp)"
            }
        },
        responses: {
            200: "Clock-out exitoso",
            400: "No hay sesión activa",
            401: "No autorizado"
        }
    });
}
