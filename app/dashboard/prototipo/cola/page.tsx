"use client"

/**
 * PROTOTIPO — "Excepciones & Riesgos" reimaginado como cola + expediente.
 *
 * Responde la pregunta: "si la cola fuera tabla y el card fuera el panel de
 * detalle, ¿cuánto scroll queda?".
 *
 * Antes: 23 cards de ~188px = ~4,370px, 3 por viewport, 25 violaciones de
 * card-anidada, y la única frase que explica cada excepción recortada por
 * `line-clamp-1`.
 *
 * Ahora: 23 filas de 49px = ~1,130px, ~18 por viewport. La descripción
 * completa vive en el expediente, así que el truncado deja de existir en vez
 * de parchasse.
 *
 * Dos cambios que no son de layout y sí de verdad:
 *
 *   1. La EDAD pesa lo mismo que la severidad. Hoy el badge dice "Fatal" en
 *      rojo y la edad susurra "hace 2 meses" en gris de 12px. Un Fatal de 60
 *      días no es un riesgo fatal: es deuda sin resolver, y tiene que leerse
 *      así. Con este dataset eso importa más que el orden.
 *
 *   2. El orden deja de ser severidad-primero. `group-exceptions-service.ts:457`
 *      compara severidad y sólo usa la fecha para desempatar, así que un Fatal
 *      viejo no puede ser desplazado por nada que no sea otro Fatal. Aquí la
 *      urgencia decae con la edad (`rank × decay`). Con estos datos el
 *      reordenamiento es casi invisible — y eso es precisamente el hallazgo:
 *      lo que arregla la pantalla hoy es la edad visible, no el comparador.
 *
 * El patrón de dos paneles ya existe en este producto: /dashboard/finance
 * ("Pendientes" / "Expediente del caso"). No se inventa nada.
 *
 * Borrar con: rm -rf app/dashboard/prototipo
 */
import { useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  RefreshCw,
  Search,
} from "lucide-react"

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
// Datos reales del entorno sembrado (ned. 2026-10-16)
// ─────────────────────────────────────────────────────────────────────────────

type Severidad = "fatal" | "critical" | "high" | "warning" | "info"
type Categoria = "INOCUIDAD" | "ABASTO" | "PERSONAL" | "DINERO"

interface Excepcion {
  id: string
  severidad: Severidad
  categoria: Categoria
  sucursal: string
  titulo: string
  descripcion: string
  impacto: string
  detectadoHaceDias: number
  accion: string
  asignado?: string
}

