import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fuerza la ruta en-memoria: sin credenciales Upstash el módulo cae al
// fallback determinista (hoy .env no trae UPSTASH_*, pero el mock blinda el
// test contra futuros cambios de .env).
vi.mock('@/lib/env', () => ({ env: {} }));

import {
    checkRateLimit,
    checkRateLimitSync,
    createRateLimitHeaders,
    getRateLimitStatusSync,
    resetRateLimit,
    resetRateLimitSync,
} from '../rate-limiter';

/**
 * Suite de Task 8 (plan.md): rate-limiter de `lib/rate-limiter.ts` sobre el
 * store EN-MEMORIA (la variante Redis toca red — fuera de la capa unitaria).
 *
 * Contratos:
 * - Config por endpoint: AUTH 10/15min, CRITICAL (inventory receiving/
 *   transfers/low-stock) 30/60s, resto DEFAULT 100/60s.
 * - Ventana deslizante por buckets de minuto: expirada la ventana el contador
 *   reinicia; `reset` es el fin de la ventana actual en ms epoch.
 * - `createRateLimitHeaders` emite X-RateLimit-Limit/Remaining/Reset (reset
 *   en SEGUNDOS) y Retry-After sólo cuando bloquea.
 * - Los identificadores son independientes entre sí.
 */

// Instante alineado a minuto y a ambas ventanas (60 s y 15 min):
const BASE = Date.UTC(2026, 0, 1, 12, 0, 0);

let seq = 0;
const freshId = (): string => `ident-${++seq}`;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
});

