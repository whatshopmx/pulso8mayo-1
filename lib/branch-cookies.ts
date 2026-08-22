/**
 * Nombres de las cookies de alcance. Sin dependencias, a propósito.
 *
 * `lib/tenant-context.ts` importa `db` y `auth`, así que un componente cliente
 * no puede importar de ahí — por eso `lib/branch-context.tsx` tenía su propia
 * copia del nombre `pulso_selected_branch`, con dos constantes separadas para
 * la misma cookie. Este módulo es el lugar único que las dos mitades sí pueden
 * compartir.
 */

/** La sucursal en foco. Ausente = el usuario no eligió, o eligió "Todas". */
export const BRANCH_COOKIE_NAME = "pulso_selected_branch";

/**
 * Cookie **aparte** para declarar que el alcance elegido es "Todas".
 *
 * La alternativa era un centinela dentro de `pulso_selected_branch`, y no se
 * puede: esa cookie la leen cinco lugares del servidor
 * (`lib/tenant-context.ts:24`, `app/dashboard/layout.tsx`,
 * `app/dashboard/incidents/page.tsx`, `app/dashboard/page.tsx`,
 * `app/dashboard/workflows/history/page.tsx`) y todos la tratan como un id de
 * sucursal. Un centinela ahí dentro se iría a las consultas como si fuera una
 * sucursal real y dejaría media app en blanco — la misma sucursal fantasma que
 * arregló el commit `a1f936a`.
 *
 * Al vivir aparte, ningún lector existente cambia de comportamiento: para todos
 * ellos "Todas" sigue siendo la ausencia de `pulso_selected_branch`, que es lo
 * que ya significaba.
 */
export const BRANCH_SCOPE_COOKIE_NAME = "pulso_branch_scope";

/** Único valor con significado de `BRANCH_SCOPE_COOKIE_NAME`. */
export const BRANCH_SCOPE_ALL = "all";

/** 30 días, en segundos. */
export const BRANCH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
