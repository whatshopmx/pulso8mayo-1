/**
 * PROTOTIPO — "Comando de Red" reimaginado.
 *
 * No es una página de producto. Es la respuesta ejecutable a la pregunta
 * "¿cómo sería si la página contestara una sola vez?".
 *
 * Qué reemplaza (las cinco lecturas del mismo estado de 3 sucursales):
 *   1. LivePulseBanner      (dot + píldora roja + 4 tiles de pilar)
 *   2. LiveRushAlerts       (panel rojo a todo lo ancho + card anidada)
 *   3. LiveCommandMatrix    (3 filas × 5 celdas)
 *   4. GroupAreaOverview    (6 cards × 3 filas = 18 líneas)
 *   5. RecentActivity       (sin cambios)
 *
 * Con qué se queda:
 *   UN veredicto + su prueba + tira de áreas + bitácora.
 *
 * Todo el cromo viene del inventario existente: PageContainer, PageHeader,
 * Card, Badge, Button, Separator, Table, lucide. Cero componentes nuevos,
 * cero tokens nuevos, cero sombras.
 *
 * Los datos son los reales capturados del entorno sembrado (ned. 2026-10-16).
 *
 * Borrar con: rm -rf app/dashboard/prototipo
 */
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  DollarSign,
  Eye,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  Store,
  Users,
} from "lucide-react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PageContainer, PageHeader } from "@/components/shared"

// ─────────────────────────────────────────────────────────────────────────────
// Datos reales del entorno sembrado
// ─────────────────────────────────────────────────────────────────────────────

const FECHA_OPERATIVA = "mié 16 oct 2026"

/** Pulso del turno — antes: 4 tiles con borde. */
const PULSO = {
  aperturasATiempo: 0,
  totalSucursales: 3,
  colaboradoresEnPiso: 0,
  dotacionRegistrada: false,
  ventaAcumulada: 0,
  riesgosNom251: 1,
}

/** Estado por sucursal — antes: la Matriz Operativa como card aparte. */
const SUCURSALES = [
  {
    nombre: "Condesa",
    atencion: true,
    apertura: "Pendiente de apertura",
    personal: "Sin dotación configurada",
    frio: "Sin lectura hoy",
    venta: "$0 en curso",
    alertas: 1,
  },
  {
    nombre: "Polanco",
    atencion: false,
    apertura: "Pendiente de apertura",
    personal: "Sin dotación configurada",
    frio: "Sin lectura hoy",
    venta: "$0 en curso",
    alertas: 2,
  },
  {
    nombre: "Roma",
    atencion: false,
    apertura: "Pendiente de apertura",
    personal: "Sin dotación configurada",
    frio: "Sin lectura hoy",
    venta: "$0 en curso",
    alertas: 1,
  },
]

/**
 * El motivo dominante: el hecho, no el adjetivo.
 * Reusa la lógica de LivePulseBanner, que ya calculaba esto y luego lo tiraba.
 */
const MOTIVO = "sin apertura a tiempo ni frío NOM-251 registrado"

/** Tira de áreas — antes: 6 cards con valor, badge y 3 filas de excepción cada uno. */
const AREAS = [
  { nombre: "Operación", url: "/dashboard/operations", abiertas: 4 },
  { nombre: "Inventario", url: "/dashboard/inventory", abiertas: 11 },
  { nombre: "Personal", url: "/dashboard/labor", abiertas: 1 },
  { nombre: "Cumplimiento", url: "/dashboard/compliance", abiertas: 4 },
  { nombre: "Equipos", url: "/dashboard/equipment", abiertas: 3 },
  { nombre: "Finanzas", url: "/dashboard/finance", abiertas: 0 },
]

