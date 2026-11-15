import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  ClipboardCheck,
  BarChart3,
  Shield,
  MessageSquare,
  Package,
  Users,
  Zap,
  ArrowRight,
  Smartphone,
} from "lucide-react"

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (session?.user) {
    redirect("/dashboard")
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="border-b bg-background sticky top-0 z-50" aria-label="Navegación principal">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold tracking-tight">Pulso</span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild><Link href="/sign-in">Iniciar sesión</Link></Button>
            <Button size="sm" asChild><Link href="/sign-up">Crear cuenta</Link></Button>
          </div>
        </div>
      </nav>

      <main>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16 text-center">
        <Badge variant="secondary" className="mb-6">
          Operación de sucursales HORECA
        </Badge>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-foreground max-w-4xl mx-auto leading-tight">
          Opera, cumple y crece con{" "}
          <span className="text-primary">inteligencia</span>
        </h1>
        <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          La plataforma integral de gestión operativa y cumplimiento normativo para hoteles, restaurantes y cafés.
          Automatiza workflows, controla inventario y cumple NOM-251/NOM-035 desde un solo lugar.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button size="lg" className="gap-2 text-base px-8" asChild><Link href="/sign-up">Crear mi cuenta <ArrowRight className="h-4 w-4" /></Link></Button>
          <Button size="lg" variant="outline" className="text-base px-8" asChild><Link href="/sign-in">Iniciar sesión</Link></Button>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Crea tu empresa, registra una sucursal y organiza el primer turno.
        </p>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="border-border">
            <CardHeader>
              <ClipboardCheck className="h-10 w-10 text-primary mb-2" />
              <CardTitle className="text-lg">Workflows Inteligentes</CardTitle>
              <CardDescription>
                Crea y automatiza checklists de apertura, cierre, recepción de mercancía y control de calidad.
                Verificación con IA integrada.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <Package className="h-10 w-10 text-primary mb-2" />
              <CardTitle className="text-lg">Inventario en Tiempo Real</CardTitle>
              <CardDescription>
                Seguimiento de stock por lote y fecha de caducidad. Alertas automáticas de bajo stock y FIFO integrado.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <Shield className="h-10 w-10 text-primary mb-2" />
              <CardTitle className="text-lg">Cumplimiento NOM-251/035</CardTitle>
              <CardDescription>
                Reportes auditables para COFEPRIS y STPS. Generación automática de expedientes de cumplimiento.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <MessageSquare className="h-10 w-10 text-primary mb-2" />
              <CardTitle className="text-lg">Tareas por WhatsApp</CardTitle>
              <CardDescription>
                Ejecuta workflows, recibe alertas y confirma tareas directamente desde WhatsApp. Sin instalar nada extra.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <Users className="h-10 w-10 text-primary mb-2" />
              <CardTitle className="text-lg">Gestión de Personal</CardTitle>
              <CardDescription>
                Control de asistencia con geolocalización, gestión de turnos, horas extra y cumplimiento de LFT.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <BarChart3 className="h-10 w-10 text-primary mb-2" />
              <CardTitle className="text-lg">Analítica y KPIs</CardTitle>
              <CardDescription>
                Dashboards ejecutivos, comparación entre sucursales y reportes programados con tendencias.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12 text-foreground">
          Un pendiente del turno, de principio a fin
        </h2>
        <p className="mx-auto mb-8 max-w-2xl text-center text-muted-foreground">Ejemplo de uso: una sucursal registra una desviación de temperatura.</p>
        <div className="grid gap-8 md:grid-cols-3">
          <article className="space-y-3"><h3 className="text-lg font-semibold">Encuentra lo que requiere atención</h3><p className="text-sm leading-relaxed text-muted-foreground">Revisa la sucursal y el pendiente desde el centro de operación, sin buscar entre reportes de otras áreas.</p></article>
          <article className="space-y-3"><h3 className="text-lg font-semibold">Revisa la evidencia</h3><p className="text-sm leading-relaxed text-muted-foreground">Consulta la lectura y las evidencias de la tarea para entender qué ocurrió antes de decidir la corrección.</p></article>
          <article className="space-y-3"><h3 className="text-lg font-semibold">Da seguimiento a la corrección</h3><p className="text-sm leading-relaxed text-muted-foreground">Identifica a la persona responsable y revisa el avance del incidente hasta su resolución.</p></article>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <Card className="bg-muted/50 text-foreground">
          <CardContent className="py-12 px-8 text-center space-y-6">
            <Smartphone className="h-10 w-10 mx-auto text-primary" />
            <h2 className="text-2xl sm:text-3xl font-bold">
              Tu operación, desde WhatsApp
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-lg">
              Envía y recibe workflows, recibe alertas de cumplimiento y gestiona tu equipo sin abandonar la app que ya usas.
            </p>
            <Button size="lg" className="gap-2 text-base px-8" asChild><Link href="/sign-up">Crear mi cuenta <ArrowRight className="h-4 w-4" /></Link></Button>
          </CardContent>
        </Card>
      </section>

      </main>
      <footer className="border-t bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-primary flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sm">Pulso HORECA</span>
          </div>
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Pulso. Gestión operativa para HORECA.
          </p>
        </div>
      </footer>
    </div>
  )
}
