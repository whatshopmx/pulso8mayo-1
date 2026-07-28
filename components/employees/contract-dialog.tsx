"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const contractSchema = z.object({
  contractNumber: z.string().min(1, "Contract number is required"),
  contractType: z.enum(['DETERMINATE', 'INDETERMINATE', 'PROBATION', 'TRAINING', 'SEASONAL', 'PART_TIME']),
  workRegime: z.enum(['DAILY', 'MIXED', 'NIGHT', 'SPLIT_SHIFT', 'ON_CALL']),
  startDate: z.date({ message: "Start date is required" }),
  endDate: z.date().optional(),
  probationPeriodDays: z.number().min(0).optional(),
  signatureDate: z.date().optional(),
  baseSalary: z.number().min(0, "Base salary must be positive"),
  monthlySalary: z.number().min(0).optional(),
  weeklySalary: z.number().min(0).optional(),
  currency: z.string(),
  hasHealthInsurance: z.boolean(),
  hasLifeInsurance: z.boolean(),
  hasSavingsFund: z.boolean(),
  hasFoodVouchers: z.boolean(),
  hasTransportationBonus: z.boolean(),
  benefitsNotes: z.string().optional(),
  workStartTime: z.string().optional(),
  workEndTime: z.string().optional(),
  breakDurationMinutes: z.number().min(0).optional(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'TERMINATED', 'RENEWED']),
  autoRenew: z.boolean(),
  terms: z.string().optional(),
  notes: z.string().optional(),
});

type ContractFormData = z.infer<typeof contractSchema>;

interface ContractDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  contract?: any;
  employeeId: string;
  companyId: string;
  branchId?: string;
}

