"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

export const description = "A bar chart showing workflows by status"

interface WorkflowStatus {
    status: string;
    count: number;
}

interface WorkflowStatusChartProps {
    data: WorkflowStatus[];
}

const statusMap: Record<string, string> = {
    'PENDING': 'Pendiente',
    'IN_PROGRESS': 'En Progreso',
    'COMPLETED': 'Completado',
    'OVERDUE': 'Vencido',
    'BLOCKED': 'Bloqueado'
}

const statusColors: Record<string, string> = {
    'PENDING': 'hsl(var(--chart-1))',
    'IN_PROGRESS': 'hsl(var(--chart-2))',
    'COMPLETED': 'hsl(var(--chart-3))',
    'OVERDUE': 'hsl(var(--destructive))',
    'BLOCKED': 'hsl(var(--chart-4))'
}

export function WorkflowStatusChart({ data }: WorkflowStatusChartProps) {
  const chartData = data.map(item => ({
    status: statusMap[item.status] || item.status,
    count: item.count,
    fill: statusColors[item.status] || 'hsl(var(--chart-5))',
  }))

  const chartConfig = {
    count: {
      label: "Cantidad",
    },
    ...Object.fromEntries(
        data.map(item => [
            item.status,
            {
                label: statusMap[item.status] || item.status,
                color: statusColors[item.status] || 'hsl(var(--chart-5))',
            }
        ])
    )
  } satisfies ChartConfig

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Flujos por Estado</CardTitle>
        <CardDescription>Distribución de tareas hoy</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="max-h-[250px] w-full">
          <BarChart
            accessibilityLayer
            data={chartData}
            layout="vertical"
            margin={{
              left: 0,
            }}
          >
            <CartesianGrid vertical={false} />
            <YAxis
              dataKey="status"
              type="category"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              tickFormatter={(value) => value.slice(0, 12)}
            />
            <XAxis dataKey="count" type="number" hide />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Bar dataKey="count" layout="vertical" radius={5} />
          </BarChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex-col items-start gap-2 text-sm">
        <div className="leading-none text-muted-foreground">
          Mostrando el estado actual de todas las instancias de flujos asignadas.
        </div>
      </CardFooter>
    </Card>
  )
}
