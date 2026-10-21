import io

p = 'app/dashboard/finance/cash-flow/reconciliation/page.tsx'
s = io.open(p, encoding='utf-8', newline='').read()

old = """    </Tab 3 placeholder>"""

# insert TabsContent before closing </Tabs> at line ~959
old_tail = """
      </Tabs>
    </div>
  );
}
"""
assert s.count(old_tail) == 1

content = """
        {/* Tab 3: Cruce de Plataformas (venta cobrada vs neto aterrizado) */}
        <TabsContent value="platforms" className="m-0 space-y-4">
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-semibold">
                Cruce por plataforma
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                "Venta cobrada por la plataforma vs neto aterrizado al banco" — la
                columna banco viene del cruce confirmado en conciliación bancaria;
                sin cruce queda visible, no oculto.
              </span>
            </CardHeader>
            <CardContent className="p-0">
              {platformLoading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-xs">Cruzando plataformas…</span>
                </div>
              ) : platformRows.length === 0 ? (
                <div className="py-12 text-center space-y-3">
                  <p className="font-semibold text-foreground">
                    Sin cruces por plataforma en este período
                  </p>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    Importa el payout de la plataforma y cruzalos contra el estado
                    de cuenta en Conciliación bancaria → Entradas.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead>Plataforma</TableHead>
                        <TableHead className="text-right">Depósitos cruzados</TableHead>
                        <TableHead className="text-right">Venta bruta</TableHead>
                        <TableHead className="text-right">Comisión</TableHead>
                        <TableHead className="text-right">IVA (16%)</TableHead>
                        <TableHead className="text-right">Neto aterrizado</TableHead>
                        <TableHead className="text-right">Cruzado con banco</TableHead>
                        <TableHead className="text-right">Comisión efectiva</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {platformRows.map((row) => (
                        <TableRow key={row.acquirer} className="text-xs">
                          <TableCell>
                            <Badge variant="outline" className="text-xs font-medium">
                              {row.acquirer}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.transactionCount}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCents(row.grossCents)}
                          </TableCell>
                          <TableCell className="text-right text-warning-text">
                            {formatCents(row.feeCents)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatCents(row.feeVatCents)}
                          </TableCell>
                          <TableCell className="text-right font-bold">
                            {formatCents(row.netCents)}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-emerald-700">
                            {formatCents(row.bankMatchedCents)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {(row.effectiveRateBps / 100).toFixed(2)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
"""

s = s.replace(old_tail, content)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
