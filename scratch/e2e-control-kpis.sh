BASE=http://localhost:3200
OUT=C:/Users/david/pulso29/scratch/e2e-control-out.json
login() { curl -s -c "$HOME/.e2e-jar-$1.txt" -X POST $BASE/api/auth/sign-in/email -H "Content-Type: application/json" -d "{\"email\":\"$2\",\"password\":\"123456\"}" -o /dev/null -w "%{http_code}"; }
api() { curl -s -b "$HOME/.e2e-jar-$1.txt" "$BASE$2" -o "$OUT" -w "%{http_code}"; }
check() { if [ "$2" == "$3" ]; then echo "  PASS $1 ($3)"; else echo "  FAIL $1 esperado=$2 real=$3"; fi; }

echo "== login =="
check "login maria(ADMIN)" 200 "$(login maria maria@pulso.mx)"
check "login juan(GERENTE)" 200 "$(login juan juan@pulso.mx)"
check "login ana(SUPERVISOR)" 200 "$(login ana ana@pulso.mx)"
check "login pedro(EMPLEADO)" 200 "$(login pedro pedro@pulso.mx)"

echo "== ADMIN: reporte del mes =="
check "GET /api/reports/control" 200 "$(api maria '/api/reports/control?month=2026-08')"
python -c "
import json
d=json.load(open(r'$OUT',encoding='utf-8'))
t=d['budgetExecution']['totals']; e=d['emergencyShare']
print('  mes=%s sucursal=%s filas=%d' % (d['month'], d['branchId'], len(d['budgetExecution']['rows'])))
print('  presupuestado=%d comprometido=%d consumo=%.2f%% estado=%s' % (t['budgetedCents'], t['committedCents'], t['consumedPercent'], t['status']))
print('  emergencias=%d/%d = %.2f%% estado=%s (meta %s%%)' % (e['emergencyCents'], e['totalCents'], e['percent'], e['status'], d['targets']['emergencyTargetPercent']))
print('  sucursales distintas:', sorted({r['branchCode'] or r['branchName'] for r in d['budgetExecution']['rows']}))
"
echo "== GERENTE juan: debe quedar fijo en Condesa aunque pida Polanco =="
check "GET (pide Polanco)" 200 "$(api juan '/api/reports/control?month=2026-08&branchId=b1000001-0000-4000-8000-000000000002')"
python -c "
import json
d=json.load(open(r'$OUT',encoding='utf-8'))
print('  branchId devuelto:', d['branchId'])
print('  sucursales en filas:', sorted({r['branchCode'] or r['branchName'] for r in d['budgetExecution']['rows']}))
"
echo "== roles sin acceso =="
check "SUPERVISOR ana -> 403" 403 "$(api ana '/api/reports/control?month=2026-08')"
check "EMPLEADO pedro -> 403" 403 "$(api pedro '/api/reports/control?month=2026-08')"
echo "== validación =="
check "mes inválido -> 400" 400 "$(api maria '/api/reports/control?month=2026-13')"
check "mes basura -> 400" 400 "$(api maria '/api/reports/control?month=agosto')"
check "sin mes (default) -> 200" 200 "$(api maria '/api/reports/control')"
check "sin sesión -> 401/403" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/reports/control?month=2026-08)"
echo "== página =="
check "GET /dashboard/reports/control" 200 "$(curl -s -b $HOME/.e2e-jar-maria.txt -o /dev/null -w '%{http_code}' $BASE/dashboard/reports/control)"