/** Bitácora — mismos datos, mismas columnas, 6 filas. */
const BITACORA = [
  { flujo: "Conteo de Inventario", estado: "En Progreso", score: 13, quien: "María García", cuando: "hace 4 días" },
  { flujo: "Conteo de Inventario", estado: "En Progreso", score: 13, quien: "Carlos Méndez", cuando: "hace 30 días" },
  { flujo: "Mantenimiento de Equipos de Refrigeración", estado: "Completado", score: 100, quien: "Pedro Sánchez", cuando: "hace 1 mes" },
  { flujo: "Cierre de Sucursal (Fin de Día)", estado: "Pendiente", score: 0, quien: "Carlos Méndez", cuando: "hace 1 mes" },
  { flujo: "Control de Higiene Personal", estado: "Pendiente", score: 0, quien: "Carlos Méndez", cuando: "hace 1 mes" },
  { flujo: "Reporte de Incidentes", estado: "Completado", score: 59, quien: "Luisa Fernández", cuando: "hace 2 meses" },
]

// ─────────────────────────────────────────────────────────────────────────────

const formatoMoneda = (centavos: number) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(centavos)

/** Un hecho del turno. Icono + valor + etiqueta, en línea, sin borde ni caja. */
function Hecho({
  icon: Icon,
  valor,
  etiqueta,
  tono = "neutral",
}: {
  icon: typeof Store
  valor: string
  etiqueta: string
  tono?: "neutral" | "warning" | "destructive" | "success"
}) {
  const color =
    tono === "destructive"
      ? "text-destructive"
      : tono === "warning"
        ? "text-warning-text"
        : tono === "success"
          ? "text-success-text"
          : "text-foreground"

  return (
    <div className="flex items-center gap-2 min-w-0">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className={`text-sm font-semibold tabular-nums tracking-tight ${color}`}>{valor}</span>
      <span className="text-xs text-muted-foreground">{etiqueta}</span>
    </div>
  )
}

