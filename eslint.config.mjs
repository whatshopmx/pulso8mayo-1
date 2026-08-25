import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // ── Baseline de deuda técnica (Task 4, decisión documentada) ─────────
      // El repo nació con `strict: false` y ~950 usos de `any`; bajarlos es
      // una épica aparte, no un prerrequisito de CI. Como warnings siguen
      // visibles en la salida de lint sin bloquear el pipeline.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      // Entidades HTML en texto JSX: cosmético, 37 casos preexistentes.
      "react/no-unescaped-entities": "off",
      // Reglas nuevas del plugin react-hooks v6 (era compiler): requieren
      // refactors que no caben en Task 4. Se mantienen visibles como warning.
      "react-hooks/static-components": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  // NO se relajan: son errores de crash real. Los 11 casos se corrigen en
  // código, no en config.
  // - react-hooks/rules-of-hooks (onboarding/offboarding, workflow-stepper)
  // - prefer-const
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // No son código del proyecto (Task 4: lint debe ser verde y rápido):
    // - .worktrees/ tiene su propia copia del repo y node_modules
    // - reportes de Playwright (assets JS minificados)
    // - skills de agentes instaladas como archivos sueltos
    ".worktrees/**",
    "playwright-report/**",
    "test-results/**",
    ".agents/**",
    ".claude/**",
    ".opencode/**",
    ".github/skills/**",
    ".github/hooks/**",
  ]),
]);

export default eslintConfig;
