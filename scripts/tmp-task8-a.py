import io

p = 'app/dashboard/finance/bank-reconciliation/page.tsx'
s = io.open(p, encoding='utf-8', newline='').read()

def rep(old, new, count=1):
    global s
    assert s.count(old) == count, "count=%d :: %r" % (s.count(old), old[:70])
    s = s.replace(old, new, count)

# 1. interfaces
rep("""interface BankTransactionItem {
    id: string;
    valueDate: string;
    description: string;
    reference: string | null;
    amountCents: number;
    matchStatus: "UNMATCHED" | "MATCHED" | "IGNORED";
    sourceBankAccountId: string | null;
    accountLabel: string | null;
    matchedPaymentRunItemId: string | null;
    matchNotes: string | null;
}""",
    """interface BankTransactionItem {
    id: string;
    valueDate: string;
    description: string;
    reference: string | null;
    amountCents: number;
    matchStatus: "UNMATCHED" | "MATCHED" | "IGNORED";
    sourceBankAccountId: string | null;
    accountLabel: string | null;
    matchedPaymentRunItemId: string | null;
    /** Fila gateway cruzada cuando el match es de ENTRADA. */
    matchedGatewayTransactionId: string | null;
    matchNotes: string | null;
}

interface DepositMatchCandidate {
    gatewayTransactionId: string;
    acquirer: string;
    externalId: string | null;
    authorizationCode: string | null;
    branchName: string | null;
    destinationAccountLastFour: string | null;
    netAmountCents: number;
    settlementDate: string | null;
    dateDiffDays: number;
}""")

rep("""    suggestions: SuggestionsPayload[];
}""",
    """    suggestions: SuggestionsPayload[];
    depositSuggestions: { transactionId: string; candidates: DepositMatchCandidate[] }[];
}""")

rep("""    suggestions: SuggestionsPayload[];
}

interface CatalogAccount {""",
    """    suggestions: SuggestionsPayload[];
    depositSuggestions: { transactionId: string; candidates: DepositMatchCandidate[] }[];
}

interface CatalogAccount {""")

rep("""    summary: {
        unmatchedCount: number;
        matchedCount: number;
        unmatchedOutflowCents: number;
    };""",
    """    summary: {
        unmatchedCount: number;
        matchedCount: number;
        unmatchedOutflowCents: number;
        /** Depósitos (positivos) aún sin cruzar contra pasarela. */
        unmatchedDepositCount: number;
        /** Dinero de pasarela ya cruzado con el banco (entradas MATCHED). */
        matchedDepositCents: number;
    };""")

# 2. deposit candidate map
rep("""    const suggestionsByTx = new Map(
        (data?.suggestions ?? []).map((s) => [s.transactionId, s.candidates])
    );""",
    """    const suggestionsByTx = new Map(
        (data?.suggestions ?? []).map((s) => [s.transactionId, s.candidates])
    );

    const depositSuggestionsByTx = new Map(
        (data?.depositSuggestions ?? []).map((s) => [s.transactionId, s.candidates])
    );""")

# 3. handlers after handleUnmatch
rep("""    const handleUnmatch = async (tx: BankTransactionItem) => {
        try {
            await doPatch(
                { action: "UNMATCH", transactionId: tx.id },
                "Match deshecho — vuelve a la bandeja",
            );
        } catch (err) {
            toast.error("Error al deshacer", { description: (err as Error).message });
        }
    };""",
    """    const handleUnmatch = async (tx: BankTransactionItem) => {
        try {
            await doPatch(
                { action: "UNMATCH", transactionId: tx.id },
                "Match deshecho — vuelve a la bandeja",
            );
        } catch (err) {
            toast.error("Error al deshacer", { description: (err as Error).message });
        }
    };

    /**
     * Confirmar el cruce de UNA entrada contra la fila de pasarela sugerida.
     * Idéntico protocolo que el de salidas: la sugerencia nombra, la persona
     * confirma; más de una candidata en ventana es ambigüedad que no se
     * firma a ciegas.
     */
    const depositCandidatesFor = (tx: BankTransactionItem) =>
        depositSuggestionsByTx.get(tx.id) ?? [];

    const describeDepositCandidate = (c: DepositMatchCandidate): string =>
        `Depositó ${c.acquirer}` +
        (c.branchName ? ` (Suc. ${c.branchName})` : "") +
        (c.destinationAccountLastFour ? ` a ····${c.destinationAccountLastFour}` : "");

    const handleConfirmDeposit = async (tx: BankTransactionItem) => {
        const candidates = depositCandidatesFor(tx);
        if (candidates.length === 0) {
            toast.error("Sin sugerencia de pasarela", {
                description:
                    "No hay reporte con abono neto exacto aterrizando en esta cuenta en la ventana. Asigna cuenta destino al reporte o ignora el movimiento.",
            });
            return;
        }
        if (candidates.length > 1) {
            toast.warning("Más de una candidata", {
                description:
                    `Varias filas de pasarela calzan: ` +
                    candidates
                        .slice(0, 3)
                        .map(describeDepositCandidate)
                        .join(" · ") +
                    ". Revisa el reporte de pasarela para cruzar manualmente.",
            });
            return;
        }
        setConfirming(tx.id);
        try {
            await doPatch(
                {
                    action: "CONFIRM_DEPOSIT_MATCH",
                    transactionId: tx.id,
                    gatewayTransactionId: candidates[0].gatewayTransactionId,
                },
                `Depósito cruzado: ${describeDepositCandidate(candidates[0])}`,
            );
        } catch (err) {
            toast.error("Error al cruzar", { description: (err as Error).message });
        } finally {
            setConfirming(null);
        }
    };

    const handleUnmatchDeposit = async (tx: BankTransactionItem) => {
        try {
            await doPatch(
                { action: "UNMATCH", transactionId: tx.id, deposit: true },
                "Cruce deshecho — el depósito vuelve a la bandeja",
            );
        } catch (err) {
            toast.error("Error al deshacer", { description: (err as Error).message });
        }
    };

    // Entradas: los movimientos positivos viven su propia sección con su
    // propio protocolo, sin mezclarse con las salidas de corridas.
    const depositItems = items.filter((tx) => tx.amountCents > 0);""")

# 4. stats cards
rep("""                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription className="text-xs">Cruzados</CardDescription>
                            <CardTitle className="text-xl font-bold tabular-nums">
                                {summary.matchedCount}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                </div>""",
    """                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription className="text-xs">Cruzados</CardDescription>
                            <CardTitle className="text-xl font-bold tabular-nums">
                                {summary.matchedCount}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription className="text-xs">
                                Depósitos sin cruzar
                            </CardDescription>
                            <CardTitle className="text-xl font-bold tabular-nums">
                                {summary.unmatchedDepositCount}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription className="text-xs">
                                Pasarela cruzada con el banco
                            </CardDescription>
                            <CardTitle className="text-xl font-bold tabular-nums text-emerald-700">
                                {formatCents(summary.matchedDepositCents)}
                            </CardTitle>
                        </CardHeader>
                    </Card>
                </div>""")
rep("""                <div className="grid gap-3 sm:grid-cols-3">""",
    """                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">""")

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
