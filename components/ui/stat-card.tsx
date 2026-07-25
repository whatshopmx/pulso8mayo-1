import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
    title: string;
    value: number | string;
    icon?: LucideIcon;
    description?: React.ReactNode;
    trend?: {
        value: number;
        isPositive: boolean;
    };
    variant?: 'default' | 'success' | 'warning' | 'danger';
    className?: string;
}

export function StatCard({
    title,
    value,
    icon: Icon,
    description,
    trend,
    variant = 'default',
    className,
}: StatCardProps) {
    const variantStyles = {
        default: 'border-border',
        success: 'border-green-500 bg-green-50 dark:bg-green-950',
        warning: 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950',
        danger: 'border-red-500 bg-red-50 dark:bg-red-950',
    };

    const iconStyles = {
        default: 'text-muted-foreground',
        success: 'text-green-600 dark:text-green-400',
        warning: 'text-yellow-600 dark:text-yellow-400',
        danger: 'text-red-600 dark:text-red-400',
    };

    return (
        <Card className={cn(variantStyles[variant], className)}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                {Icon && <Icon className={cn('h-4 w-4', iconStyles[variant])} />}
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{value}</div>
                {description && (
                    <p className="text-xs text-muted-foreground mt-1">{description}</p>
                )}
                {trend && (
                    <div className="flex items-center text-xs mt-2">
                        <span
                            className={cn(
                                'font-medium',
                                trend.isPositive ? 'text-green-600' : 'text-red-600'
                            )}
                        >
                            {trend.isPositive ? '+' : ''}
                            {trend.value}%
                        </span>
                        <span className="text-muted-foreground ml-1">from last period</span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
