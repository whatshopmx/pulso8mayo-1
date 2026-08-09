"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, FileText, Plus } from "lucide-react";
import { useBranch } from "@/lib/branch-context";
import { OutOfScheduleLauncher } from "@/components/workflow/out-of-schedule-launcher";
import { ShareWorkflow } from "@/components/workflow/share-workflow";
import { SHIFT_BANDS, TodayProgress, TodayStateBadge, shiftBandKey } from "@/components/workflow/today-status";
import type { TodayItemState } from "@/lib/workflows/today";

interface TodayItem {
    scheduleId: string;
    templateId: string;
    title: string;
    timeOfDay: string | null;
    shift: string | null;
    state: TodayItemState;
    executionId: string | null;
    completedAt: string | null;
    assignee: { name: string | null; whatsappPhone: string | null } | null;
}

interface TodayBranch {
    branchId: string;
    branchName: string;
    localDate: string;
    expected: number;
    done: number;
    overdue: number;
    worstState: TodayItemState | null;
    items: TodayItem[];
}

function formatToday(): string {
    return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long" })
        .format(new Date());
}

function formatCompletedAt(iso: string | null): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function WorkflowsTodayPage() {
    const { selectedBranchId, setSelectedBranchId, branches: allBranches } = useBranch();
    const [data, setData] = useState<TodayBranch[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(false);
        try {
            const query = selectedBranchId ? `?branchId=${encodeURIComponent(selectedBranchId)}` : "";
            const res = await fetch(`/api/workflows/today${query}`);
            if (!res.ok) throw new Error();
            const body = await res.json();
            setData(body.branches ?? []);
        } catch {
            // Un fallo de carga NO puede verse como un día tranquilo: se distingue
            // explícitamente de "no hay nada programado".
            setError(true);
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [selectedBranchId]);

    useEffect(() => { load(); }, [load]);

    // Una sola sucursal — por alcance elegido o porque la empresa sólo tiene una —
    // se lee como el día de esa sucursal, no como un tablero de una fila.
    const singleBranch = data?.length === 1 ? data[0] : null;

    return (
        <div className="flex flex-col gap-6 p-4 lg:p-6">
            <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="min-w-0">
                    {/* Al entrar a una sucursal cambiamos el alcance global, así que
                        hace falta una salida visible de vuelta al tablero. Sólo
                        aparece si el usuario realmente tiene más de una sucursal. */}
                    {selectedBranchId && allBranches.length > 1 && (
                        <button
                            type="button"
                            onClick={() => setSelectedBranchId(null)}
                            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-1 min-h-[2.75rem] sm:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        >
                            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                            Todas las sucursales
                        </button>
                    )}
                    <h1 className="text-2xl font-bold tracking-tight truncate">
                        {singleBranch ? singleBranch.branchName : "Hoy en tus sucursales"}
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1.5">
                        <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="first-letter:uppercase">{formatToday()}</span>
                    </p>
                </div>
                <div className="flex gap-2 shrink-0">
                    <Button variant="outline" className="h-11" asChild>
                        <Link href="/dashboard/workflows/history">
                            <FileText className="h-4 w-4 mr-2" aria-hidden="true" /> Historial
                        </Link>
                    </Button>
                    <Button className="h-11" asChild>
                        <Link href="/dashboard/builder">
                            <Plus className="h-4 w-4 mr-2" aria-hidden="true" /> Nuevo flujo
                        </Link>
                    </Button>
                </div>
            </header>

            {loading ? (
                <TodaySkeleton />
            ) : error ? (
                <ErrorState onRetry={load} />
            ) : !data || data.length === 0 ? (
                <EmptyPanel
                    title="No hay sucursales activas"
                    body="Cuando registres una sucursal, aquí verás su operación del día."
                />
            ) : singleBranch ? (
                <BranchDay branch={singleBranch} />
            ) : (
                <BranchBoard branches={data} onOpen={setSelectedBranchId} />
            )}
        </div>
    );
}

/** Tablero: una fila por sucursal, lo que urge arriba. */
function BranchBoard({
    branches,
    onOpen,
}: {
    branches: TodayBranch[];
    onOpen: (branchId: string) => void;
}) {
    const overdueBranches = branches.filter((b) => b.overdue > 0).length;

    return (
        <section className="space-y-4">
            <p className="text-sm text-muted-foreground" role="status">
                {overdueBranches === 0
                    ? "Ninguna sucursal tiene pendientes vencidos."
                    : overdueBranches === 1
                        ? "1 sucursal tiene pendientes vencidos."
                        : `${overdueBranches} sucursales tienen pendientes vencidos.`}
            </p>

            <ul className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                {branches.map((branch) => (
                    <li key={branch.branchId}>
                        <button
                            type="button"
                            onClick={() => onOpen(branch.branchId)}
                            className="w-full flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 min-h-[3.5rem] text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <span className="flex-1 min-w-0 font-medium truncate">{branch.branchName}</span>

                            {branch.worstState === null ? (
                                <span className="text-sm text-muted-foreground">Sin programación</span>
                            ) : (
                                <>
                                    <TodayProgress done={branch.done} expected={branch.expected} />
                                    <span className="w-36 shrink-0">
                                        <TodayStateBadge
                                            state={branch.worstState}
                                            detail={branch.overdue > 1 ? `· ${branch.overdue}` : null}
                                        />
                                    </span>
                                </>
                            )}

                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}

/** Día de una sucursal, agrupado por turno. */
function BranchDay({ branch }: { branch: TodayBranch }) {
    const bands = [...SHIFT_BANDS, { key: "sin-turno", label: "" }]
        .map((band) => ({
            ...band,
            items: branch.items.filter((item) => shiftBandKey(item.shift) === band.key),
        }))
        .filter((band) => band.items.length > 0);

    const allDone = branch.expected > 0 && branch.done === branch.expected;

    return (
        <section className="space-y-6">
            {branch.expected === 0 ? (
                <EmptyPanel
                    title="Sin programación para hoy"
                    body="Esta sucursal no tiene flujos programados para hoy. Puedes iniciar uno cuando lo necesites."
                />
            ) : (
                <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <TodayProgress done={branch.done} expected={branch.expected} />
                        {allDone && (
                            <TodayStateBadge state="HECHO" detail="· todo el día completado" />
                        )}
                    </div>

                    {bands.map((band) => (
                        <div key={band.key} className="space-y-2">
                            {band.label && (
                                <h2 className="text-sm font-semibold text-muted-foreground">{band.label}</h2>
                            )}
                            <ul className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                                {band.items.map((item) => (
                                    <TodayRow key={item.scheduleId} item={item} branch={branch} />
                                ))}
                            </ul>
                        </div>
                    ))}
                </>
            )}

            <OutOfScheduleLauncher branchId={branch.branchId} branchName={branch.branchName} />
        </section>
    );
}

function TodayRow({ item, branch }: { item: TodayItem; branch: TodayBranch }) {
    const router = useRouter();
    const completedAt = formatCompletedAt(item.completedAt);

    // Una fila lleva a la ejecución si existe; si no, no hay a dónde ir todavía.
    const href = item.executionId
        ? item.state === "HECHO"
            ? `/dashboard/workflows/review/${item.executionId}`
            : `/dashboard/workflows/${item.executionId}/execute`
        : null;

    const label = (
        <>
            <span className="w-14 shrink-0 text-sm tabular-nums text-muted-foreground">
                {item.timeOfDay ?? "—"}
            </span>
            <span className="flex-1 min-w-0 truncate font-medium">{item.title}</span>
        </>
    );

    return (
        <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 min-h-[3.25rem]">
            {href ? (
                <button
                    type="button"
                    onClick={() => router.push(href)}
                    className="flex flex-1 min-w-0 items-center gap-x-3 py-1.5 text-left rounded hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    {label}
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                </button>
            ) : (
                <span className="flex flex-1 min-w-0 items-center gap-x-3 py-1.5">{label}</span>
            )}

            <TodayStateBadge
                state={item.state}
                detail={item.state === "HECHO" ? completedAt : null}
                className="shrink-0"
            />

            {/* Un flujo ya hecho no se reparte. */}
            {item.state !== "HECHO" && (
                <ShareWorkflow
                    executionId={item.executionId}
                    templateId={item.templateId}
                    branchId={branch.branchId}
                    title={item.title}
                    branchName={branch.branchName}
                    assignee={item.assignee}
                />
            )}
        </li>
    );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
    return (
        <div className="rounded-lg border border-border bg-muted/30 px-6 py-10 text-center">
            <p className="font-medium">{title}</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto text-pretty">{body}</p>
        </div>
    );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
    return (
        <div className="rounded-lg border border-border px-6 py-10 text-center" role="alert">
            <AlertTriangle className="h-6 w-6 mx-auto text-destructive" aria-hidden="true" />
            <p className="font-medium mt-3">No pudimos cargar el estado de hoy</p>
            <p className="text-sm text-muted-foreground mt-1">
                Revisa tu conexión. Los flujos siguen en su lugar.
            </p>
            <Button variant="outline" className="mt-4" onClick={onRetry}>Reintentar</Button>
        </div>
    );
}

/** Esqueleto con la forma del tablero, no un spinner que se come la página. */
function TodaySkeleton() {
    return (
        <div className="space-y-4">
            <Skeleton className="h-4 w-64" />
            <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-4 py-4">
                        <Skeleton className="h-4 flex-1 max-w-48" />
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-4 w-20" />
                    </div>
                ))}
            </div>
        </div>
    );
}
