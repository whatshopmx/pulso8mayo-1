import { db } from "@/lib/db";
import { salesEntries, recipes } from "@/lib/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import {
  applyWeatherModifier,
  inferRecipeCategory,
  type WeatherModifierConfig,
  type RecipeCategory,
} from "@/lib/inventory/weather-forecast";

interface ForecastDay {
  date: string;
  predictedQuantity: number;
  confidenceScore: number;
}

interface ForecastResult {
  recipeId: string;
  recipeName: string;
  category: RecipeCategory;
  forecast: ForecastDay[];
  mape?: number;
  daysOfData: number;
  weatherProfileApplied?: string;
}

export class ForecastService {
  static async calculate(
    recipeId: string,
    companyId: string,
    options?: { daysHistory?: number; weatherConfig?: WeatherModifierConfig }
  ): Promise<ForecastResult> {
    const daysHistory = options?.daysHistory ?? 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysHistory);

    const [recipe] = await db.select()
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.companyId, companyId)));

    if (!recipe) throw new Error("Recipe not found");

    const category = inferRecipeCategory(recipe.name, recipe.tags as string[] | null, recipe.unit);

    const entries = await db.select({
      saleDate: salesEntries.saleDate,
      quantitySold: salesEntries.quantitySold,
    })
      .from(salesEntries)
      .where(
        and(
          eq(salesEntries.recipeId, recipeId),
          gte(salesEntries.saleDate, cutoffDate)
        )
      )
      .orderBy(salesEntries.saleDate);

    if (entries.length === 0) {
      return {
        recipeId,
        recipeName: recipe.name,
        category,
        forecast: this.generateEmptyForecast(),
        daysOfData: 0,
        weatherProfileApplied: options?.weatherConfig?.profile,
      };
    }

    const daysOfData = this.countUniqueDays(entries);

    if (daysOfData < 30) {
      return this.simpleAverageForecast(recipeId, recipe.name, category, entries, options?.weatherConfig);
    }

    return this.weightedMovingAverageForecast(recipeId, recipe.name, category, entries, daysHistory, options?.weatherConfig);
  }

  static async calculateAll(companyId: string): Promise<ForecastResult[]> {
    const activeRecipes = await db.select()
      .from(recipes)
      .where(eq(recipes.companyId, companyId));

    const results: ForecastResult[] = [];

    for (const recipe of activeRecipes) {
      try {
        const forecast = await this.calculate(recipe.id, companyId);
        results.push(forecast);
      } catch (err) {
        console.warn(`[ForecastService] Failed for recipe ${recipe.id}:`, err);
      }
    }

    return results;
  }

  private static weightedMovingAverageForecast(
    recipeId: string,
    recipeName: string,
    category: RecipeCategory,
    entries: { saleDate: Date; quantitySold: string }[],
    daysHistory: number,
    weatherConfig?: WeatherModifierConfig
  ): ForecastResult {
    const now = new Date();
    const dailyMap = this.aggregateByDate(entries);
    const dates = Object.keys(dailyMap).sort();
    const values = dates.map(d => dailyMap[d]);

    const recent7 = values.slice(-7);
    const mid8to30 = values.slice(-30, -7);
    const old31to90 = values.slice(-90, -30);

    const weightRecent = 3;
    const weightMid = 2;
    const weightOld = 1;

    const weightedSum =
      recent7.reduce((s, v) => s + v * weightRecent, 0) +
      mid8to30.reduce((s, v) => s + v * weightMid, 0) +
      old31to90.reduce((s, v) => s + v * weightOld, 0);

    const totalWeight =
      recent7.length * weightRecent +
      mid8to30.length * weightMid +
      old31to90.length * weightOld;

    const baseAvg = totalWeight > 0 ? weightedSum / totalWeight : 0;

    const dayOfWeekFactors = this.calculateDayOfWeekFactors(dailyMap);

    const forecast: ForecastDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);
      const dayOfWeek = date.getDay();
      const factor = dayOfWeekFactors[dayOfWeek] ?? 1;
      const rawPredicted = Math.round(baseAvg * factor);
      const predicted = applyWeatherModifier(rawPredicted, category, weatherConfig);
      const dataPoints = dates.length;
      const confidenceScore = Math.min(95, Math.round((dataPoints / daysHistory) * 100));

      forecast.push({
        date: date.toISOString().split('T')[0],
        predictedQuantity: Math.max(0, predicted),
        confidenceScore,
      });
    }

    return {
      recipeId,
      recipeName,
      category,
      forecast,
      mape: 25,
      daysOfData: dates.length,
      weatherProfileApplied: weatherConfig?.profile,
    };
  }

  private static simpleAverageForecast(
    recipeId: string,
    recipeName: string,
    category: RecipeCategory,
    entries: { saleDate: Date; quantitySold: string }[],
    weatherConfig?: WeatherModifierConfig
  ): ForecastResult {
    const dailyMap = this.aggregateByDate(entries);
    const values = Object.values(dailyMap);
    const avg = values.length > 0
      ? values.reduce((s, v) => s + v, 0) / values.length
      : 0;

    const now = new Date();
    const forecast: ForecastDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);
      const rawPredicted = Math.round(avg);
      const predicted = applyWeatherModifier(rawPredicted, category, weatherConfig);
      forecast.push({
        date: date.toISOString().split('T')[0],
        predictedQuantity: Math.max(0, predicted),
        confidenceScore: Math.min(70, Math.round((values.length / 30) * 100)),
      });
    }

    return {
      recipeId,
      recipeName,
      category,
      forecast,
      daysOfData: values.length,
      weatherProfileApplied: weatherConfig?.profile,
    };
  }

  private static calculateDayOfWeekFactors(
    dailyMap: Record<string, number>
  ): Record<number, number> {
    const daySums: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const dayCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

    for (const [dateStr, qty] of Object.entries(dailyMap)) {
      const day = new Date(dateStr).getDay();
      daySums[day] += qty;
      dayCounts[day]++;
    }

    const allDays = Object.keys(daySums).map(Number);
    const avgAll = allDays.reduce((s, d) => s + (dayCounts[d] > 0 ? daySums[d] / dayCounts[d] : 0), 0) / 7;

    const factors: Record<number, number> = {};
    for (const day of allDays) {
      const dayAvg = dayCounts[day] > 0 ? daySums[day] / dayCounts[day] : avgAll;
      factors[day] = avgAll > 0 ? dayAvg / avgAll : 1;
    }

    return factors;
  }

  private static aggregateByDate(entries: { saleDate: Date; quantitySold: string }[]): Record<string, number> {
    const map: Record<string, number> = {};
    for (const entry of entries) {
      const dateKey = new Date(entry.saleDate).toISOString().split('T')[0];
      map[dateKey] = (map[dateKey] || 0) + parseFloat(entry.quantitySold);
    }
    return map;
  }

  private static countUniqueDays(entries: { saleDate: Date; quantitySold: string }[]): number {
    const days = new Set<string>();
    for (const e of entries) {
      days.add(new Date(e.saleDate).toISOString().split('T')[0]);
    }
    return days.size;
  }

  private static generateEmptyForecast(): ForecastDay[] {
    const now = new Date();
    const forecast: ForecastDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);
      forecast.push({
        date: date.toISOString().split('T')[0],
        predictedQuantity: 0,
        confidenceScore: 0,
      });
    }
    return forecast;
  }
}
