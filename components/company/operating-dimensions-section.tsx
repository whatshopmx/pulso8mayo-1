"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UtensilsCrossed, Landmark, ShieldCheck, Check, Info, CircleHelp, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EXPLICACION_CLASIFICACION,
  ETIQUETA_CLASIFICACION,
  politicaPorCampo,
  type ClasificacionPolitica,
} from "@/lib/company/operating-policy-catalog";

/**
 * C15 — las siete dimensiones se guardan, pero ninguna gobierna la operación hoy.
 *
 * La tarjeta antes promete en su encabezado «enrutar autorizaciones,
 * consolidar reportes y gobernar sucursales» y cada opción lleva un distintivo
 * que insinúa el efecto («Control Estricto», «Visibilidad Total»). Ninguna de
 * esas frases era cierta: el catálogo verificó campo por campo que ningún
 * servicio lee estas columnas. Ahora cada dimensión declara su estado con el
 * catálogo como única fuente, y la opción describe el modelo declarado sin
 * prometer una regla que nadie aplica.
 */
const ICONO_CLASIFICACION: Record<ClasificacionPolitica, typeof Info> = {
  aplicada: Check,
  descriptiva: Info,
  pendiente: CircleHelp,
};

export interface OperatingDimensionsValues {
  purchasingStructure: string;
  foodProduction: string;
  treasuryModel: string;
  supplierPayment: string;
  managerAutonomy: string;
  payrollDispersion: string;
  tenantType: string;
}

interface DimensionOption {
  value: string;
  title: string;
  impactBadge: string;
  desc: string;
}

interface DimensionConfig {
  id: keyof OperatingDimensionsValues;
  label: string;
  description: string;
  options: DimensionOption[];
}

