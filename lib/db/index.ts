import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

// Driver WebSocket (`neon-serverless`) y no HTTP (`neon-http`): este último NO
// soporta `db.transaction` — lanza "No transactions support in neon-http
// driver" en tiempo de ejecución, no en compilación. El repo tiene 14 usos de
// transacciones (movimientos de inventario, órdenes de compra, recetas,
// empleados), todos rotos mientras el cliente fue HTTP.
//
// En Node hay que dar el constructor de WebSocket a mano; en runtimes que ya lo
// traen (edge/browser) no hace falta, pero aquí todas las rutas son Node.
neonConfig.webSocketConstructor = ws;

// `allowExitOnIdle` deja que el proceso termine cuando no hay conexiones en
// uso. Sin esto los scripts de `tsx` (seeds, backfills) se quedarían colgados
// al acabar, porque el pool mantiene sockets abiertos.
//
// `idleTimeoutMillis` tiene que quedar por debajo del corte de inactividad del
// pooler de Neon: si el servidor cierra el socket primero, la siguiente query
// que reutiliza ese cliente falla con "Connection terminated unexpectedly"
// (visto en `/api/finance/cash-flow`, 2026-11-17). Cerrar nosotros primero
// mantiene el pool con sockets vivos.
function createPool() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL!,
        allowExitOnIdle: true,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
    });
    // Sin listener, un error en un cliente ocioso se emite como evento
    // 'error' no manejado y tumba el proceso de Node entero.
    pool.on("error", (error) => {
        console.error("[db] pooled connection error:", error);
    });
    return pool;
}

// Un solo pool por proceso. En `next dev` el hot-reload reevalúa este módulo en
// cada cambio: sin el global se acumularían pools (y conexiones) hasta agotar
// el límite de Neon.
const globalForDb = globalThis as unknown as { __pulsoPool?: Pool };
const pool = globalForDb.__pulsoPool ?? createPool();
if (process.env.NODE_ENV !== "production") {
    globalForDb.__pulsoPool = pool;
}

export const db = drizzle(pool, { schema });
