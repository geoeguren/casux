/**
 * src/workers/classify-worker.js — Web Worker para clasificación de capas
 *
 * Corre en un hilo separado para no bloquear la UI durante cálculos pesados.
 *
 * Operaciones:
 *   - breaks:      calcula cortes para clasificación graduada
 *   - colorMap:    construye mapa de colores para clasificación categorizada
 *
 * Recibe: { op, ...params }
 * Envía:  { result } o { error }
 */

function computeBreaks(values, method, classes) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return [];

  if (method === 'equal') {
    const min = sorted[0], max = sorted[n-1], step = (max - min) / classes;
    return Array.from({length: classes+1}, (_, i) => min + i * step);
  }

  if (method === 'quantile') {
    const breaks = [sorted[0]];
    for (let i = 1; i < classes; i++) {
      breaks.push(sorted[Math.floor(i * n / classes)]);
    }
    breaks.push(sorted[n-1]);
    return breaks;
  }

  if (method === 'jenks') {
    const mat1 = [], mat2 = [];
    for (let i = 0; i <= n; i++) { mat1[i] = []; mat2[i] = []; }
    for (let i = 1; i <= n; i++) { mat1[i][1] = 1; mat2[i][1] = 0; }
    for (let j = 2; j <= classes; j++) {
      for (let i = j; i <= n; i++) {
        let minV = Infinity;
        for (let m = 1; m <= i-1; m++) {
          const slice = sorted.slice(m-1, i);
          const mean  = slice.reduce((a,b) => a+b, 0) / slice.length;
          const ssd   = slice.reduce((a,b) => a+(b-mean)**2, 0);
          const v     = (mat2[m][j-1] || 0) + ssd;
          if (v < minV) { minV = v; mat1[i][j] = m; mat2[i][j] = v; }
        }
      }
    }
    const breaks = [sorted[n-1]];
    let k = n;
    for (let j = classes; j >= 2; j--) {
      const id = mat1[k][j] - 1;
      breaks.unshift(sorted[id]);
      k = mat1[k][j];
    }
    breaks.unshift(sorted[0]);
    return breaks;
  }

  return [];
}

function _randomColor(seed) {
  // Genera un color HSL legible a partir de un índice determinístico
  const hue = (seed * 137.508) % 360; // golden angle — distribuye bien
  return `hsl(${Math.round(hue)},55%,48%)`;
}

function computeColorMap(values, colors, maxCats) {
  const unique   = [...new Set(values)].sort();
  const colorMap = {};
  unique.slice(0, maxCats * 2).forEach((v, i) => {
    // Si la paleta tiene color para este índice, usarlo; si no, generar uno aleatorio
    colorMap[v] = colors[i % colors.length] || _randomColor(i);
  });
  return colorMap;
}

onmessage = function(e) {
  try {
    const { op } = e.data;

    if (op === 'breaks') {
      const { values, method, classes } = e.data;
      const breaks = computeBreaks(values, method, classes);
      postMessage({ result: breaks });

    } else if (op === 'colorMap') {
      const { values, colors, maxCats } = e.data;
      const colorMap = computeColorMap(values, colors, maxCats);
      postMessage({ result: colorMap });

    } else {
      postMessage({ error: `Operación desconocida: ${op}` });
    }

  } catch (err) {
    postMessage({ error: err.message });
  }
};
