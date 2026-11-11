"""Lädt den Tagesverlauf von Gold und Silber (USD/Unze) und EUR/USD und schreibt prices.json (Euro pro Gramm).
Läuft täglich als GitHub Action. Quelle: Yahoo Finance (GC=F, SI=F, EURUSD=X), Rückfall: Stooq."""
import json, urllib.request, csv, io, datetime, sys

OZ = 31.1034768
UA = {"User-Agent": "Mozilla/5.0 (Thesauros price bot)"}

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode()

def yahoo(sym):
    j = json.loads(get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=10y&interval=1d"))
    res = j["chart"]["result"][0]
    out = {}
    for t, c in zip(res["timestamp"], res["indicators"]["quote"][0]["close"]):
        if c: out[datetime.datetime.utcfromtimestamp(t).strftime("%Y-%m-%d")] = c
    return out

def stooq(sym):
    out = {}
    for row in csv.DictReader(io.StringIO(get(f"https://stooq.com/q/d/l/?s={sym}&i=d"))):
        try: out[row["Date"]] = float(row["Close"])
        except (KeyError, ValueError): pass
    return out

def series(ysym, ssym):
    for f, s in ((yahoo, ysym), (stooq, ssym)):
        try:
            d = f(s)
            if len(d) > 200: return d
        except Exception as e:
            print("Quelle fehlgeschlagen", f.__name__, s, e, file=sys.stderr)
    raise SystemExit("Keine Daten für " + ysym)

gold, silver, eurusd = series("GC=F", "xauusd"), series("SI=F", "xagusd"), series("EURUSD=X", "eurusd")
days, last_fx = [], None
for d in sorted(set(gold) & set(silver)):
    fx = eurusd.get(d, last_fx)
    if not fx: continue
    last_fx = fx
    days.append([d, round(gold[d] / fx / OZ, 2), round(silver[d] / fx / OZ, 3)])
json.dump({"updated": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ"), "unit": "EUR/g",
           "source": "Yahoo Finance (Gold-/Silber-Futures, EUR/USD)", "days": days},
          open("prices.json", "w"), separators=(",", ":"))
print(len(days), "Tage, letzter:", days[-1])
