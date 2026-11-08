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

const data = { m: meses, g: geos, s: series };
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

const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
const body = template
  .replace('/*__DATA__*/', () => 'const DATA = ' + JSON.stringify(data) + ';')
  .replace('/*__TOPO__*/', () => 'const TOPO = ' + topo + ';');

const head = '<!doctype html>\n<html lang="pt-PT">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n';
fs.writeFileSync(path.join(__dirname, 'index.html'), head + body.replace('<!--__BODY__-->', '</head>\n<body>') + '\n</body>\n</html>\n');
if (process.argv[2]) fs.writeFileSync(process.argv[2], body.replace('<!--__BODY__-->', ''));
console.log('index.html', (fs.statSync(path.join(__dirname, 'index.html')).size / 1024).toFixed(0), 'KB');