afterEach(() => {
    for (let i = 1; i <= seq; i++) resetRateLimitSync(`ident-${i}`);
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('config por endpoint', () => {
    it('auth → 10 / critical inventory → 30 / resto → 100', () => {
        expect(checkRateLimitSync(freshId(), '/api/auth/sign-in').limit).toBe(10);
        expect(checkRateLimitSync(freshId(), '/dashboard/sign-up').limit).toBe(10);
        expect(checkRateLimitSync(freshId(), '/api/inventory/receiving').limit).toBe(30);
        expect(checkRateLimitSync(freshId(), '/api/inventory/transfers').limit).toBe(30);
        expect(checkRateLimitSync(freshId(), '/api/inventory/low-stock').limit).toBe(30);
        expect(checkRateLimitSync(freshId(), '/api/pos/upload').limit).toBe(100);
    });
});

describe('checkRateLimitSync — consumo y bloqueo', () => {
    it('las primeras N pasan con remaining decreciente; la N+1 se bloquea con retryAfter', () => {
        const id = freshId();
        const max = getRateLimitStatusSync(id, '/api/auth/sign-in').limit; // 10, sin consumir

        let ultimo: ReturnType<typeof checkRateLimitSync> = {
            allowed: false,
            remaining: -1,
            limit: 0,
            reset: 0,
        };
        for (let i = 0; i < max; i++) {
            ultimo = checkRateLimitSync(id, '/api/auth/sign-in');
            expect(ultimo.allowed, `petición ${i + 1}`).toBe(true);
            expect(ultimo.remaining).toBe(max - i - 1);
        }

        const bloqueado = checkRateLimitSync(id, '/api/auth/sign-in');
        expect(bloqueado.allowed).toBe(false);
        expect(bloqueado.remaining).toBe(0);
        expect(bloqueado.retryAfter).toBeGreaterThanOrEqual(1);
        expect(ultimo.reset).toBeGreaterThan(Date.now());
        expect(ultimo.reset - Date.now()).toBeLessThanOrEqual(15 * 60_000);
    });

    it('status sync refleja used/remaining sin consumir', () => {
        const id = freshId();
        checkRateLimitSync(id, '/api/pos/upload');
        checkRateLimitSync(id, '/api/pos/upload');
        expect(getRateLimitStatusSync(id, '/api/pos/upload')).toEqual({
            remaining: 98,
            limit: 100,
            reset: BASE + 60_000,
            used: 2,
        });
    });

    it('identificadores independientes: agotar a uno no afecta al otro', () => {
        const a = freshId();
        const b = freshId();
        for (let i = 0; i < 10; i++) checkRateLimitSync(a, '/api/auth/sign-in');
        expect(checkRateLimitSync(a, '/api/auth/sign-in').allowed).toBe(false);
        expect(checkRateLimitSync(b, '/api/auth/sign-in').allowed).toBe(true);
    });
});

describe('expiración de ventana (fake timers)', () => {
    it('agotada la ventana AUTH, 16 min después el contador reinicia', () => {
        const id = freshId();
        for (let i = 0; i < 10; i++) {
            expect(checkRateLimitSync(id, '/api/auth/sign-in').allowed).toBe(true);
        }
        expect(checkRateLimitSync(id, '/api/auth/sign-in').allowed).toBe(false);

        // Dentro de la ventana sigue bloqueado (+14 min < 15 min):
        vi.setSystemTime(BASE + 14 * 60_000);
        expect(checkRateLimitSync(id, '/api/auth/sign-in').allowed).toBe(false);

        // Fuera de la ventana: bucket viejo purgeado, contador en cero:
        vi.setSystemTime(BASE + 16 * 60_000);
        const deNuevo = checkRateLimitSync(id, '/api/auth/sign-in');
        expect(deNuevo.allowed).toBe(true);
        expect(deNuevo.remaining).toBe(9); // primer consumo de la ventana nueva
        expect(getRateLimitStatusSync(id, '/api/auth/sign-in').used).toBe(1);
    });

    it('ventana DEFAULT (60 s): a los 61 s vuelve a permitir', () => {
        const id = freshId();
        for (let i = 0; i < 100; i++) checkRateLimitSync(id, '/api/pos/upload');
        expect(checkRateLimitSync(id, '/api/pos/upload').allowed).toBe(false);

        vi.setSystemTime(BASE + 30_000); // misma ventana → sigue bloqueado
        expect(checkRateLimitSync(id, '/api/pos/upload').allowed).toBe(false);

        vi.setSystemTime(BASE + 61_000); // ventana nueva
        expect(checkRateLimitSync(id, '/api/pos/upload').allowed).toBe(true);
    });
});

describe('resetRateLimitSync', () => {
    it('bloqueado → reset → permitido con contador en cero', () => {
        const id = freshId();
        for (let i = 0; i < 30; i++) checkRateLimitSync(id, '/api/inventory/receiving');
        expect(checkRateLimitSync(id, '/api/inventory/receiving').allowed).toBe(false);

        resetRateLimitSync(id);
        const trasReset = checkRateLimitSync(id, '/api/inventory/receiving');
        expect(trasReset.allowed).toBe(true);
        expect(trasReset.remaining).toBe(29);
    });
});

describe('createRateLimitHeaders', () => {
    it('headers correctos en respuesta permitida (reset en segundos)', () => {
        const id = freshId();
        const resultado = checkRateLimitSync(id, '/api/inventory/receiving'); // limit 30
        const { headers, shouldBlock, retryAfter } = createRateLimitHeaders(resultado);

        expect(shouldBlock).toBe(false);
        expect(retryAfter).toBeUndefined();
        expect(headers['X-RateLimit-Limit']).toBe('30');
        expect(headers['X-RateLimit-Remaining']).toBe('29');
        expect(headers['X-RateLimit-Reset']).toBe(
            String(Math.floor(resultado.reset / 1000)),
        );
        expect(headers['Retry-After']).toBeUndefined();
    });

    it('al bloquear añade Retry-After y shouldBlock=true', () => {
        const id = freshId();
        for (let i = 0; i < 10; i++) checkRateLimitSync(id, '/api/auth/sign-in');
        const bloqueado = checkRateLimitSync(id, '/api/auth/sign-in');
        const { headers, shouldBlock } = createRateLimitHeaders(bloqueado);

        expect(shouldBlock).toBe(true);
        expect(headers['Retry-After']).toBe(String(bloqueado.retryAfter));
        expect(headers['X-RateLimit-Remaining']).toBe('0');
    });
});

describe('variante async sobre memoria (sin Redis)', () => {
    it('comparte el mismo store que la sync: lo consumido por una cuenta para la otra', () => {
        const id = freshId();
        // La sync consume 29 de 30 (critical):
        for (let i = 0; i < 29; i++) checkRateLimitSync(id, '/api/inventory/receiving');

        // La async ve los 29 y registra la #30:
        return checkRateLimit(id, '/api/inventory/receiving').then((r30) => {
            expect(r30.allowed).toBe(true);
            expect(r30.remaining).toBe(0);
            // Y la siguiente (sync o async) ya cae bloqueada:
            expect(checkRateLimitSync(id, '/api/inventory/receiving').allowed).toBe(false);
        });
    });

    it('resetRateLimit async también limpia el store en memoria', () => {
        const id = freshId();
        for (let i = 0; i < 100; i++) checkRateLimitSync(id, '/api/pos/upload');
        expect(checkRateLimitSync(id, '/api/pos/upload').allowed).toBe(false);

        return resetRateLimit(id).then(() => {
            expect(checkRateLimitSync(id, '/api/pos/upload').allowed).toBe(true);
        });
    });
});