const EXCEPCIONES: Excepcion[] = [
  {
    id: "inc-condesa-parrilla",
    severidad: "fatal",
    categoria: "INOCUIDAD",
    sucursal: "Condesa",
    titulo: "Incendio menor en parrilla",
    descripcion:
      "Una llamarada en la parrilla activó los rociadores. Daños menores. Requiere reporte de siniestro y verificación de la línea de gas antes de reabrir la estación de cocción.",
    impacto: "Desviación operativa en línea de servicio",
    detectadoHaceDias: 60,
    accion: "Revisar incidente",
  },
  {
    id: "cmp-roma-score",
    severidad: "critical",
    categoria: "INOCUIDAD",
    sucursal: "Roma",
    titulo: "Score de cumplimiento bajo en Roma",
    descripcion:
      "El score de cumplimiento NOM-251 en Roma está por debajo del mínimo aceptable. Requiere plan de remediación con fecha compromiso y evidencia fotográfica por punto.",
    impacto: "Riesgo de no conformidad sanitaria NOM-251",
    detectadoHaceDias: 60,
    accion: "Atender alerta sanitaria",
  },
  {
    id: "ab-polanco-lechuga",
    severidad: "high",
    categoria: "ABASTO",
    sucursal: "Polanco",
    titulo: "Stock bajo en insumo clave: Lechuga Romana",
    descripcion:
      "El stock de Lechuga Romana está por debajo del mínimo operativo definido para el turno. Considera una transferencia desde otra sucursal o una orden urgente.",
    impacto: "Riesgo de desabasto en rush de ventas",
    detectadoHaceDias: 30,
    accion: "Transferir insumos",
  },
  {
    id: "ab-condesa-huevo",
    severidad: "high",
    categoria: "ABASTO",
    sucursal: "Condesa",
    titulo: "Stock bajo en insumo clave: Huevo Blanco",
    descripcion:
      "El stock de Huevo Blanco está por debajo del mínimo operativo. Revisa el consumo de las últimas 48 h antes de reordenar.",
    impacto: "Riesgo de desabasto en rush de ventas",
    detectadoHaceDias: 45,
    accion: "Transferir insumos",
  },
  {
    id: "ab-condesa-crema",
    severidad: "high",
    categoria: "ABASTO",
    sucursal: "Condesa",
    titulo: "Stock bajo en insumo clave: Crema Ácida",
    descripcion:
      "El stock de Crema Ácida está por debajo del mínimo operativo. Producto perecedero: prioriza rotación sobre compra.",
    impacto: "Riesgo de desabasto en rush de ventas",
    detectadoHaceDias: 45,
    accion: "Transferir insumos",
  },
  {
    id: "cmp-roma-fumigacion",
    severidad: "high",
    categoria: "INOCUIDAD",
    sucursal: "Roma",
    titulo: "Deadline vencido: Remediación externa (FUMIGATION)",
    descripcion:
      "La remediación externa de fumigación venció sin evidencia cargada. El proveedor debe entregar certificado vigente para sostener el expediente NOM-251.",
    impacto: "Expediente NOM-251 incompleto",
    detectadoHaceDias: 52,
    accion: "Solicitar evidencia",
  },
  {
    id: "per-roma-stps",
    severidad: "high",
    categoria: "PERSONAL",
    sucursal: "Roma",
    titulo: "Accidente reportado — se requiere reporte STPS",
    descripcion:
      "Se reportó un accidente de trabajo y el reporte STPS sigue sin capturarse. La ventana de notificación es perecedera.",
    impacto: "Riesgo de incumplimiento NOM-035 / STPS",
    detectadoHaceDias: 60,
    accion: "Capturar reporte",
  },
  {
    id: "ino-polanco-campana",
    severidad: "warning",
    categoria: "INOCUIDAD",
    sucursal: "Polanco",
    titulo: "Incumplimiento en limpieza de campana",
    descripcion:
      "La limpieza de campana no se registró dentro de la frecuencia configurada. Es punto crítico de control para prevención de incendios.",
    impacto: "Punto crítico de control sin evidencia",
    detectadoHaceDias: 38,
    accion: "Programar limpieza",
  },
  {
    id: "per-condesa-turno",
    severidad: "warning",
    categoria: "PERSONAL",
    sucursal: "Condesa",
    titulo: "Cambio de turno: Cita médica familiar",
    descripcion:
      "Solicitud de cambio de turno por cita médica familiar. Requiere aprobación del gerente de sucursal y ajuste de cuadrante.",
    impacto: "Cobertura de turno en riesgo",
    detectadoHaceDias: 3,
    accion: "Revisar solicitud",
  },
  {
    id: "eq-condesa-fumigacion",
    severidad: "info",
    categoria: "INOCUIDAD",
    sucursal: "Condesa",
    titulo: "Fumigación programada para mañana",
    descripcion:
      "Servicio de fumigación agendado para mañana. Recuerda despejar áreas de almacén y cargar el certificado al expediente.",
    impacto: "Servicio preventivo agendado",
    detectadoHaceDias: 5,
    accion: "Ver orden de servicio",
  },
  {
    id: "eq-condesa-preventivo",
    severidad: "info",
    categoria: "INOCUIDAD",
    sucursal: "Condesa",
    titulo: "Mantenimiento preventivo próximo",
    descripcion:
      "Mantenimiento preventivo de refrigeración próximo a vencer según el plan de mantenimiento de la sucursal.",
    impacto: "Mantenimiento preventivo por vencer",
    detectadoHaceDias: 6,
    accion: "Agendar mantenimiento",
  },
  {
    id: "eq-roma-freidora",
    severidad: "warning",
    categoria: "INOCUIDAD",
    sucursal: "Roma",
    titulo: "Mantenimiento de freidora",
    descripcion:
      "La freidora reportó una lectura fuera de rango en el último ciclo de mantenimiento.",
    impacto: "Equipo con lectura fuera de rango",
    detectadoHaceDias: 1,
    accion: "Revisar equipo",
  },
  {
    id: "ino-roma-campana",
    severidad: "warning",
    categoria: "INOCUIDAD",
    sucursal: "Roma",
    titulo: "Limpieza de campana atrasada",
    descripcion:
      "La limpieza de campana de Roma presenta más de un periodo de atraso respecto a la frecuencia configurada.",
    impacto: "Acumulación de grasa en campana",
    detectadoHaceDias: 22,
    accion: "Programar limpieza",
  },
]

