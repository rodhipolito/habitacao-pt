// Gera web/index.html (página completa para alojar) a partir dos CSVs em dados/ e do mapa em mapas/.
// Uso: node web/build.js [ficheiro-extra-sem-doctype]
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const csv = f => fs.readFileSync(path.join(root, 'dados', f), 'utf8')
  .replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map(l => l.split(','));

const geoRows = csv('dim_geografia.csv'); geoRows.shift();
const tempo = csv('dim_tempo.csv'); tempo.shift();
const fact = csv('fact_avaliacao.csv'); fact.shift();

const meses = tempo.map(r => r[0].slice(0, 7)).sort();
const mesIdx = new Map(meses.map((m, i) => [m, i]));
const geos = [['PT', 'Portugal', '', ''], ...geoRows
  .filter(r => r[2] === 'Municipio')
  .map(r => [r[0], r[1], r[6], r[7]])];
const geoIdx = new Map(geos.map((g, i) => [g[0], i]));
const tipos = ['Total', 'Apartamentos', 'Moradias'];

const series = {};
for (const t of tipos) series[t] = geos.map(() => [meses.map(() => null), meses.map(() => null)]);
for (const [cod, mes, tipo, preco, n] of fact) {
  const gi = geoIdx.get(cod);
  const mi = mesIdx.get(mes.slice(0, 7));
  if (gi === undefined || mi === undefined || !series[tipo]) continue;
  if (preco !== '') series[tipo][gi][0][mi] = +preco;
  if (n !== '') series[tipo][gi][1][mi] = +n;
}

// Vendas (INE, preços da habitação ao nível local): trimestral, janela de 12 meses.
// Por geografia: [preço Total, n.º de vendas, preço Novos, preço Existentes], um valor por trimestre.
const vendasRows = csv('fact_vendas.csv'); vendasRows.shift();
const trimestres = [...new Set(vendasRows.map(r => r[1].slice(0, 7)))].sort();
const trimIdx = new Map(trimestres.map((q, i) => [q, i]));
const vendas = geos.map(() => [0, 1, 2, 3].map(() => trimestres.map(() => null)));
const catCol = { Total: 0, Novos: 2, Existentes: 3 };
for (const [cod, trim, , cat, preco, n] of vendasRows) {
  const gi = geoIdx.get(cod);
  if (gi === undefined || catCol[cat] === undefined) continue;
  const qi = trimIdx.get(trim.slice(0, 7));
  if (preco !== '') vendas[gi][catCol[cat]][qi] = +preco;
  if (cat === 'Total' && n !== '') vendas[gi][1][qi] = +n;
}

const data = { m: meses, g: geos, s: series, vq: trimestres, v: vendas };
const topo = fs.readFileSync(path.join(root, 'mapas', 'municipios_pt.json'), 'utf8');

// Conferência com o Power BI: último mês, Total, mínimo 150.
{
  const last = meses.length - 1;
  const s = series.Total;
  const rel = (gi, mi) => (s[gi][0][mi] != null && s[gi][1][mi] >= 150 ? s[gi][0][mi] : null);
  const rows = geos.slice(1).map((g, k) => {
    const a = rel(k + 1, last), b = rel(k + 1, last - 12);
    return { nome: g[1], v: a != null && b != null ? a / b - 1 : null };
  }).filter(r => r.v != null).sort((a, b) => b.v - a.v);
  const vs = rows.map(r => r.v).sort((a, b) => a - b);
  const med = vs.length % 2 ? vs[(vs.length - 1) / 2] : (vs[vs.length / 2 - 1] + vs[vs.length / 2]) / 2;
  console.log('PT preço', s[0][0][last], 'yoy', (s[0][0][last] / s[0][0][last - 12] - 1).toFixed(3),
    '| ranking', rows.length, 'mediana', med.toFixed(3), '| top3', rows.slice(0, 3).map(r => r.nome + ' ' + r.v.toFixed(3)).join(', '));
}

// Conferência com o Power BI, página "Avaliação vs venda": último trimestre, mínimo 150.
{
  const qi = trimestres.length - 1;
  const mi = meses.indexOf(trimestres[qi]);
  const aval12 = gi => {
    const v = [];
    for (let k = Math.max(0, mi - 11); k <= mi; k++) {
      const p = series.Total[gi][0][k], n = series.Total[gi][1][k];
      if (p != null && n != null && n >= 150) v.push(p);
    }
    return v.length >= 6 ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const dif = gi => { const a = aval12(gi), v = vendas[gi][0][qi]; return a != null && v != null ? a / v - 1 : null; };
  const ds = geos.slice(1).map((g, k) => dif(k + 1)).filter(v => v != null).sort((a, b) => a - b);
  const med = ds.length % 2 ? ds[(ds.length - 1) / 2] : (ds[ds.length / 2 - 1] + ds[ds.length / 2]) / 2;
  console.log('Vendas', trimestres[qi], '| PT venda', vendas[0][0][qi], 'n', vendas[0][1][qi],
    '| aval 12m', aval12(0)?.toFixed(2), 'dif', dif(0)?.toFixed(3), '| comparáveis', ds.length, 'mediana', med.toFixed(3));
}

const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
const body = template
  .replace('/*__DATA__*/', () => 'const DATA = ' + JSON.stringify(data) + ';')
  .replace('/*__TOPO__*/', () => 'const TOPO = ' + topo + ';');

const head = '<!doctype html>\n<html lang="pt-PT">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n';
fs.writeFileSync(path.join(__dirname, 'index.html'), head + body.replace('<!--__BODY__-->', '</head>\n<body>') + '\n</body>\n</html>\n');
if (process.argv[2]) fs.writeFileSync(process.argv[2], body.replace('<!--__BODY__-->', ''));
console.log('index.html', (fs.statSync(path.join(__dirname, 'index.html')).size / 1024).toFixed(0), 'KB');

// Pasta de publicação do Vercel (não vai para o Git): página principal e documento do ETL.
const pub = path.join(__dirname, 'habitacao-pt');
if (fs.existsSync(pub)) {
  fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(pub, 'index.html'));
  fs.copyFileSync(path.join(root, 'docs', 'etl-habitacao.html'), path.join(pub, 'etl.html'));
  console.log('copiado para web/habitacao-pt (index.html, etl.html)');
}
