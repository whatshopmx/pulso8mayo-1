// M13 / T30: Sales Analytics Service
// Computes aggregated financial metrics, sales channel breakdown, shift trends,
// and ticket metrics from daily_sales_cuts.

import { db } from "@/lib/db";
import { dailySalesCuts, branches } from "@/lib/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

export interface SalesAnalyticsFilter {
  companyId: string;
  branchId?: string;
  startDate?: string;
  endDate?: string;
}

export interface SalesSummary {
  totalSalesCents: number;
  cashSalesCents: number;
  cardSalesCents: number;
  otherSalesCents: number;
  totalTickets: number;
  avgTicketCents: number;
  cutsCount: number;
}

export interface ChannelBreakdown {
  channel: string;
  totalSalesCents: number;
  percentage: number;
}

export interface DailySalesPoint {
  date: string;
  totalSalesCents: number;
  ticketCount: number;
}

export async function getSalesSummary(filter: SalesAnalyticsFilter): Promise<SalesSummary> {
  const conditions = [eq(dailySalesCuts.companyId, filter.companyId)];

  if (filter.branchId) {
    conditions.push(eq(dailySalesCuts.branchId, filter.branchId));
  }
  if (filter.startDate) {
    conditions.push(gte(dailySalesCuts.businessDate, filter.startDate));
  }
  if (filter.endDate) {
    conditions.push(lte(dailySalesCuts.businessDate, filter.endDate));
  }

  const [row] = await db
    .select({
      totalSales: sql<number>`COALESCE(SUM(${dailySalesCuts.totalSales}), 0)`,
      cashSales: sql<number>`COALESCE(SUM(${dailySalesCuts.cashSales}), 0)`,
      cardSales: sql<number>`COALESCE(SUM(${dailySalesCuts.cardSales}), 0)`,
      otherSales: sql<number>`COALESCE(SUM(${dailySalesCuts.otherPayments}), 0)`,
      totalTickets: sql<number>`COALESCE(SUM(${dailySalesCuts.ticketCount}), 0)`,
      cutsCount: sql<number>`COUNT(${dailySalesCuts.id})`,
    })
    .from(dailySalesCuts)
    .where(and(...conditions));

  const totalSalesCents = Number(row?.totalSales || 0);
  const totalTickets = Number(row?.totalTickets || 0);

  return {
    totalSalesCents,
    cashSalesCents: Number(row?.cashSales || 0),
    cardSalesCents: Number(row?.cardSales || 0),
    otherSalesCents: Number(row?.otherSales || 0),
    totalTickets,
    avgTicketCents: totalTickets > 0 ? Math.round(totalSalesCents / totalTickets) : 0,
    cutsCount: Number(row?.cutsCount || 0),
  };
}

export async function getChannelBreakdown(filter: SalesAnalyticsFilter): Promise<ChannelBreakdown[]> {
  const conditions = [eq(dailySalesCuts.companyId, filter.companyId)];

  if (filter.branchId) {
    conditions.push(eq(dailySalesCuts.branchId, filter.branchId));
  }
  if (filter.startDate) {
    conditions.push(gte(dailySalesCuts.businessDate, filter.startDate));
  }
  if (filter.endDate) {
    conditions.push(lte(dailySalesCuts.businessDate, filter.endDate));
  }

  const rows = await db
    .select({
      channel: dailySalesCuts.channel,
      totalSales: sql<number>`COALESCE(SUM(${dailySalesCuts.totalSales}), 0)`,
    })
    .from(dailySalesCuts)
    .where(and(...conditions))
    .groupBy(dailySalesCuts.channel);

  const grandTotal = rows.reduce((acc, r) => acc + Number(r.totalSales || 0), 0);

  return rows.map((r) => {
    const amount = Number(r.totalSales || 0);
    return {
      channel: r.channel,
      totalSalesCents: amount,
      percentage: grandTotal > 0 ? Number(((amount / grandTotal) * 100).toFixed(1)) : 0,
    };
  });
}

export async function getDailySalesTrend(filter: SalesAnalyticsFilter): Promise<DailySalesPoint[]> {
  const conditions = [eq(dailySalesCuts.companyId, filter.companyId)];

  if (filter.branchId) {
    conditions.push(eq(dailySalesCuts.branchId, filter.branchId));
  }
  if (filter.startDate) {
    conditions.push(gte(dailySalesCuts.businessDate, filter.startDate));
  }
  if (filter.endDate) {
    conditions.push(lte(dailySalesCuts.businessDate, filter.endDate));
  }

  const rows = await db
    .select({
      date: dailySalesCuts.businessDate,
      totalSales: sql<number>`COALESCE(SUM(${dailySalesCuts.totalSales}), 0)`,
      ticketCount: sql<number>`COALESCE(SUM(${dailySalesCuts.ticketCount}), 0)`,
    })
    .from(dailySalesCuts)
    .where(and(...conditions))
    .groupBy(dailySalesCuts.businessDate)
    .orderBy(dailySalesCuts.businessDate);

  return rows.map((r) => ({
    date: r.date,
    totalSalesCents: Number(r.totalSales || 0),
    ticketCount: Number(r.ticketCount || 0),
  }));
}