const OPERATING_GROUPS: {
  title: string;
  description: string;
  icon: typeof UtensilsCrossed;
  dimensions: DimensionConfig[];
}[] = [
  {
    title: "Operación y Alimentos",
    description: "Describe el flujo de abasto y la preparación de alimentos del grupo.",
    icon: UtensilsCrossed,
    dimensions: [
      {
        id: "purchasingStructure",
        label: "Estructura de Compras",
        description: "¿Quién negocia y emite las órdenes de compra a proveedores?",
        options: [
          {
            value: "CENTRALIZADA",
            title: "Centralizada",
            impactBadge: "Corporativo",
            desc: "Mesas de compra unificadas para el grupo; máximo volumen.",
          },
          {
            value: "POR_SUCURSAL",
            title: "Por Sucursal",
            impactBadge: "Local",
            desc: "Gerentes cotizan y compran directo a proveedores zonales.",
          },
          {
            value: "HIBRIDO",
            title: "Híbrido",
            impactBadge: "Mixto",
            desc: "Insumos clave por corporativo; perecederos y frescos en sucursal.",
          },
        ],
      },
      {
        id: "foodProduction",
        label: "Producción de Alimentos",
        description: "¿Dónde se transforman los insumos y recetas base?",
        options: [
          {
            value: "IN_SITU",
            title: "In Situ",
            impactBadge: "En Restaurante",
            desc: "Preparación y cocción 100% en la cocina de cada sucursal.",
          },
          {
            value: "COCINA_CENTRAL",
            title: "Comisariato Central",
            impactBadge: "Producción Central",
            desc: "Cocina centralizada elabora sub-recetas y distribuye.",
          },
          {
            value: "MIXTO",
            title: "Mixto / Ensamble",
            impactBadge: "Sub-recetas + Ensamble",
            desc: "Bases desde comisariato con preparación final en sucursal.",
          },
        ],
      },
    ],
  },
  {
    title: "Tesorería y Dispersión de Pagos",
    description: "Describe cómo el grupo organiza sus cuentas, pagos y nómina.",
    icon: Landmark,
    dimensions: [
      {
        id: "treasuryModel",
        label: "Modelo de Tesorería",
        description: "Estructura de cuentas bancarias receptoras de venta.",
        options: [
          {
            value: "CUENTA_UNICA",
            title: "Cuenta Única",
            impactBadge: "Concentradora",
            desc: "Una sola cuenta concentra todos los ingresos de la cadena.",
          },
          {
            value: "CUENTA_POR_SUCURSAL",
            title: "Por Sucursal",
            impactBadge: "Segregada",
            desc: "Cada sucursal opera y cobra en su propia cuenta bancaria.",
          },
          {
            value: "MIXTO",
            title: "Mixto",
            impactBadge: "Híbrido",
            desc: "Cuentas operativas locales combinadas con una cuenta concentradora del grupo.",
          },
        ],
      },
      {
        id: "supplierPayment",
        label: "Pago a Proveedores",
        description: "¿Quién autoriza y programa la dispersión de facturas?",
        options: [
          {
            value: "CENTRALIZADO",
            title: "Centralizado",
            impactBadge: "Finanzas Corporativo",
            desc: "Dirección de Finanzas liquida facturas en calendario maestro.",
          },
          {
            value: "POR_SUCURSAL",
            title: "Por Sucursal",
            impactBadge: "Gerente / Admin Local",
            desc: "Cada unidad programa y paga a sus contrapartes directas.",
          },
          {
            value: "HIBRIDO",
            title: "Híbrido",
            impactBadge: "Por Partida",
            desc: "Corporativo paga compras mayores; sucursal paga servicios menores.",
          },
        ],
      },
      {
        id: "payrollDispersion",
        label: "Dispersión de Nómina",
        description: "Esquema de pago de sueldos y timbrado de recibos.",
        options: [
          {
            value: "CONSOLIDADA",
            title: "Consolidada",
            impactBadge: "Una sola corrida",
            desc: "El grupo declara una sola corrida de nómina para todas sus sucursales.",
          },
          {
            value: "POR_RAZON_SOCIAL",
            title: "Por Razón Social",
            impactBadge: "Por Empresa / Sucursal",
            desc: "El grupo declara corridas separadas por entidad legal o franquicia.",
          },
          {
            value: "MIXTO",
            title: "Mixto",
            impactBadge: "Esquema Dividido",
            desc: "El grupo declara nómina fija consolidada con propinas e incentivos locales.",
          },
        ],
      },
    ],
  },
  {
    title: "Gobernanza y Estructura del Grupo",
    description: "Describe la delegación de decisiones y la propiedad de las sucursales.",
    icon: ShieldCheck,
    dimensions: [
      {
        id: "managerAutonomy",
        label: "Autonomía del Gerente de Sucursal",
        description: "Capacidad de decisión del gerente antes de requerir firma corporativa.",
        options: [
          {
            value: "ALTA",
            title: "Alta",
            impactBadge: "Decide el gerente",
            desc: "El grupo describe al gerente de sucursal como quien decide las compras ordinarias.",
          },
          {
            value: "MEDIA",
            title: "Media",
            impactBadge: "Catálogo acotado",
            desc: "El grupo describe al gerente sujeto a catálogo autorizado y límite monetario.",
          },
          {
            value: "BAJA",
            title: "Baja",
            impactBadge: "Visto bueno corporativo",
            desc: "El grupo describe toda orden o gasto con visto bueno de corporativo.",
          },
        ],
      },
      {
        id: "tenantType",
        label: "Tipo de Estructura del Grupo",
        description: "Esquema de propiedad y aislamiento de información del grupo.",
        options: [
          {
            value: "GRUPO_PROPIO",
            title: "Grupo Propio (100% Unidades Corporativas)",
            impactBadge: "Unidades propias",
            desc: "El grupo declara que todas sus sucursales son de la misma entidad de negocio.",
          },
          {
            value: "MIXTO_FRANQUICIAS",
            title: "Mixto con Franquiciatarios",
            impactBadge: "Con franquiciatarios",
            desc: "El grupo declara franquiciatarios en la red. El aislamiento de información se marca sucursal por sucursal, no desde aquí.",
          },
        ],
      },
    ],
  },
];

/**
 * Estado de una política, tal como lo declara el catálogo de C15. El texto
 * largo vive en `EXPLICACION_CLASIFICACION` para que la definición viva en un
 * solo sitio y la prueba pueda contarla.
 */
function ClasificacionBadge({ clasificacion }: { clasificacion: ClasificacionPolitica }) {
  const Icono = ICONO_CLASIFICACION[clasificacion];
  const esAplicada = clasificacion === "aplicada";
  return (
    <Badge
      variant="secondary"
      className={cn(
        "text-xs py-0 px-1.5 font-normal tracking-tight gap-1 shrink-0",
        esAplicada
          ? "bg-primary/15 text-primary border-primary/20"
          : clasificacion === "pendiente"
            ? "bg-muted text-foreground border-border"
            : "bg-muted text-muted-foreground"
      )}
    >
      <Icono className="h-3 w-3" aria-hidden="true" />
      {ETIQUETA_CLASIFICACION[clasificacion]}
    </Badge>
  );
}

interface OperatingDimensionsSectionProps {
  values: OperatingDimensionsValues;
  onChange: (key: keyof OperatingDimensionsValues, value: string) => void;
}

