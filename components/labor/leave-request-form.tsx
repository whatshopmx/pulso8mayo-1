'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { differenceInCalendarDays, format, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const leaveRequestSchema = z
  .object({
    leaveTypeId: z.string().uuid({ message: 'Selecciona un tipo de permiso' }),
    startDate: z.date({ message: 'Selecciona una fecha de inicio' }),
    endDate: z.date({ message: 'Selecciona una fecha de fin' }),
    totalDays: z.number().min(1, { message: 'Se requiere al menos 1 día' }),
    reason: z
      .string()
      .min(10, { message: 'El motivo debe tener al menos 10 caracteres' }),
  })
  .refine((data) => startOfDay(data.endDate) >= startOfDay(data.startDate), {
    message: 'La fecha de fin debe ser igual o posterior a la de inicio',
    path: ['endDate'],
  });

type LeaveRequestFormValues = z.infer<typeof leaveRequestSchema>;

interface LeaveRequestFormProps {
  companyId: string;
  userId: string;
  balances: any[];
  onSuccess?: () => void;
}

export function LeaveRequestForm({
  companyId,
  userId,
  balances,
  onSuccess,
}: LeaveRequestFormProps) {
  const [loading, setLoading] = useState(false);
  const t = useTranslations('labor.leaveRequest');

  const form = useForm<LeaveRequestFormValues>({
    resolver: zodResolver(leaveRequestSchema),
    defaultValues: {
      totalDays: 1,
      reason: '',
    },
  });

  const startDate = form.watch('startDate');
  const endDate = form.watch('endDate');
  const totalDays = form.watch('totalDays');

  useEffect(() => {
    if (!startDate || !endDate) return;
    const start = startOfDay(startDate);
    const end = startOfDay(endDate);
    const days = end >= start ? differenceInCalendarDays(end, start) + 1 : 0;
    if (days > 0 && form.getValues('totalDays') !== days) {
      form.setValue('totalDays', days, { shouldValidate: true });
    }
  }, [startDate, endDate, form]);

  const onSubmit = async (data: LeaveRequestFormValues) => {
    try {
      setLoading(true);

      const response = await fetch('/api/leave/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          companyId,
          userId,
          startDate: data.startDate.toISOString(),
          endDate: data.endDate.toISOString(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        toast.error(error.error || 'No se pudo enviar la solicitud');
        return;
      }

      toast.success('Solicitud de permiso enviada');
      form.reset({ totalDays: 1, reason: '' });
      onSuccess?.();
    } catch (error) {
      console.error('Error creating leave request:', error);
      toast.error('Error al enviar la solicitud de permiso');
    } finally {
      setLoading(false);
    }
  };

  const today = startOfDay(new Date());

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="leaveTypeId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('leaveType.label')}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value || ''}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t('leaveType.placeholder')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {balances.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      No tienes saldos asignados aún
                    </div>
                  ) : (
                    balances.map((balance) => (
                      <SelectItem
                        key={balance.leaveTypeId}
                        value={balance.leaveTypeId}
                      >
                        {balance.leaveTypeName} ({balance.balance} días disponibles)
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <FormDescription>{t('leaveType.description')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="startDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>{t('startDate.label')}</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          'min-h-11 sm:min-h-9 pl-3 text-left font-normal',
                          !field.value && 'text-muted-foreground'
                        )}
                      >
                        {field.value ? (
                          format(field.value, 'PPP', { locale: es })
                        ) : (
                          <span>{t('startDate.placeholder')}</span>
                        )}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      disabled={(date) => startOfDay(date) < today}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="endDate"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>{t('endDate.label')}</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          'min-h-11 sm:min-h-9 pl-3 text-left font-normal',
                          !field.value && 'text-muted-foreground'
                        )}
                      >
                        {field.value ? (
                          format(field.value, 'PPP', { locale: es })
                        ) : (
                          <span>{t('endDate.placeholder')}</span>
                        )}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={field.onChange}
                      disabled={(date) =>
                        startOfDay(date) < (startDate ? startOfDay(startDate) : today)
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {startDate && endDate && totalDays > 0 && (
          <div className="p-4 bg-muted rounded-lg">
            <p className="text-sm font-medium tabular-nums">
              {t('totalDays')}: {totalDays} {totalDays === 1 ? 'día' : 'días'}
            </p>
          </div>
        )}

        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('reason.label')}</FormLabel>
              <FormControl>
                <Textarea
                  placeholder={t('reason.placeholder')}
                  className="resize-none"
                  {...field}
                />
              </FormControl>
              <FormDescription>{t('reason.description')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          disabled={loading || balances.length === 0}
          className="min-h-11 sm:min-h-9"
        >
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {loading ? t('submitting') : t('submitButton')}
        </Button>
      </form>
    </Form>
  );
}
