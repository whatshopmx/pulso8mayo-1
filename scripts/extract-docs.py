"""Extract readable text from Next.js RSC payload docs pages."""
import sys, re, json

content = sys.stdin.read()

# Only the RSC script chunks hold doc content
chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)</script>', content, re.DOTALL)
seen = set()
out = []
for chunk in chunks:
    try:
        decoded = json.loads('"' + chunk + '"')
    except Exception:
        continue
    # find quoted strings inside decoded chunk
    for m in re.findall(r'"((?:[^"\\]|\\.){3,}?)"', decoded):
        try:
            s = json.loads('"' + m + '"')
        except Exception:
            continue
        s = s.strip()
        if not s or s in seen:
            continue
        # keep prose: must contain a space and letters, not be code/markup noise
        if '<' in s or 'className' in s or s.startswith(('$', 'static/', 'm11.5')):
            continue
        if not re.search(r'[a-záéíóúñ]{3,}\s', s, re.IGNORECASE):
            continue
        seen.add(s)
        out.append(s)

print('\n'.join(out))
