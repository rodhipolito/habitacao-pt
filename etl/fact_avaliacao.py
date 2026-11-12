"""Gera dados/fact_avaliacao.csv, dados/dim_tempo.csv e dados/dim_geografia.csv a partir da API do INE.

Indicadores (Inquérito à avaliação bancária na habitação, mensal, médias de 3 meses):
  0012248  Valor mediano de avaliação bancária (€/m²), por município (2024) e tipo de construção
  0012247  Avaliações bancárias de alojamentos familiares nos últimos 3 meses (N.º), por NUTS 2024 e tipo

As células sem valor ficam vazias e a razão vai para preco_sem_valor / n_sem_valor:
  nd = dado confidencial ou não disponível (sinal "…" do INE), x = não aplicável.

dim_tipo.csv é fixa (Total, Apartamentos, Moradias) e não é gerada aqui.

Uso:  python etl/fact_avaliacao.py [mes_inicial]      (por omissão 2024-01)
"""
import csv
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "dados"
URL = "https://www.ine.pt/ine/json_indicador/pindica.jsp?op=2&varcd={}&Dim1=T&lang=PT"
MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
         "agosto", "setembro", "outubro", "novembro", "dezembro"]
TIPOS = ["Total", "Apartamentos", "Moradias"]
SINAL = {"…": "nd", "x": "x"}
NIVEL = {"PT": "Pais", 1: "NUTS I", 2: "NUTS II", 3: "NUTS III", 7: "Municipio"}
ORDEM_NIVEL = ["NUTS I", "NUTS II", "Pais", "NUTS III", "Municipio"]


def obter(varcd, tentativas=5):
    """A API do INE falha de vez em quando (erro 'jdbc/conexaoBDDDS'); tenta de novo antes de desistir."""
    for i in range(tentativas):
        with urllib.request.urlopen(URL.format(varcd), timeout=180) as r:
            resp = json.load(r)[0]
        if "Dados" in resp:
            return resp["Dados"]
        time.sleep(10 * (i + 1))
    raise SystemExit(f"A API do INE não devolveu dados para {varcd}: {resp.get('Sucesso')}. Tenta mais tarde.")


def mes_iso(periodo):
    """'Setembro de 2026' -> '2026-09'."""
    nome, ano = re.match(r"(\S+) de (\d{4})", periodo).groups()
    return f"{ano}-{MESES.index(nome.lower()) + 1:02d}"


def nivel(cod):
    return NIVEL["PT"] if cod == "PT" else NIVEL[len(cod)]


def main():
    inicio = sys.argv[1] if len(sys.argv) > 1 else "2024-01"
    precos, avaliacoes = obter("0012248"), obter("0012247")

    celulas, nomes, meses = {}, {}, set()
    for dados, campo in ((precos, "p"), (avaliacoes, "n")):
        for periodo, linhas in dados.items():
            mes = mes_iso(periodo)
            if mes < inicio:
                continue
            meses.add(mes)
            for r in linhas:
                nomes[r["geocod"]] = r["geodsg"]
                celulas[(r["geocod"], mes, r["dim_3_t"], campo)] = (r.get("valor") or "", SINAL.get(r.get("sinal_conv"), ""))

    meses = sorted(meses)
    geos = sorted(nomes, key=lambda c: (c != "PT", c))  # PT primeiro, depois ordem hierárquica do código

    # Factos
    with open(DADOS / "fact_avaliacao.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["cod_geo", "mes", "tipo_construcao", "preco_m2", "n_avaliacoes", "preco_sem_valor", "n_sem_valor"])
        for g in geos:
            for mes in reversed(meses):
                for t in TIPOS:
                    p, ps = celulas.get((g, mes, t, "p"), ("", "nd"))
                    n, ns = celulas.get((g, mes, t, "n"), ("", "nd"))
                    w.writerow([g, f"{mes}-01", t, p, n, ps if not p else "", ns if not n else ""])

    # Tempo
    with open(DADOS / "dim_tempo.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["mes", "ano", "mes_num", "nome_mes", "ano_mes"])
        for mes in meses:
            a, m = int(mes[:4]), int(mes[5:])
            w.writerow([f"{mes}-01", a, m, MESES[m - 1], mes])

    # Geografia: a hierarquia sai dos prefixos do código do INE (NUTS I = 1 carácter, NUTS II = 2, NUTS III = 3)
    linhas = []
    for c in geos:
        nv = nivel(c)
        n3 = c[:3] if nv in ("NUTS III", "Municipio") else ""
        n2 = c[:2] if nv in ("NUTS II", "NUTS III", "Municipio") else ""
        n1 = c[:1] if c != "PT" else ""
        linhas.append([c, nomes[c], nv, n3, n2, n1, nomes.get(n3, ""), nomes.get(n2, "")])
    linhas.sort(key=lambda r: (ORDEM_NIVEL.index(r[2]), r[0]))
    with open(DADOS / "dim_geografia.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["cod_geo", "nome_geo", "nivel", "cod_nuts3", "cod_nuts2", "cod_nuts1", "nome_nuts3", "nome_nuts2"])
        w.writerows(linhas)

    pt = celulas[("PT", meses[-1], "Total", "p")][0]
    print(f"{len(geos)} geografias, {len(meses)} meses ({meses[0]} a {meses[-1]}), "
          f"{len(geos) * len(meses) * len(TIPOS)} linhas. Portugal, {meses[-1]}: {pt} €/m²")


if __name__ == "__main__":
    main()
