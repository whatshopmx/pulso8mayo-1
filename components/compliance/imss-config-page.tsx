'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, CheckCircle2, Save, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader, ErrorState } from '@/components/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { isRegistroPatronal } from '@/lib/services/compliance/imss-registro';
import { ImssSubNav } from './imss-sub-nav';
import { ImssLoading, ImssNotice, ImssSummaryCards, useImssConfig } from './imss-status';
import { imssJson, type ImssBranchConfig } from './imss-client';

/**
 * T1–T3 (`tasks/plan-imss-operacion.md`): el registro patronal se captura desde
 * el propio módulo IMSS, sin obligar a entrar a Organización → Sucursales (ruta
 * que `GERENTE`/`SUPERVISOR` tienen prohibida, aunque sí ven el módulo).
 *
 * La pantalla es consultable por `READONLY`; quién puede escribir lo decide el
 * servidor (`canConfigure`), no este componente: deshabilitar un input no es
 * un permiso.
 */
export function ImssConfigPage() {
    const config = useImssConfig();
    const [revision, setRevision] = useState(0);
    const [announcement, setAnnouncement] = useState('');

    if (config.loading) return <ImssChrome><ImssLoading /></ImssChrome>;
    if (config.error) {
        return <ImssChrome><ErrorState message={config.error} onRetry={config.refresh} /></ImssChrome>;
    }
    if (!config.data) return <ImssChrome>{null}</ImssChrome>;

    const { branches, canConfigure, configuredCount, primaRiesgoTrabajo } = config.data;
    const missing = branches.length - configuredCount;

    function saved(branch: ImssBranchConfig, value: string) {
        setAnnouncement(value
            ? `Registro patronal de ${branch.name} guardado.`
            : `Registro patronal de ${branch.name} eliminado.`);
        setRevision(previous => previous + 1);
        config.refresh();
    }

    return <ImssChrome>
        <Alert><ShieldAlert className="h-4 w-4" /><AlertDescription>
            El registro patronal lo asigna el IMSS por centro de trabajo: cada sucursal puede tener el suyo. Capturarlo aquí es lo que habilita Altas, Bajas y SUA; Pulso no lo envía a ningún portal.
        </AlertDescription></Alert>

        {!canConfigure && <Alert><AlertDescription>
            Esta pantalla es de consulta para tu rol. El registro patronal lo captura un administrador de la empresa.
        </AlertDescription></Alert>}

        <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {announcement || `${configuredCount} de ${branches.length} ${branches.length === 1 ? 'sucursal configurada' : 'sucursales configuradas'}.`}
        </div>

        {/* Los KPIs se remontan al guardar: el Resumen comparte endpoint y no
            debe seguir mostrando deuda calculada con el registro anterior. */}
        <ImssSummaryCards key={revision} />

        <Card>
            <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                    <Building2 className="h-4 w-4" />Registro patronal por sucursal
                    {missing > 0 && <Badge variant="secondary">{missing} sin registro</Badge>}
                </CardTitle>
                <CardDescription>
                    11 caracteres de la tarjeta patronal: primera posición alfanumérica y diez dígitos. Deja el campo vacío para borrar el registro.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {!branches.length
                    ? <p className="text-sm text-muted-foreground">No hay sucursales en tu alcance. Créalas en Organización → Sucursales.</p>
                    : branches.map(branch => <BranchRow key={branch.id} branch={branch} canConfigure={canConfigure}
                        onSaved={value => saved(branch, value)} />)}
            </CardContent>
        </Card>

        {primaRiesgoTrabajo !== null && <Alert><CheckCircle2 className="h-4 w-4" /><AlertDescription>
            Prima de riesgo de trabajo registrada: {primaRiesgoTrabajo}. Es un dato de registro y no alimenta el cálculo de cuotas obrero-patronales.
        </AlertDescription></Alert>}
    </ImssChrome>;
}

function ImssChrome({ children }: { children: React.ReactNode }) {
    return <div className="space-y-6">
        <PageHeader title="Configuración IMSS" description="Registro patronal por sucursal y datos con los que se arman los archivos" icon={ShieldAlert} />
        <ImssSubNav />
        <ImssNotice />
        {children}
    </div>;
}

function BranchRow({ branch, canConfigure, onSaved }: {
    branch: ImssBranchConfig; canConfigure: boolean; onSaved: (value: string) => void;
}) {
    const [value, setValue] = useState(branch.imssRegistroPatronal ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputId = `imss-registro-${branch.id}`;
    const helpId = `${inputId}-help`;

    // El valor del servidor manda tras un guardado o un refresco.
    useEffect(() => { setValue(branch.imssRegistroPatronal ?? ''); }, [branch.imssRegistroPatronal]);

    const normalized = value.trim().toUpperCase();
    const valid = normalized === '' || isRegistroPatronal(normalized);
    const changed = normalized !== (branch.imssRegistroPatronal ?? '');
    const disabled = busy || !canConfigure;

    async function save(event: React.FormEvent) {
        event.preventDefault();
        if (!valid || !changed || busy || !canConfigure) return;
        setBusy(true); setError(null);
        try {
            await imssJson('/api/imss/config', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ branchUpdates: [{ branchId: branch.id, imssRegistroPatronal: normalized }] }),
            });
            toast.success(normalized ? 'Registro patronal guardado' : 'Registro patronal eliminado');
            onSaved(normalized);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'No se pudo guardar el registro patronal');
        } finally {
            setBusy(false);
        }
    }

    return <form onSubmit={save} className="space-y-2 rounded-md border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor={inputId} className="font-medium">{branch.name}</Label>
            <div className="flex items-center gap-2">
                {!branch.active && <Badge variant="secondary">Inactiva</Badge>}
                {branch.configured
                    ? <Badge>Registrado</Badge>
                    : <Badge variant="secondary">Sin registro</Badge>}
            </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1 space-y-1">
                <Input id={inputId} value={value} maxLength={11} autoCapitalize="characters" inputMode="text"
                    placeholder="A1234567890" disabled={disabled} aria-invalid={!valid}
                    aria-describedby={helpId} onChange={event => { setValue(event.target.value); setError(null); }} />
                <p id={helpId} className="text-xs text-muted-foreground">
                    {branch.employees} {branch.employees === 1 ? 'empleado activo' : 'empleados activos'} en esta sucursal.
                </p>
            </div>
            {canConfigure && <Button type="submit" variant="outline" disabled={disabled || !changed || !valid}>
                <Save className="mr-2 h-4 w-4" />{busy ? 'Guardando…' : 'Guardar'}
            </Button>}
        </div>
        {!valid && <p className="text-xs text-destructive" role="alert">
            Debe tener 11 caracteres: la primera letra o número y después diez dígitos.
        </p>}
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        {!canConfigure && <p className="text-xs text-muted-foreground">
            Pide a un administrador que capture este dato. <Link className="underline underline-offset-2" href="/dashboard/compliance/imss">Volver al resumen</Link>
        </p>}
    </form>;
}
