// lib/inventory/weather-forecast.ts
//
// Modificadores de Forecast por Clima Extremo Monterrey y Eventos Locales (Módulo 3.1 & 3.2).
// Perfiles adaptados al Área Metropolitana de Monterrey (Canícula >40°C, Frentes Fríos, Clásico Regio).

export type WeatherProfile = "NORMAL" | "HEATWAVE_MTY" | "RAINY_COLD" | "SPORT_EVENT_MTY";

export type RecipeCategory = "COLD_BEVERAGE" | "HOT_BEVERAGE" | "HOT_FOOD" | "COLD_FOOD" | "SNACKS" | "GENERAL";

export interface WeatherModifierConfig {
  profile: WeatherProfile;
  customMultiplier?: number;
  eventName?: string;
}

export const WEATHER_CATEGORY_MULTIPLIERS: Record<WeatherProfile, Record<RecipeCategory, number>> = {
  NORMAL: {
    COLD_BEVERAGE: 1.0,
    HOT_BEVERAGE: 1.0,
    HOT_FOOD: 1.0,
    COLD_FOOD: 1.0,
    SNACKS: 1.0,
    GENERAL: 1.0,
  },
  HEATWAVE_MTY: {
    COLD_BEVERAGE: 1.30, // +30% Bebidas frías, hielo, frappes
    HOT_BEVERAGE: 0.75,  // -25% Café caliente
    HOT_FOOD: 0.80,      // -20% Caldos y sopas
    COLD_FOOD: 1.20,     // +20% Ensaladas, sushi, ceviches
    SNACKS: 1.05,
    GENERAL: 1.0,
  },
  RAINY_COLD: {
    COLD_BEVERAGE: 0.75, // -25%
    HOT_BEVERAGE: 1.35,  // +35% Café, chocolate
    HOT_FOOD: 1.30,      // +30% Sopas, guisados calientes
    COLD_FOOD: 0.80,     // -20%
    SNACKS: 0.95,
    GENERAL: 0.95,
  },
  SPORT_EVENT_MTY: {
    COLD_BEVERAGE: 1.40, // +40% Cerveza, refresco
    HOT_BEVERAGE: 0.90,
    HOT_FOOD: 1.10,
    COLD_FOOD: 1.15,
    SNACKS: 1.35,        // +35% Alitas, boneless, nachos
    GENERAL: 1.15,
  },
};

/**
 * Infiere la categoría de la receta a partir de su nombre, tags o unidad.
 */
export function inferRecipeCategory(
  recipeName: string,
  tags?: string[] | null,
  unit?: string
): RecipeCategory {
  const normalized = (recipeName + " " + (tags?.join(" ") || ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (/cerveza|refresco|frappe|smoothie|limonada|agua fresca|helado|nieve|ice|cold brew|frio|fria/i.test(normalized)) {
    return "COLD_BEVERAGE";
  }
  if (/cafe|espresso|capuchino|chocolate caliente|te caliente|infusion/i.test(normalized)) {
    return "HOT_BEVERAGE";
  }
  if (/caldo|sopa|crema|consome|pozole|menudo|ramen|guisado caliente/i.test(normalized)) {
    return "HOT_FOOD";
  }
  if (/ensalada|ceviche|aguachile|sushi|carpaccio|tartar|poke/i.test(normalized)) {
    return "COLD_FOOD";
  }
  if (/alita|boneless|nacho|papas|finger|botana|snack|tira de pollo/i.test(normalized)) {
    return "SNACKS";
  }

  return "GENERAL";
}

/**
 * Aplica el multiplicador de clima y eventos sobre una cantidad base predicha.
 */
export function applyWeatherModifier(
  baseQuantity: number,
  category: RecipeCategory,
  config?: WeatherModifierConfig
): number {
  if (!config || config.profile === "NORMAL") {
    return Math.max(0, Math.round(baseQuantity));
  }

  const categoryFactor = WEATHER_CATEGORY_MULTIPLIERS[config.profile][category] ?? 1.0;
  const customFactor = config.customMultiplier ?? 1.0;
  const finalQuantity = baseQuantity * categoryFactor * customFactor;

  return Math.max(0, Math.round(finalQuantity));
}
