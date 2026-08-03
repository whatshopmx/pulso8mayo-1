"""Extract code/JSON examples from Next.js RSC docs payload containing a keyword."""
import sys, re, json

path = sys.argv[1]
keyword = sys.argv[2].lower()
max_hits = int(sys.argv[3]) if len(sys.argv) > 3 else 3

content = open(path, encoding='utf-8').read()
chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)</script>', content, re.DOTALL)
found = 0
for chunk in chunks:
    try:
        decoded = json.loads('"' + chunk + '"')
    except Exception:
        continue
    for m in re.findall(r'"((?:[^"\\]|\\.){300,}?)"', decoded):
        try:
            s = json.loads('"' + m + '"')
        except Exception:
            continue
        if keyword in s.lower() and '{' in s:
            print(s[:5000])
            print('=' * 80)
            found += 1
            if found >= max_hits:
                sys.exit(0)