export function ContractDialog({
  open,
  onOpenChange,
  onSuccess,
  contract,
  employeeId,
  companyId,
  branchId,
}: ContractDialogProps) {
  const [loading, setLoading] = useState(false);
  const isEditing = !!contract;

  const t = useTranslations("labor.employees.contract");
  const tCommon = useTranslations("common");

  const form = useForm<ContractFormData>({
    resolver: zodResolver(contractSchema),
    defaultValues: {
      contractNumber: '',
      contractType: 'INDETERMINATE',
      workRegime: 'DAILY',
      baseSalary: 0,
      currency: 'MXN',
      hasHealthInsurance: false,
      hasLifeInsurance: false,
      hasSavingsFund: false,
      hasFoodVouchers: false,
      hasTransportationBonus: false,
      status: 'ACTIVE',
      autoRenew: false,
      benefitsNotes: '',
      workStartTime: '',
      workEndTime: '',
      terms: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (contract && open) {
      form.reset({
        contractNumber: contract.contractNumber || '',
        contractType: contract.contractType || 'INDETERMINATE',
        workRegime: contract.workRegime || 'DAILY',
        startDate: contract.startDate ? new Date(contract.startDate) : undefined,
        endDate: contract.endDate ? new Date(contract.endDate) : undefined,
        probationPeriodDays: contract.probationPeriodDays || undefined,
        signatureDate: contract.signatureDate ? new Date(contract.signatureDate) : undefined,
        baseSalary: contract.baseSalary / 100 || 0, // Convert from cents
        monthlySalary: contract.monthlySalary ? contract.monthlySalary / 100 : undefined,
        weeklySalary: contract.weeklySalary ? contract.weeklySalary / 100 : undefined,
        currency: contract.currency || 'MXN',
        hasHealthInsurance: contract.hasHealthInsurance || false,
        hasLifeInsurance: contract.hasLifeInsurance || false,
        hasSavingsFund: contract.hasSavingsFund || false,
        hasFoodVouchers: contract.hasFoodVouchers || false,
        hasTransportationBonus: contract.hasTransportationBonus || false,
        benefitsNotes: contract.benefitsNotes || '',
        workStartTime: contract.workStartTime || '',
        workEndTime: contract.workEndTime || '',
        breakDurationMinutes: contract.breakDurationMinutes || undefined,
        status: contract.status || 'ACTIVE',
        autoRenew: contract.autoRenew || false,
        terms: contract.terms || '',
        notes: contract.notes || '',
      });
    } else if (!contract && open) {
      form.reset({
        contractNumber: '',
        contractType: 'INDETERMINATE',
        workRegime: 'DAILY',
        baseSalary: 0,
        currency: 'MXN',
        hasHealthInsurance: false,
        hasLifeInsurance: false,
        hasSavingsFund: false,
        hasFoodVouchers: false,
        hasTransportationBonus: false,
        status: 'ACTIVE',
        autoRenew: false,
        benefitsNotes: '',
        workStartTime: '',
        workEndTime: '',
        terms: '',
        notes: '',
      });
    }
  }, [contract, open, form]);

  const onSubmit = async (data: ContractFormData) => {
    setLoading(true);
    try {
      const payload = {
        ...data,
        userId: employeeId,
        companyId,
        branchId,
        baseSalary: Math.round(data.baseSalary * 100), // Convert to cents
        monthlySalary: data.monthlySalary ? Math.round(data.monthlySalary * 100) : undefined,
        weeklySalary: data.weeklySalary ? Math.round(data.weeklySalary * 100) : undefined,
        startDate: data.startDate.toISOString().split('T')[0],
        endDate: data.endDate?.toISOString().split('T')[0],
        signatureDate: data.signatureDate?.toISOString().split('T')[0],
      };

      const url = isEditing
        ? `/api/employees/contracts/${contract.id}`
        : '/api/employees/contracts';

      const method = isEditing ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        toast.success(isEditing ? t('updateSuccess') : t('createSuccess'));
        onSuccess();
        onOpenChange(false);
      } else {
        const errorData = await response.json();
        toast.error(errorData.error || t('saveError'));
      }
    } catch (error) {
      console.error('Error saving contract:', error);
      toast.error(t('saveError'));
    } finally {
      setLoading(false);
    }
  };

  const watchedBaseSalary = form.watch('baseSalary');
  const suggestedMonthly = watchedBaseSalary * 30;
  const suggestedWeekly = watchedBaseSalary * 7;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          {isEditing ? t('editTitle') : t('createTitle')}
        </DialogTitle>
        <DialogDescription>
          {isEditing ? t('editDescription') : t('createDescription')}
        </DialogDescription>
      </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Contract Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t('contractInfo')}</h3>

            <FormField
              control={form.control}
              name="contractNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('contractNumber.label')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('contractNumber.placeholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="contractType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('contractType.label')}</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('contractType.placeholder')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="DETERMINATE">{t('contractType.determinate')}</SelectItem>
                      <SelectItem value="INDETERMINATE">{t('contractType.indeterminate')}</SelectItem>
                      <SelectItem value="PROBATION">{t('contractType.probation')}</SelectItem>
                      <SelectItem value="TRAINING">{t('contractType.training')}</SelectItem>
                      <SelectItem value="SEASONAL">{t('contractType.seasonal')}</SelectItem>
                      <SelectItem value="PART_TIME">{t('contractType.partTime')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="workRegime"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('workRegime.label')}</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('workRegime.placeholder')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="DAILY">{t('workRegime.daily')}</SelectItem>
                      <SelectItem value="MIXED">{t('workRegime.mixed')}</SelectItem>
                      <SelectItem value="NIGHT">{t('workRegime.night')}</SelectItem>
                      <SelectItem value="SPLIT_SHIFT">{t('workRegime.splitShift')}</SelectItem>
                      <SelectItem value="ON_CALL">{t('workRegime.onCall')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('status.label')}</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('status.placeholder')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="ACTIVE">{t('status.active')}</SelectItem>
                      <SelectItem value="EXPIRED">{t('status.expired')}</SelectItem>
                      <SelectItem value="TERMINATED">{t('status.terminated')}</SelectItem>
                      <SelectItem value="RENEWED">{t('status.renewed')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>{t('dates.startDate')}</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>{t('dates.pickDate')}</span>
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
                            date > new Date() || date < new Date("1900-01-01")
                          }
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
                    <FormLabel>{t('dates.endDate')}</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>{t('dates.pickDate')}</span>
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
                            date < new Date("1900-01-01")
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
          </div>

      {/* Salary Information */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">{t('salary.title')}</h3>

    <FormField
    control={form.control}
    name="baseSalary"
    render={({ field }) => (
        <FormItem>
        <FormLabel>{t('salary.dailyBase')}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          {...field}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
      <FormField
    control={form.control}
    name="weeklySalary"
    render={({ field }) => (
        <FormItem>
        <FormLabel>{t('salary.weekly')}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder={suggestedWeekly.toFixed(2)}
                            {...field}
                            onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

      <FormField
    control={form.control}
    name="monthlySalary"
    render={({ field }) => (
        <FormItem>
        <FormLabel>{t('salary.monthly')}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder={suggestedMonthly.toFixed(2)}
                            {...field}
                            onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

    <div className="text-sm text-muted-foreground">
      {t('salary.suggested', { weekly: suggestedWeekly.toFixed(2), monthly: suggestedMonthly.toFixed(2) })}
    </div>
              </div>
            </div>

    {/* Benefits */}
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{t('benefits.title')}</h3>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="hasHealthInsurance"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
      <div className="space-y-1 leading-none">
        <FormLabel>{t('benefits.healthInsurance')}</FormLabel>
      </div>
    </FormItem>
    )}
    />

    <FormField
    control={form.control}
    name="hasLifeInsurance"
    render={({ field }) => (
    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
        <FormControl>
        <Checkbox
            checked={field.value}
            onCheckedChange={field.onChange}
        />
        </FormControl>
        <div className="space-y-1 leading-none">
        <FormLabel>{t('benefits.lifeInsurance')}</FormLabel>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="hasSavingsFund"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
      <div className="space-y-1 leading-none">
        <FormLabel>{t('benefits.savingsFund')}</FormLabel>
      </div>
    </FormItem>
    )}
    />

    <FormField
    control={form.control}
    name="hasFoodVouchers"
    render={({ field }) => (
    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
        <FormControl>
        <Checkbox
            checked={field.value}
            onCheckedChange={field.onChange}
        />
        </FormControl>
        <div className="space-y-1 leading-none">
        <FormLabel>{t('benefits.foodVouchers')}</FormLabel>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="hasTransportationBonus"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
      <div className="space-y-1 leading-none">
        <FormLabel>{t('benefits.transportationBonus')}</FormLabel>
      </div>
    </FormItem>
    )}
    />
    </div>

    <FormField
    control={form.control}
    name="benefitsNotes"
    render={({ field }) => (
    <FormItem>
        <FormLabel>{t('benefits.notes')}</FormLabel>
        <FormControl>
        <Textarea
            placeholder={t('benefits.notesPlaceholder')}
            className="resize-none"
            {...field}
        />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

    {/* Work Schedule */}
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{t('schedule.title')}</h3>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <FormField
    control={form.control}
    name="workStartTime"
    render={({ field }) => (
        <FormItem>
        <FormLabel>{t('schedule.startTime')}</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

      <FormField
    control={form.control}
    name="workEndTime"
    render={({ field }) => (
        <FormItem>
        <FormLabel>{t('schedule.endTime')}</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

      <FormField
    control={form.control}
    name="breakDurationMinutes"
    render={({ field }) => (
        <FormItem>
        <FormLabel>{t('schedule.breakDuration')}</FormLabel>
        <FormControl>
        <Input
            type="number"
            placeholder={t('schedule.breakPlaceholder')}
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

      <FormField
    control={form.control}
    name="probationPeriodDays"
    render={({ field }) => (
        <FormItem>
        <FormLabel>{t('schedule.probationDays')}</FormLabel>
        <FormControl>
        <Input
            type="number"
            placeholder={t('schedule.probationPlaceholder')}
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

    {/* Additional Information */}
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{t('additional.title')}</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <FormField
    control={form.control}
    name="terms"
    render={({ field }) => (
        <FormItem>
        <FormLabel>{t('additional.terms')}</FormLabel>
        <FormControl>
        <Textarea
            placeholder={t('additional.termsPlaceholder')}
            className="resize-none"
            {...field}
        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

      <FormField
    control={form.control}
    name="notes"
    render={({ field }) => (
        <FormItem>
        <FormLabel>{t('additional.notes')}</FormLabel>
        <FormControl>
        <Textarea
            placeholder={t('additional.notesPlaceholder')}
            className="resize-none"
            {...field}
        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

      <FormField
    control={form.control}
    name="autoRenew"
    render={({ field }) => (
        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
        <FormControl>
        <Checkbox
            checked={field.value}
            onCheckedChange={field.onChange}
        />
        </FormControl>
        <div className="space-y-1 leading-none">
        <FormLabel>{t('additional.autoRenew')}</FormLabel>
        </div>
        </FormItem>
    )}
    />
    </div>

    <DialogFooter>
      <Button
      type="button"
      variant="outline"
      onClick={() => onOpenChange(false)}
      disabled={loading}
      >
      {tCommon('cancel')}
      </Button>
      <Button type="submit" disabled={loading}>
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {isEditing ? t('updateButton') : t('createButton')}
      </Button>
    </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}