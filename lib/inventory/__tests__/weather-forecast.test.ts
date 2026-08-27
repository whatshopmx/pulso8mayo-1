// lib/inventory/__tests__/weather-forecast.test.ts
import { describe, expect, it } from "vitest";
import {
  applyWeatherModifier,
  inferRecipeCategory,
  WEATHER_CATEGORY_MULTIPLIERS,
} from "../weather-forecast";

describe("inferRecipeCategory", () => {
  it("detects cold beverages", () => {
    expect(inferRecipeCategory("Limonada Mineral 500ml")).toBe("COLD_BEVERAGE");
    expect(inferRecipeCategory("Frappé de Moka")).toBe("COLD_BEVERAGE");
    expect(inferRecipeCategory("Cerveza Artesanal Carta Blanca")).toBe("COLD_BEVERAGE");
  });

  it("detects hot beverages", () => {
    expect(inferRecipeCategory("Café Americano")).toBe("HOT_BEVERAGE");
    expect(inferRecipeCategory("Capuchino Vainilla")).toBe("HOT_BEVERAGE");
    expect(inferRecipeCategory("Chocolate Caliente")).toBe("HOT_BEVERAGE");
  });

  it("detects hot food & soups", () => {
    expect(inferRecipeCategory("Caldo Tlalpeño")).toBe("HOT_FOOD");
    expect(inferRecipeCategory("Pozole Rojo Grande")).toBe("HOT_FOOD");
    expect(inferRecipeCategory("Sopa de Tortilla")).toBe("HOT_FOOD");
  });

  it("detects cold food", () => {
    expect(inferRecipeCategory("Ceviche de Robalo")).toBe("COLD_FOOD");
    expect(inferRecipeCategory("Ensalada César")).toBe("COLD_FOOD");
    expect(inferRecipeCategory("Aguachile Verde")).toBe("COLD_FOOD");
  });

  it("detects snacks & game day foods", () => {
    expect(inferRecipeCategory("Alitas BBQ 12 pzas")).toBe("SNACKS");
    expect(inferRecipeCategory("Boneless Búfalo")).toBe("SNACKS");
    expect(inferRecipeCategory("Nachos con Queso y Jalapeño")).toBe("SNACKS");
  });

  it("falls back to general for unclassified dishes", () => {
    expect(inferRecipeCategory("Hamburguesa Clásica")).toBe("GENERAL");
    expect(inferRecipeCategory("Tacos de Asada")).toBe("GENERAL");
  });
});

describe("applyWeatherModifier", () => {
  it("NORMAL profile leaves quantity unchanged", () => {
    expect(applyWeatherModifier(100, "COLD_BEVERAGE", { profile: "NORMAL" })).toBe(100);
    expect(applyWeatherModifier(50, "HOT_FOOD", { profile: "NORMAL" })).toBe(50);
  });

  it("HEATWAVE_MTY increases cold beverages and decreases soups", () => {
    // Cold beverage: 100 * 1.30 = 130 (+30%)
    expect(applyWeatherModifier(100, "COLD_BEVERAGE", { profile: "HEATWAVE_MTY" })).toBe(130);

    // Hot soup: 50 * 0.80 = 40 (-20%)
    expect(applyWeatherModifier(50, "HOT_FOOD", { profile: "HEATWAVE_MTY" })).toBe(40);

    // Hot coffee: 40 * 0.75 = 30 (-25%)
    expect(applyWeatherModifier(40, "HOT_BEVERAGE", { profile: "HEATWAVE_MTY" })).toBe(30);

    // Cold salad: 20 * 1.20 = 24 (+20%)
    expect(applyWeatherModifier(20, "COLD_FOOD", { profile: "HEATWAVE_MTY" })).toBe(24);
  });

  it("RAINY_COLD increases soups and hot drinks, decreases cold beverages", () => {
    // Hot coffee: 100 * 1.35 = 135 (+35%)
    expect(applyWeatherModifier(100, "HOT_BEVERAGE", { profile: "RAINY_COLD" })).toBe(135);

    // Hot soup: 50 * 1.30 = 65 (+30%)
    expect(applyWeatherModifier(50, "HOT_FOOD", { profile: "RAINY_COLD" })).toBe(65);

    // Cold beverage: 100 * 0.75 = 75 (-25%)
    expect(applyWeatherModifier(100, "COLD_BEVERAGE", { profile: "RAINY_COLD" })).toBe(75);
  });

  it("SPORT_EVENT_MTY boosts snacks and cold beverages", () => {
    // Cold beers / drinks: 100 * 1.40 = 140 (+40%)
    expect(applyWeatherModifier(100, "COLD_BEVERAGE", { profile: "SPORT_EVENT_MTY" })).toBe(140);

    // Wings / Snacks: 100 * 1.35 = 135 (+35%)
    expect(applyWeatherModifier(100, "SNACKS", { profile: "SPORT_EVENT_MTY" })).toBe(135);
  });
});