export default function ComandoDeRedPrototipo() {
  const aperturas = `${PULSO.aperturasATiempo}/${PULSO.totalSucursales}`
  const conAtencion = SUCURSALES.filter((s) => s.atencion)

  return (
    <PageContainer>
      {/*
        El encabezado declara su propia ventana. Antes la página decía "en vivo"
        mientras el único control de tiempo del shell decía "Todo el periodo".
        Una ventana no es un control: si no se puede cambiar, no se dibuja como select.
      */}
      <PageHeader
        title="Comando de Red"
        description={`Turno actual · ${FECHA_OPERATIVA} · ${PULSO.totalSucursales} sucursales`}
        actions={
          <>
            <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground">
              <Clock className="h-3 w-3" />
              Actualizado hace 40 s
            </Badge>
            <Button variant="outline" size="sm" className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Actualizar
            </Button>
          </>
        }
      />

      {/* ═══════════════════════════════════════════════════════════════════
          1 — EL VEREDICTO
          Una sola frase. Todo lo demás de esta pantalla es su prueba.
          Antes eran tres bloques compitiendo por decir exactamente esto.
      ════════════════════════════════════════════════════════════════════ */}
      <Card className="border-border shadow-none py-0">
        <CardContent className="p-6 space-y-4">
          {/* La frase */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <span className="relative flex h-3 w-3 mt-1 shrink-0">
                {/* `animate-ping` sólo cuando está estable: el latido celebra,
                    no alarma. Con algo abierto, el punto se queda quieto. */}
                {conAtencion.length === 0 && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-3 w-3 ${
                    conAtencion.length > 0 ? "bg-warning" : "bg-success"
                  }`}
                />
              </span>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
                  {conAtencion.length === 0
                    ? "Las 3 sucursales abrieron a tiempo"
                    : `${conAtencion.length} de ${PULSO.totalSucursales} sucursales requiere atención`}
                </h2>
                {conAtencion.length > 0 && (
                  <p className="text-sm text-muted-foreground mt-1 text-pretty">
                    <span className="font-medium text-foreground">{conAtencion[0].nombre}</span> — {MOTIVO}
                    <span className="text-muted-foreground/70"> · </span>
                    Incendio menor en parrilla
                    <Badge variant="outline" className="ml-2 font-normal">
                      Inocuidad &amp; Frío
                    </Badge>
                  </p>
                )}
              </div>
            </div>

            {/* Una acción. Rojo operativo usado UNA vez en la pantalla. */}
            <Button size="default" className="gap-1.5 shrink-0">
              <ShieldAlert className="h-4 w-4" />
              Atender Condesa
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          <Separator />

          {/* La prueba, en una línea. Antes: cuatro tiles de 88px con borde. */}
          {/* Una columna en el teléfono: con dos, la etiqueta se recortaba
              ("aperturas a …", "venta acumu…") y eso es exactamente lo que
              el rediseño venía a quitar. */}
          <div className="grid grid-cols-1 gap-y-2.5 sm:grid-cols-2 sm:gap-x-6 lg:grid-cols-4">
            <Hecho
              icon={Store}
              valor={aperturas}
              etiqueta="aperturas a tiempo"
              tono="warning"
            />
            <Hecho
              icon={Users}
              valor={`${PULSO.colaboradoresEnPiso}`}
              etiqueta="colaboradores en piso"
              tono="warning"
            />
            <Hecho icon={DollarSign} valor={formatoMoneda(PULSO.ventaAcumulada)} etiqueta="venta acumulada" />
            <Hecho
              icon={AlertTriangle}
              valor={`${PULSO.riesgosNom251}`}
              etiqueta="riesgo NOM-251"
              tono="destructive"
            />
          </div>

          <Separator />

          {/* La matriz, degradada a evidencia del veredicto: filas de 49px,
              no cards. Sigue siendo el mismo dato, ya no es un segundo juicio. */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Detalle por sucursal</p>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-8 py-0 text-xs">Sucursal</TableHead>
                    <TableHead className="h-8 py-0 text-xs">Apertura</TableHead>
                    <TableHead className="h-8 py-0 text-xs">Personal</TableHead>
                    <TableHead className="h-8 py-0 text-xs">Frío NOM-251</TableHead>
                    <TableHead className="h-8 py-0 text-xs">Venta hoy</TableHead>
                    <TableHead className="h-8 py-0 text-xs text-right">Alertas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SUCURSALES.map((s) => (
                    <TableRow key={s.nombre} className="h-[49px]">
                      <TableCell className="py-2">
                        <Link
                          href="/dashboard/branches"
                          className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
                        >
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                          {s.nombre}
                          {s.atencion && (
                            <span className="h-1.5 w-1.5 rounded-full bg-warning shrink-0" aria-label="Requiere atención" />
                          )}
                        </Link>
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">{s.apertura}</TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">{s.personal}</TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">{s.frio}</TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground tabular-nums">{s.venta}</TableCell>
                      <TableCell className="py-2 text-right">
                        <Link
                          href="/dashboard/exceptions"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                        >
                          Ver <span className="font-semibold tabular-nums text-foreground">{s.alertas}</span>
                          <ChevronRight className="h-3 w-3" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Móvil: seis columnas no caben en 390px — la tabla se desbordaba
                y recortaba "Personal" y "Frío NOM-251". Se apila; mismo dato. */}
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border md:hidden">
              {SUCURSALES.map((s) => (
                <div key={s.nombre} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">{s.nombre}</span>
                      {s.atencion && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-label="Requiere atención" />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {s.apertura} · {s.frio}
                    </p>
                  </div>
                  <Link
                    href="/dashboard/exceptions"
                    className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                  >
                    Ver <span className="font-semibold tabular-nums text-foreground">{s.alertas}</span>
                    <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════
          2 — POR ÁREA
          Antes: 6 cards, cada uno con valor grande, badge ámbar y hasta 3 filas
          de excepción (18 líneas que repetían la cola). Ahora: una fila de links.
          Ningún número compite con el veredicto porque ninguno es un veredicto.
      ════════════════════════════════════════════════════════════════════ */}
      {/* Sin separadores "·": al envolver en móvil dejaban un punto huérfano
          al inicio de la segunda línea. El espacio hace el trabajo. */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Por área</span>
        {AREAS.map((a) => (
          <Link
            key={a.nombre}
            href={a.url}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {a.nombre}
            {a.abiertas > 0 ? (
              <span className="text-xs font-semibold tabular-nums text-foreground">{a.abiertas}</span>
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            )}
          </Link>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          3 — LA BITÁCORA
          Único bloque de la página que es cronológico y por eso no repite
          ningún resumen de estado. Se queda tal cual, con filas de 49px.
      ════════════════════════════════════════════════════════════════════ */}
      <Card className="border-border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Actividad Reciente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar flujo o responsable…" className="h-8 pl-8 text-sm" />
          </div>

          {/* Escritorio: la tabla de 6 columnas. */}
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">Flujo de trabajo</TableHead>
                  <TableHead className="text-xs">Estado</TableHead>
                  <TableHead className="text-xs">Calificación</TableHead>
                  <TableHead className="text-xs">Asignado a</TableHead>
                  <TableHead className="text-xs">Actualizado</TableHead>
                  <TableHead className="text-xs text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {BITACORA.map((r, i) => (
                  <TableRow key={`${r.flujo}-${i}`} className="h-[49px]">
                    <TableCell className="py-2 text-sm font-medium">{r.flujo}</TableCell>
                    <TableCell className="py-2">
                      <Badge
                        variant={r.estado === "Completado" ? "success" : "warning"}
                        className="gap-1 font-medium"
                      >
                        {r.estado === "Completado" ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <Clock className="h-3 w-3" />
                        )}
                        {r.estado}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2 text-xs font-semibold tabular-nums text-muted-foreground">
                      {r.score}%
                    </TableCell>
                    <TableCell className="py-2 text-sm text-muted-foreground">{r.quien}</TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">{r.cuando}</TableCell>
                    <TableCell className="py-2 text-right">
                      {/* El <Link> envolvía un <Button>: el área clicable real era
                          el botón de 32px, pero el ancla inline reportaba 19px.
                          Un solo elemento clicleable por acción. */}
                      {r.estado === "Completado" ? (
                        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
                          <Eye className="h-3.5 w-3.5" />
                          Ver detalles
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                          <Play className="h-3.5 w-3.5" />
                          {r.score > 0 ? "Continuar" : "Iniciar"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Móvil: de las 6 columnas sólo quedaba "Flujo de trabajo" visible —
              estado, calificación, responsable, fecha y acción quedaban fuera
              de la pantalla. Se apila en una fila de 3 líneas. */}
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border md:hidden">
            {BITACORA.map((r, i) => (
              <div key={`${r.flujo}-m-${i}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{r.flujo}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge
                      variant={r.estado === "Completado" ? "success" : "warning"}
                      className="gap-1 font-medium"
                    >
                      {r.estado === "Completado" ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <Clock className="h-3 w-3" />
                      )}
                      {r.estado}
                    </Badge>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {r.score}% · {r.quien} · {r.cuando}
                    </span>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 text-xs">
                  {r.estado === "Completado" ? (
                    <Eye className="h-3.5 w-3.5" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  {r.estado === "Completado" ? "Ver" : r.score > 0 ? "Continuar" : "Iniciar"}
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Nota de prototipo — se borra junto con la carpeta. */}
      <p className="text-xs text-muted-foreground/70">
        Prototipo de rediseño · la página real sigue en{" "}
        <Link href="/dashboard" className="underline underline-offset-2">
          /dashboard
        </Link>{" "}
        · la cola de excepciones reimaginada está en{" "}
        <Link href="/dashboard/prototipo/cola" className="underline underline-offset-2">
          /dashboard/prototipo/cola
        </Link>
      </p>
    </PageContainer>
  )
}
