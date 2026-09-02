/**
 * Service worker de Pulso.
 *
 * Alcance deliberadamente estrecho: cachea el shell estático y sirve una
 * página de respaldo cuando no hay red. **No cachea `/api/`** — los datos de
 * esta app son operativos (incidentes abiertos, conteos de inventario, turnos)
 * y servir una respuesta vieja desde el cache es peor que un error de red: el
 * gerente creería estar viendo el estado actual de la sucursal.
 *
 * La versión va en el nombre del cache. Cambiarla es lo que invalida lo viejo:
 * los caches con otro nombre se borran en `activate`.
 */

const VERSION = 'pulso-v1';
const CACHE_ESTATICO = `${VERSION}-estatico`;
const RESPALDO_OFFLINE = '/offline.html';

const PRECACHE = [RESPALDO_OFFLINE, '/icon-192.png', '/icon-512.png', '/manifest.json'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE_ESTATICO)
            // `addAll` es atómico: si un recurso falla, no se instala nada. El
            // respaldo offline sin sus iconos es peor que no tener respaldo.
            .then((cache) => cache.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((nombres) =>
                Promise.all(
                    nombres
                        .filter((n) => !n.startsWith(VERSION))
                        .map((n) => caches.delete(n))
                )
            )
            .then(() => self.clients.claim())
    );
});

/** ¿Es un recurso estático que vale la pena cachear? */
function esEstatico(url) {
    return (
        url.pathname.startsWith('/_next/static/') ||
        /\.(?:css|js|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)
    );
}

self.addEventListener('fetch', (event) => {
    const { request } = event;

    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Solo mismo origen. Las fotos de evidencia viven en R2 (otro dominio) y
    // sus URLs son presignadas: cachearlas guardaría una firma que caduca.
    if (url.origin !== self.location.origin) return;

    // Los datos nunca salen del cache. Ver la nota de arriba.
    if (url.pathname.startsWith('/api/')) return;

    if (esEstatico(url)) {
        // Cache-first: `/_next/static/` lleva hash en el nombre, así que un
        // archivo con la misma URL es literalmente el mismo archivo.
        event.respondWith(
            caches.match(request).then(
                (cacheado) =>
                    cacheado ||
                    fetch(request).then((res) => {
                        if (res.ok) {
                            const copia = res.clone();
                            caches.open(CACHE_ESTATICO).then((c) => c.put(request, copia));
                        }
                        return res;
                    })
            )
        );
        return;
    }

    // Navegaciones: red primero, y si no hay red, la página de respaldo. Nunca
    // se sirve una pantalla cacheada con datos viejos.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(() =>
                caches.match(RESPALDO_OFFLINE).then(
                    (res) =>
                        res ||
                        new Response('Sin conexión', {
                            status: 503,
                            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                        })
                )
            )
        );
    }
});

/**
 * Aviso push. El servidor manda `{ title, body, url, tag }`.
 *
 * `tag` colapsa avisos del mismo incidente: sin él, tres escalaciones del
 * mismo problema apilan tres notificaciones y el empleado las descarta todas
 * de un manotazo.
 */
self.addEventListener('push', (event) => {
    if (!event.data) return;

    let datos;
    try {
        datos = event.data.json();
    } catch {
        datos = { title: 'Pulso', body: event.data.text() };
    }

    event.waitUntil(
        self.registration.showNotification(datos.title || 'Pulso', {
            body: datos.body || '',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: datos.tag || undefined,
            renotify: Boolean(datos.tag),
            data: { url: datos.url || '/dashboard/notifications' },
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const destino = event.notification.data?.url || '/dashboard/notifications';

    // Si ya hay una pestaña de Pulso abierta se reutiliza: abrir una nueva en
    // cada aviso deja al usuario con diez pestañas del mismo dashboard.
    event.waitUntil(
        self.clients
            .matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientes) => {
                for (const cliente of clientes) {
                    if (cliente.url.includes(self.location.origin) && 'focus' in cliente) {
                        cliente.navigate(destino);
                        return cliente.focus();
                    }
                }
                return self.clients.openWindow(destino);
            })
    );
});
