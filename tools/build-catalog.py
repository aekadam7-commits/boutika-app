#!/usr/bin/env python3
"""تصفية algeria_products.xlsx وتوليد www/data/catalog.js (+ ملف إكسل نظيف).
الاستعمال:  python3 tools/build-catalog.py algeria_products.xlsx
يحتاج: pandas, openpyxl"""
import re, sys, json, os
import pandas as pd

SRC = sys.argv[1] if len(sys.argv) > 1 else 'algeria_products.xlsx'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT_JS = os.path.join(ROOT, 'www', 'data', 'catalog.js')
OUT_XLSX = os.path.join(ROOT, 'algeria_products_clean.xlsx')

LETTERS = re.compile(r'[A-Za-zÀ-ÿ\u0600-\u06FF]')
JUNK = re.compile(r'/!\\|interdit en europe|^\W*(n/?a|none|null|test|produit|product|inconnu)\W*$', re.I)

def ean_ok(c):
    if len(c) not in (8, 12, 13, 14): return False
    d = [int(x) for x in c]
    s = sum(x * (3 if i % 2 == 0 else 1) for i, x in enumerate(reversed(d[:-1])))
    return (10 - s % 10) % 10 == d[-1]

def clean_name(n):
    if not isinstance(n, str): return ''
    n = JUNK.sub(' ', n)
    parts = [p.strip(" -–—_.,;:*|/\\\t") for p in re.split(r'\s+[-–—]\s+', n)]
    seen, out = set(), []
    for p in parts:                       # "Mag Delices - Mag Delices" -> "Mag Delices"
        k = p.lower()
        if p and k not in seen: seen.add(k); out.append(p)
    n = re.sub(r'\s+', ' ', ' - '.join(out)).strip(" -–—_.,;:*|/\\")
    if len(n) < 3 or len(n) > 80 or not LETTERS.search(n): return ''
    if len(re.findall(r'\d', n)) > len(n) / 2: return ''
    return n

def clean_qty(q):
    if not isinstance(q, str): return ''
    q = re.sub(r'(?i)poids net|net weight|net wt|contenu net', '', q)
    q = re.sub(r'\s+', ' ', q).strip(" .,-")
    if not re.search(r'\d', q) or not LETTERS.search(q) or len(q) > 20: return ''   # أرقام مجرّدة غامضة
    return q

d = pd.read_excel(SRC, dtype=str)
total = len(d)
d['code'] = d['code'].astype(str).str.strip()
d = d[d['code'].str.fullmatch(r'\d+')]
d = d[~d['code'].str.startswith('0000')]                      # أرقام هواتف/أكواد وهمية
d = d[d['code'].map(ean_ok)]
d['name'] = d['product_name'].map(clean_name)
d['qty'] = d['quantity'].map(clean_qty)
d = d[d['name'] != '']
# لا تكرر الحجم إن كان موجودًا في الاسم
d['qty'] = [('' if q and q.lower().replace(' ', '') in n.lower().replace(' ', '') else q) for n, q in zip(d['name'], d['qty'])]
d = d.drop_duplicates('code')
d = d.sort_values('code')

clean = d[['code', 'name', 'qty']].rename(columns={'name': 'product_name', 'qty': 'quantity'})
clean.to_excel(OUT_XLSX, index=False)

cat = {r.code: ([r.name, r.qty] if r.qty else [r.name]) for r in d.itertuples()}
os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)
with open(OUT_JS, 'w', encoding='utf-8') as f:
    f.write('/* مولَّد من algeria_products.xlsx بواسطة tools/build-catalog.py — لا تعدّله يدويًا */\n')
    f.write('window.BOUTIKA_CATALOG=' + json.dumps(cat, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(f'{total} -> {len(cat)} منتج | {os.path.getsize(OUT_JS)//1024} KB')