const TOTAL_ABIERTAS = 23

const CATEGORIAS: { id: "ALL" | Categoria; etiqueta: string; total: number }[] = [
  { id: "ALL", etiqueta: "Todas", total: TOTAL_ABIERTAS },
  { id: "DINERO", etiqueta: "Dinero & Caja", total: 0 },
  { id: "INOCUIDAD", etiqueta: "Inocuidad & Frío", total: 11 },
  { id: "ABASTO", etiqueta: "Mermas & Stock", total: 11 },
  { id: "PERSONAL", etiqueta: "Personal & Turnos", total: 1 },
]

// ─────────────────────────────────────────────────────────────────────────────
// Reglas de presentación
// ─────────────────────────────────────────────────────────────────────────────

/** El peso de la severidad, igual que en el servicio: fatal pesa más. */
const PESO: Record<Severidad, number> = {
  fatal: 100,
  critical: 60,
  high: 35,
  warning: 15,
  info: 5,
}

/**
 * La urgencia decae con la edad (vida media ≈ 45 días).
 * Es el comparador que falta en `group-exceptions-service.ts:457`, donde la
 * severidad decide y la fecha sólo desempata.
 */
const urgencia = (e: Excepcion) => PESO[e.severidad] * (1 / (1 + e.detectadoHaceDias / 45))

const ETIQUETA_SEVERIDAD: Record<Severidad, string> = {
  fatal: "Fatal",
  critical: "Crítico",
  high: "Alto",
  warning: "Aviso",
  info: "Info",
}

/**
 * La edad, con el mismo peso visual que la severidad.
 * Un umbral de 45 días convierte "hace 2 meses" en una alarma en vez de en
 * metadatos en gris.
 */
/**
 * La antigüedad, en su propia columna.
 *
 * Primero la hice como badge rojo por fila y reproduje el mismo pecado que le
 * critiqué al banner: 7 de 13 filas en rojo y nada destaca. Ahora la seсal la
 * carga LA COLUMNA — se lee en vertical, sin pintar la fila — y el color queda
 * sólo para el umbral que de verdad importa.
 */
function AntiguedadCelda({ dias }: { dias: number }) {
  const tono =
    dias >= 45
      ? "text-destructive font-semibold"
      : dias >= 14
        ? "text-warning-text font-medium"
        : "text-muted-foreground"

  return (
    <span className="inline-flex items-center gap-1.5">
      {dias >= 45 && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" aria-hidden />
      )}
      <span className={`font-mono text-xs tabular-nums ${tono}`}>{dias} d</span>
    </span>
  )
}

/** La misma antigüedad, en prosa, para el expediente. */
function AntiguedadTexto({ dias }: { dias: number }) {
  const texto = dias >= 45 ? `${dias} días sin resolver` : `${dias} días abierto`

  if (dias >= 45) {
    return (
      <Badge variant="outline" className="gap-1 border-destructive/30 bg-destructive/10 font-medium text-destructive">
        <AlertTriangle className="h-3 w-3" />
        {texto}
      </Badge>
    )
  }
  if (dias >= 14) {
    return (
      <Badge variant="warning" className="gap-1 font-medium">
        <Clock className="h-3 w-3" />
        {texto}
      </Badge>
    )
  }
  return <span className="text-xs text-muted-foreground">{texto}</span>
}