export function OperatingDimensionsSection({
  values,
  onChange,
}: OperatingDimensionsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <UtensilsCrossed className="w-5 h-5 text-foreground" /> Dimensiones Estructurales del Modelo Operativo
        </CardTitle>
        <CardDescription className="text-xs">
          Estas selecciones documentan cómo opera el grupo. Hoy no cambian permisos, aprobaciones,
          movimientos de inventario ni pagos. Cada campo indica su estado.
        </CardDescription>
        <dl className="mt-3 grid grid-cols-1 xl:grid-cols-3 gap-3">
          {(Object.keys(ETIQUETA_CLASIFICACION) as ClasificacionPolitica[]).map((clasificacion) => (
            <div key={clasificacion} className="flex items-start gap-1.5">
              <dt className="shrink-0">
                <ClasificacionBadge clasificacion={clasificacion} />
              </dt>
              <dd className="text-xs text-muted-foreground leading-tight pt-0.5">
                {EXPLICACION_CLASIFICACION[clasificacion]}
              </dd>
            </div>
          ))}
        </dl>
      </CardHeader>

      <CardContent className="space-y-8">
        {OPERATING_GROUPS.map((group, gIdx) => {
          const GroupIcon = group.icon;
          return (
            <div key={gIdx} className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border/70">
                <div className="p-1 rounded bg-muted text-foreground">
                  <GroupIcon className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground">{group.title}</h4>
                  <p className="text-xs text-muted-foreground">{group.description}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {group.dimensions.map((dim) => {
                  const currentValue = values[dim.id];
                  const isWide = dim.options.length === 2;
                  const politica = politicaPorCampo(dim.id);
                  const clasificacion = politica?.clasificacion ?? "descriptiva";

                  return (
                    <div
                      key={dim.id}
                      className={cn(
                        "space-y-2 p-3.5 rounded-lg bg-muted/20 border border-border/60 transition-colors",
                        dim.id === "tenantType" && "lg:col-span-2"
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span id={`${dim.id}-label`} className="text-xs font-semibold text-foreground">
                          {dim.label}
                        </span>
                        <ClasificacionBadge clasificacion={clasificacion} />
                      </div>
                      <p className="text-xs text-muted-foreground">{dim.description}</p>
                      <p id={`${dim.id}-estado`} className="text-xs text-muted-foreground">
                        {EXPLICACION_CLASIFICACION[clasificacion]}
                      </p>
                      {clasificacion === "pendiente" && politica?.decisionPendiente && (
                        <p className="text-xs text-muted-foreground flex items-start gap-1.5 leading-normal">
                          <Clock className="h-3 w-3 mt-0.5 shrink-0" aria-hidden="true" />
                          <span>{politica.decisionPendiente}</span>
                        </p>
                      )}

                      <div
                        role="radiogroup"
                        aria-labelledby={`${dim.id}-label`}
                        aria-describedby={`${dim.id}-estado`}
                        className={cn(
                          "grid gap-2 pt-1.5",
                          isWide
                            ? "grid-cols-1 sm:grid-cols-2"
                            : "grid-cols-1 sm:grid-cols-3"
                        )}
                      >
                        {dim.options.map((opt, optionIndex) => {
                          const isSelected = currentValue === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              role="radio"
                              aria-checked={isSelected}
                              tabIndex={isSelected || (!dim.options.some((o) => o.value === currentValue) && optionIndex === 0) ? 0 : -1}
                              onClick={() => onChange(dim.id, opt.value)}
                              onKeyDown={(event) => {
                                const step = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1
                                  : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
                                if (!step) return;
                                event.preventDefault();
                                const nextIndex = (optionIndex + step + dim.options.length) % dim.options.length;
                                onChange(dim.id, dim.options[nextIndex].value);
                                const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
                                radios?.[nextIndex]?.focus();
                              }}
                              className={cn(
                                "group text-left p-2.5 rounded-md border text-xs transition-all relative flex flex-col justify-between focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                                isSelected
                                  ? "bg-card border-primary ring-1 ring-primary/30"
                                  : "bg-background/60 border-border/70 hover:bg-card hover:border-border text-muted-foreground"
                              )}
                            >
                              <div className="space-y-1 w-full">
                                <div className="flex items-start justify-between gap-1.5">
                                  <span
                                    className={cn(
                                      "font-medium text-xs leading-snug",
                                      isSelected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                                    )}
                                  >
                                    {opt.title}
                                  </span>
                                  {isSelected && (
                                    <div className="p-0.5 rounded-full bg-primary text-primary-foreground shrink-0">
                                      <Check className="w-3 h-3" />
                                    </div>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground/90 leading-tight">
                                  {opt.desc}
                                </p>
                              </div>

                              <div className="pt-2 mt-auto">
                                <Badge
                                  variant={isSelected ? "default" : "secondary"}
                                  className={cn(
                                    "text-xs py-0 px-1.5 font-normal tracking-tight",
                                    isSelected
                                      ? "bg-primary/15 text-primary border-primary/20 hover:bg-primary/20"
                                      : "bg-muted text-muted-foreground hover:bg-muted"
                                  )}
                                >
                                  {opt.impactBadge}
                                </Badge>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
