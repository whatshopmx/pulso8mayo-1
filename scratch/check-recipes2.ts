import { db } from "../lib/db";
import { recipes, inventoryItems } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs";

async function run() {
  const rs = await db.select().from(recipes).limit(10);
  const is = await db.select().from(inventoryItems).limit(10);
  
  const overlap = await db.select().from(recipes).innerJoin(inventoryItems, eq(recipes.id, inventoryItems.id));

  const text = `Recipes: ${JSON.stringify(rs.map(r => r.id))}
Items: ${JSON.stringify(is.map(i => i.id))}
Overlap: ${JSON.stringify(overlap.map(o => o.recipes.id))}
`;
  
  fs.writeFileSync("check-out.txt", text);
  process.exit(0);
}
run();