function ChipSeveridad({ severidad }: { severidad: Severidad }) {
  const clase =
    severidad === "fatal"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : severidad === "critical"
        ? "border-warning/40 bg-warning/15 text-warning-text"
        : severidad === "high"
          ? "border-border bg-muted text-foreground"
          : "border-border bg-transparent text-muted-foreground"

  return (
    <Badge variant="outline" className={`font-medium ${clase}`}>
      {ETIQUETA_SEVERIDAD[severidad]}
    </Badge>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ColaDeExcepcionesPrototipo() {
  const [categoria, setCategoria] = useState<"ALL" | Categoria>("ALL")
  const [seleccionada, setSeleccionada] = useState<string>(EXCEPCIONES[0].id)
  const [consulta, setConsulta] = useState("")

  const ordenadas = useMemo(
    () =>
      [...EXCEPCIONES]
        .filter((e) => categoria === "ALL" || e.categoria === categoria)
        .filter((e) =>
          consulta.trim() === ""
            ? true
            : `${e.titulo} ${e.sucursal}`.toLowerCase().includes(consulta.toLowerCase()),
        )
        .sort((a, b) => urgencia(b) - urgencia(a)),
    [categoria, consulta],
  )

  const item = EXCEPCIONES.find((e) => e.id === seleccionada) ?? EXCEPCIONES[0]
  // El umbral del encabezado y el del pie tienen que ser el mismo número que
  // la frase que los describe. Antes decía "más de 30 días" y contaba ≥14.
  const estancadas = EXCEPCIONES.filter((e) => e.detectadoHaceDias >= 30).length
  const sinResolver = EXCEPCIONES.filter((e) => e.detectadoHaceDias >= 45).length

  return (
    <PageContainer>
      {/*
        Un solo nombre para esta pantalla. Antes: barra lateral "Excepciones &
        Riesgos", breadcrumb "Excepciones", H1 "Centro de Excepciones & Riesgos".
        Y una frase de encabezado que dice lo que de verdad importa de esta cola.
      */}
      <PageHeader
        title="Excepciones & Riesgos"
        description={`${TOTAL_ABIERTAS} excepciones abiertas · ${estancadas} llevan más de 30 días sin resolverse`}
        actions={
          <Button variant="outline" size="sm" className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Actualizar
          </Button>
        }
      />

      {/*
        Los 5 filtros como chips de una línea (~36px) en vez de 5 cards de ~90px.
        La descripción de cada categoría desaparece con la card: existía sólo
        porque la card tenía espacio, y era justo lo que `line-clamp-1` recortaba
        a media frase ("Arqueos descuadrados, TPVs y…"). El nombre de la
        categoría ya dice lo que la categoría es.
      */}
      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIAS.map((c) => {
          const activa = categoria === c.id
          return (
            <button
              key={c.id}
              onClick={() => setCategoria(c.id)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                activa
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              {c.etiqueta}
              <span className={`tabular-nums ${activa ? "font-bold text-foreground" : ""}`}>{c.total}</span>
            </button>
          )
        })}

        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Buscar excepción o sucursal…"
            className="h-9 pl-8 text-sm"
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          Dos paneles: la cola y el expediente. El patrón ya existe en
          /dashboard/finance — no se inventa nada.
      ════════════════════════════════════════════════════════════════════ */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* La cola — filas de 49px en vez de cards de 188px */}
        <Card className="border-border shadow-none py-0 lg:col-span-7">
          <CardHeader className="px-6 pb-2 pt-6">
            <CardTitle className="text-sm font-semibold text-muted-foreground">
              Cola · {ordenadas.length} de {TOTAL_ABIERTAS} excepciones
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 text-xs">Severidad</TableHead>
                    <TableHead className="h-9 text-xs">Excepción</TableHead>
                    <TableHead className="h-9 text-xs">Sucursal</TableHead>
                    <TableHead className="h-9 text-xs">Antigüedad</TableHead>
                    <TableHead className="h-9 text-xs text-right">Abrir</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordenadas.map((e) => {
                    const activa = e.id === seleccionada
                    return (
                      <TableRow
                        key={e.id}
                        data-state={activa ? "selected" : undefined}
                        onClick={() => setSeleccionada(e.id)}
                        className="h-[49px] cursor-pointer"
                      >
                        <TableCell className="py-2">
                          <div className="flex items-center gap-2">
                            <ChipSeveridad severidad={e.severidad} />
                          </div>
                        </TableCell>
                        {/* `whitespace-normal`: TableCell trae nowrap, y con el
                            título + la edad en línea la tabla se desbordaba y
                            empujaba la columna de acción fuera de la vista. */}
                        <TableCell className="whitespace-normal py-2">
                          <span className="text-sm font-medium text-foreground">{e.titulo}</span>
                        </TableCell>
                        <TableCell className="py-2 text-xs text-muted-foreground">{e.sucursal}</TableCell>
                        <TableCell className="py-2">
                          <AntiguedadCelda dias={e.detectadoHaceDias} />
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          {/* Un chevron mudo, no un link rojo repetido 13 veces:
                              el rojo de esta pantalla pertenece a la severidad
                              y a la antigüedad, que son el hallazgo. */}
                          <ChevronRight
                            className={`ml-auto h-4 w-4 ${activa ? "text-foreground" : "text-muted-foreground/60"}`}
                            aria-hidden
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
              <span className="text-xs text-muted-foreground">
                Mostrando {ordenadas.length} de {TOTAL_ABIERTAS}
              </span>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                Ver todas
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* El expediente — donde vive la descripción completa */}
        <Card className="border-border shadow-none py-0 lg:col-span-5 lg:sticky lg:top-20 lg:self-start">
          <CardHeader className="px-6 pb-2 pt-6">
            <CardTitle className="text-sm font-semibold text-muted-foreground">Expediente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6">
            <div className="flex flex-wrap items-center gap-2">
              <ChipSeveridad severidad={item.severidad} />
              <AntiguedadTexto dias={item.detectadoHaceDias} />
              <Badge variant="outline" className="font-normal text-muted-foreground">
                {item.categoria}
              </Badge>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-base font-semibold tracking-tight text-balance text-foreground">
                {item.titulo}
              </h3>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Building2 className="h-3 w-3" />
                {item.sucursal}
              </p>
            </div>

            <p className="text-sm text-muted-foreground">{item.descripcion}</p>

            <div className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-text" />
              <span className="text-xs font-medium text-foreground">{item.impacto}</span>
            </div>

            <Separator />

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              <div>
                <dt className="text-muted-foreground">Detectado</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  hace {item.detectadoHaceDias} días
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Estado</dt>
                <dd className="mt-0.5 font-medium text-foreground">Abierta</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Asignado a</dt>
                <dd className="mt-0.5 font-medium text-foreground">{item.asignado ?? "Sin asignar"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Origen</dt>
                <dd className="mt-0.5 font-medium text-foreground">{item.categoria}</dd>
              </div>
            </dl>

            {/* Una acción principal, heredada del tipo de excepción
                ("Revisar incidente", "Transferir insumos"…) en vez de un botón
                genérico igual para las 23. */}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button size="default" className="flex-1 gap-1.5">
                {item.accion}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="default" className="gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Marcar en revisión
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground/70">
        Prototipo de rediseño · {sinResolver} excepciones llevan 45 días o más sin resolverse · la página real sigue en{" "}
        <a href="/dashboard/exceptions" className="underline underline-offset-2">
          /dashboard/exceptions
        </a>
      </p>
    </PageContainer>
  )
}
