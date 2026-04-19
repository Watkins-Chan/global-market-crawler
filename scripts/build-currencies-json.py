#!/usr/bin/env python3
"""Generate src/data/currencies.json from ISO 4217 CSV (run manually when refreshing list)."""
import csv
import json
from collections import OrderedDict
from pathlib import Path
import urllib.request

URL = "https://raw.githubusercontent.com/datasets/currency-codes/master/data/codes-all.csv"
ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "src" / "data" / "currencies.json"

SYM = {
    "USD": "$", "EUR": "€", "GBP": "£", "JPY": "¥", "CNY": "¥", "KRW": "₩",
    "VND": "₫", "INR": "₹", "RUB": "₽", "TRY": "₺", "BRL": "R$", "CHF": "Fr.",
    "AUD": "A$", "CAD": "C$", "HKD": "HK$", "SGD": "S$", "NZD": "NZ$", "MXN": "$",
    "ZAR": "R", "SEK": "kr", "NOK": "kr", "DKK": "kr", "PLN": "zł", "THB": "฿",
    "IDR": "Rp", "MYR": "RM", "PHP": "₱", "TWD": "NT$", "AED": "د.إ", "SAR": "﷼",
    "ILS": "₪", "EGP": "E£", "GBX": "p",
}


def main() -> None:
    raw = urllib.request.urlopen(URL, timeout=60).read().decode("utf-8")
    reader = csv.DictReader(raw.splitlines())
    by_code: "OrderedDict[str, str]" = OrderedDict()
    for r in reader:
        code = (r.get("AlphabeticCode") or "").strip()
        if not code:
            continue
        name = (r.get("Currency") or "").strip() or code
        if code not in by_code:
            by_code[code] = name

    currencies = []
    for code, name in sorted(by_code.items()):
        currencies.append({
            "code": code,
            "name": name,
            "symbol": SYM.get(code, code),
            "units_per_usd": None,
        })

    if "GBX" not in by_code:
        currencies.append({
            "code": "GBX",
            "name": "Penny sterling",
            "symbol": SYM["GBX"],
            "units_per_usd": None,
        })
        currencies.sort(key=lambda x: x["code"])

    out = {
        "schemaVersion": 1,
        "meta": {
            "source": "ISO 4217 (datasets/currency-codes). Chỉnh units_per_usd để ghi đè tỉ giá API; null = dùng API open.er-api.com.",
            "units_per_usd": "Số đơn vị tiền này đổi được cho 1 USD (giống rates trong API /latest/USD).",
        },
        "currencies": currencies,
    }

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(currencies)} entries to {TARGET}")


if __name__ == "__main__":
    main()
