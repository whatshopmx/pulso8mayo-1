# Pulso HORECA 

Pulso HORECA es el Software Integral MVP diseñado para cadenas de restaurantes, enfocado en resolver el control de calidad, reglas sanitarias gubernamentales (NOM-251, NOM-035), auditoría de inventarios y control de RH / Asistencia apalancado con automatizaciones vía WhatsApp.

## 🚀 Tecnologías Clave
- **Framework Ocupacional**: Next.js 14+ (App Router) y React.
- **Base de Datos y ORM**: Neon Database (Postgres) administrada con Drizzle ORM.
- **Autenticación y Seguridad**: `better-auth` para permisos MultiTenant/Role-Based, integraciones tokenizadas, Rate Limiter custom.
- **Colas y Tareas Cron**: Upstash (QStash + Redis) y cronjobs programables.
- **UI & UX**: Componentes Radix UI, Dnd-kit, TailwindCSS, date-fns (locale MX), Recharts para KPIs.

## 🛠 Instalación Local en Desarrollo

1. Clona el repositorio e instala las dependencias mediante tu manejador:
   ```bash
   npm install
   ```
2. Inicializa las copias `.env`: 
   Copia el archivo originario y renómbralo a `.env.local`. Deberás disponer de la cadena de conexión de Neon (`DATABASE_URL`) y tus variables de QStash / WhatsApp activas para una simulación íntegra de Notificaciones o Workflows remotos.
   
3. Aplica los esquemas generados por Drizzle y alinea el DB (¡Precaución! puede ejecutar drop a esquemas conflictivos):
   ```bash
   npx drizzle-kit push
   ```
4. Si requieres observar el Panel de Demostración del MVP repleto de métricas e historial de la semana pasada, ejecuta nuestro Seed de demostración (Añadido en Sprint 4):
   ```bash
   pnpm seed --reset
   ```
5. Corre la Interfaz Web:
   ```bash
   npm run dev
   ```

El proyecto estará disponible iterando en [http://localhost:3000].
