/** Contrato de adaptadores hacia la tabla canónica `exceptions`. */

export interface AdapterScope {
  companyId: string;
  branchId?: string | null;
}

export interface AdapterOutcome {
  adapter: string;
  raised: number;
  error?: string;
}

export interface ExceptionAdapter {
  /** `subject_type` canónico que produce (clave de idempotencia). */
  subjectType: string;
  /** Proyecta las filas de dominio a `exceptions`; devuelve cuántas procesó. */
  run(scope: AdapterScope): Promise<number>;
}
