"""Gera dados/fact_vendas.csv a partir da API do INE.

Indicadores (Estatísticas de preços da habitação ao nível local, Metodologia 2022):
  0012234  Valor mediano das vendas de alojamentos familiares nos últimos 12 meses (€/m²),
           por localização geográfica (NUTS 2024) e categoria (Total, Novos, Existentes)
  0014363  Vendas de alojamentos familiares nos últimos 12 meses (N.º), por localização geográfica

Só ficam as geografias que existem em dados/dim_geografia.csv (país, NUTS e municípios);
as freguesias são descartadas.

Uso:  python etl/fact_vendas.py
"""
import csv
import json
import re
import urllib.request
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "dados"
URL = "https://www.ine.pt/ine/json_indicador/pindica.jsp?op=2&varcd={}&Dim1=T&lang=PT"


def obter(varcd):
    with urllib.request.urlopen(URL.format(varcd), timeout=120) as r:
        return json.load(r)[0]["Dados"]


def trimestre(periodo):
    """'2.º Trimestre de 2026' -> date(2026, 6, 1) (último mês do trimestre)."""
    m = re.match(r"(\d)\.\D+Trimestre de (\d{4})", periodo)
    t, a = int(m.group(1)), int(m.group(2))
    return date(a, t * 3, 1), f"{a} T{t}"


def inteiro(v):
    return int(v) if v not in (None, "") else ""


def main():
    with open(DADOS / "dim_geografia.csv", encoding="utf-8-sig") as f:
        geos = {g["cod_geo"] for g in csv.DictReader(f)}

    precos = obter("0012234")
    vendas = obter("0014363")

    n = {}
    for periodo, linhas in vendas.items():
        for r in linhas:
            if r["geocod"] in geos:
                n[(periodo, r["geocod"])] = inteiro(r.get("valor"))

    saida = []
    for periodo, linhas in precos.items():
        mes, rotulo = trimestre(periodo)
        for r in linhas:
            if r["geocod"] not in geos:
                continue
            cat = r["dim_3_t"]
            saida.append({
                "cod_geo": r["geocod"],
                "trimestre": mes.isoformat(),
                "trimestre_label": rotulo,
                "categoria": cat,
                "preco_m2_venda": inteiro(r.get("valor")),
                "n_vendas": n.get((periodo, r["geocod"]), "") if cat == "Total" else "",
            })

    ordem = {"Total": 0, "Novos": 1, "Existentes": 2}
    saida.sort(key=lambda x: (x["trimestre"], x["cod_geo"], ordem.get(x["categoria"], 9)), reverse=False)
    saida.sort(key=lambda x: x["trimestre"], reverse=True)

    with open(DADOS / "fact_vendas.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(saida[0]))
        w.writeheader()
        w.writerows(saida)

    trimestres = sorted({x["trimestre"] for x in saida})
    print(f"{len(saida)} linhas, {len(trimestres)} trimestres ({trimestres[0]} a {trimestres[-1]})")
    pt = [x for x in saida if x["cod_geo"] == "PT" and x["categoria"] == "Total" and x["trimestre"] == trimestres[-1]][0]
    print(f"Portugal, último trimestre: {pt['preco_m2_venda']} €/m², {pt['n_vendas']} vendas")


if __name__ == "__main__":
    main()
