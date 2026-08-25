#!/bin/bash
BASE=http://localhost:3000
OUT="C:/Users/david/pulso29/scratch/e2e-out.json"
BR_CONDESA=b1000001-0000-4000-8000-000000000001
BR_POLANCO=b1000001-0000-4000-8000-000000000002
CC_MANT=b805b372-65d3-4c0f-9dbe-19ef903cbce4
MES=$(date +%Y-%m)

login() {
  curl -s -c "$HOME/.e2e-jar-$1.txt" -X POST $BASE/api/auth/sign-in/email \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$2\",\"password\":\"123456\"}" -o /dev/null -w "%{http_code}"
}
api() {
  local m=$1 jar=$2 url=$3 data=$4
  if [ -n "$data" ]; then
    curl -s -b "$HOME/.e2e-jar-$jar.txt" -X "$m" "$BASE$url" -H "Content-Type: application/json" -d "$data" -o "$OUT" -w "%{http_code}"
  else
    curl -s -b "$HOME/.e2e-jar-$jar.txt" -X "$m" "$BASE$url" -o "$OUT" -w "%{http_code}"
  fi
}
pyget() { python -c "
import json,sys
d=json.load(open(r'C:/Users/david/pulso29/scratch/e2e-out.json', encoding='utf-8'))
for k in sys.argv[1].split('.'):
    d=d[int(k)] if isinstance(d,list) else d[k]
print(d)
" "$1"; }
check() {
  if [ "$2" == "$3" ]; then echo "  PASS $1 ($3)"; else echo "  FAIL $1 esperado=$2 real=$3"; fi
}
