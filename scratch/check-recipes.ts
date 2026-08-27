import { db } from "../lib/db";
import { recipes, inventoryItems } from "../lib/db/schema";
import { eq } from "drizzle-orm";

async function run() {
  const rs = await db.select().from(recipes).limit(10);
  console.log("Recipes:", rs.map(r => ({ id: r.id, name: r.name })));
  
  const is = await db.select().from(inventoryItems).limit(10);
  console.log("InventoryItems:", is.map(i => ({ id: i.id, name: i.name })));
  
  process.exit(0);
}
run();
