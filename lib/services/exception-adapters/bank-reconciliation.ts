/**
 * EXC-04.banco — Adaptador de excepciones bancarias (`bank_reconciliation`).
 *
 * Proyecta pagos/depósitos pendientes o discrepantes hacia `exceptions`
 * conservando fuente, antigüedad y diferencias sin duplicar.
 */
import { BANK_EXCEPTION_SUBJECT_TYPE } from "../bank-exception-rules";
import { syncCompanyBankExceptions } from "../bank-exception-service";
import type { AdapterScope, ExceptionAdapter } from "./types";

export const bankReconciliationAdapter: ExceptionAdapter = {
  subjectType: BANK_EXCEPTION_SUBJECT_TYPE,
  async run({ companyId }: AdapterScope): Promise<number> {
    const summary = await syncCompanyBankExceptions({ companyId });
    return summary.raised;
  },
};
