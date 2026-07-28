"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { AlertTriangle, RefreshCw } from "lucide-react"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Dashboard error:", error)
  }, [error])

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <Card className="max-w-md w-full text-center">
        <CardHeader>
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 mb-3">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <CardTitle>Algo salió mal</CardTitle>
          <CardDescription>
            Ocurrió un error inesperado al cargar esta página. Puedes intentar de nuevo.
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <Button onClick={reset} variant="default" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
