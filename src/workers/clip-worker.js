/**
 * src/workers/clip-worker.js — Web Worker para operaciones geométricas con Turf.js
 *
 * Corre en un hilo separado para no bloquear la UI durante operaciones pesadas.
 * Actúa como fallback de api/clip.js.
 *
 * Operaciones soportadas:
 *   - union:  une múltiples polígonos en uno (para normalizar MultiPolygon)
 *   - clip:   recorta features contra una máscara (devuelve geometría recortada)
 *
 * Recibe: { op, ...params }
 * Envía:  { result } o { error }
 */

// NOTA: turf.min.js debe descargarse manualmente y colocarse en esta carpeta.
// Ver src/workers/README.md para instrucciones.
// URL origen: https://unpkg.com/@turf/turf@6.5.0/turf.min.js
importScripts('/src/workers/turf.min.js');

// ── union ─────────────────────────────────────────────────────────

function unionFeatures(features) {
  if (!features?.length) return null;

  // Si hay un unico feature MultiPolygon, descomponerlo en sus subpoligonos
  // y unirlos. Sin esto, el MultiPolygon vuelve intacto y el clip opera solo
  // sobre el primer subpoligono (bug principal del clip erratico).
  if (features.length === 1) {
    const feat = features[0];
    if (feat.geometry?.type !== 'MultiPolygon') return feat;
    const subpoligonos = feat.geometry.coordinates.map(coords => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: coords },
      properties: feat.properties || {},
    }));
    if (subpoligonos.length === 1) return subpoligonos[0];
    try {
      return subpoligonos.reduce((acc, p) => turf.union(acc, p));
    } catch {
      return subpoligonos[0];
    }
  }

  try {
    return features.reduce((acc, feat) => turf.union(acc, feat));
  } catch {
    return features[0];
  }
}

// ── limpiarFragmentos ────────────────────────────────────────────

// Descarta sub-polígonos satelitales del resultado del clip.
// Sub-polígonos < 10% del mayor se eliminan (uñas por diferencias de escala).
function limpiarFragmentos(feat) {
  if (feat.geometry?.type !== 'MultiPolygon') return feat;
  const partes = feat.geometry.coordinates;
  if (partes.length <= 1) return feat;
  const areas = partes.map(coords => turf.area({ type: 'Feature', geometry: { type: 'Polygon', coordinates: coords } }));
  const maxArea = Math.max(...areas);
  const filtradas = partes.filter((_, i) => areas[i] >= maxArea * 0.10);
  if (filtradas.length === 0) return feat;
  if (filtradas.length === 1) return { ...feat, geometry: { type: 'Polygon', coordinates: filtradas[0] } };
  return { ...feat, geometry: { type: 'MultiPolygon', coordinates: filtradas } };
}

// ── clip ──────────────────────────────────────────────────────────

function clipFeatures(layerFeatures, maskFeature) {
  const clipped = [];

  for (const feat of layerFeatures) {
    try {
      const geomType = feat.geometry?.type;
      if (!geomType) continue;

      if (geomType === 'Point' || geomType === 'MultiPoint') {
        if (turf.booleanPointInPolygon(feat, maskFeature)) {
          clipped.push(feat);
        }

      } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
        // bboxClip recortaba por el rectángulo envolvente, no por el contorno real
        // del polígono. Reemplazado por lineSplit + booleanPointInPolygon, igual
        // que hace api/clip.js en el servidor.
        const lines = geomType === 'LineString'
          ? [feat.geometry.coordinates]
          : feat.geometry.coordinates;

        for (const coords of lines) {
          const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: feat.properties };
          try {
            const split = turf.lineSplit(line, maskFeature);
            if (!split.features?.length) {
              // 0 segmentos = no cruza el borde = puede estar completamente adentro
              const midCoord = coords[Math.floor(coords.length / 2)];
              const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: midCoord }, properties: {} };
              if (turf.booleanPointInPolygon(midPt, maskFeature)) {
                clipped.push({ ...line, properties: feat.properties });
              }
            } else {
              for (const seg of split.features) {
                const sc = seg.geometry.coordinates;
                const mid = [
                  (sc[0][0] + sc[sc.length - 1][0]) / 2,
                  (sc[0][1] + sc[sc.length - 1][1]) / 2,
                ];
                const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: {} };
                if (turf.booleanPointInPolygon(midPt, maskFeature)) {
                  clipped.push({ ...seg, properties: feat.properties });
                }
              }
            }
          } catch {
            // lineSplit falló (ej: línea no intersecta el borde) —
            // verificar si la línea completa está dentro del polígono
            const midIdx = Math.floor(coords.length / 2);
            const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: coords[midIdx] }, properties: {} };
            if (turf.booleanPointInPolygon(midPt, maskFeature)) {
              clipped.push(feat);
            }
          }
        }

      } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
        const inter = turf.intersect(feat, maskFeature);
        if (inter) {
          // Descartar si el overlap es < 5% del área original
          const areaOrig  = turf.area(feat);
          const areaInter = turf.area(inter);
          const ratio     = areaOrig > 0 ? areaInter / areaOrig : 1;
          if (ratio >= 0.05) {
            inter.properties = feat.properties;
            clipped.push(limpiarFragmentos(inter));
          }
        }
      }
    } catch { /* feature individual rota — omitir */ }
  }

  return { type: 'FeatureCollection', features: clipped };
}

// ── Dispatcher ────────────────────────────────────────────────────

// Clip inverso: excluye features que caen DENTRO de la máscara.
// Puntos: excluir los que están adentro.
// Líneas: excluir segmentos adentro, conservar los de afuera.
// Polígonos: excluir los que tienen overlap ≥ 5% con la máscara.
function clipExcludeFeatures(layerFeatures, maskFeature) {
  const result = [];

  for (const feat of layerFeatures) {
    try {
      const geomType = feat.geometry?.type;
      if (!geomType) continue;

      if (geomType === 'Point' || geomType === 'MultiPoint') {
        // Incluir solo los que NO están dentro
        if (!turf.booleanPointInPolygon(feat, maskFeature)) {
          result.push(feat);
        }

      } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
        const lines = geomType === 'LineString'
          ? [feat.geometry.coordinates]
          : feat.geometry.coordinates;

        for (const coords of lines) {
          const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: feat.properties };
          try {
            const split = turf.lineSplit(line, maskFeature);
            if (!split.features?.length) {
              // No cruza el borde — conservar solo si el punto medio está AFUERA
              const midCoord = coords[Math.floor(coords.length / 2)];
              const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: midCoord }, properties: {} };
              if (!turf.booleanPointInPolygon(midPt, maskFeature)) {
                result.push({ ...line, properties: feat.properties });
              }
            } else {
              for (const seg of split.features) {
                const sc  = seg.geometry.coordinates;
                const mid = [(sc[0][0] + sc[sc.length - 1][0]) / 2, (sc[0][1] + sc[sc.length - 1][1]) / 2];
                const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: {} };
                // Conservar segmentos AFUERA de la máscara
                if (!turf.booleanPointInPolygon(midPt, maskFeature)) {
                  result.push({ ...seg, properties: feat.properties });
                }
              }
            }
          } catch {
            const midIdx = Math.floor(coords.length / 2);
            const midPt = { type: 'Feature', geometry: { type: 'Point', coordinates: coords[midIdx] }, properties: {} };
            if (!turf.booleanPointInPolygon(midPt, maskFeature)) {
              result.push(feat);
            }
          }
        }

      } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
        // Excluir si tiene overlap ≥ 5% con la máscara
        const inter = turf.intersect(feat, maskFeature);
        if (!inter) {
          result.push(feat); // sin overlap → conservar completo
        } else {
          const areaOrig  = turf.area(feat);
          const areaInter = turf.area(inter);
          const ratio     = areaOrig > 0 ? areaInter / areaOrig : 1;
          if (ratio < 0.05) result.push(feat);
          // Si ratio ≥ 0.05 → excluir (está mayormente dentro de la máscara)
        }
      }
    } catch { /* feature rota — omitir */ }
  }

  return { type: 'FeatureCollection', features: result };
}

onmessage = function(e) {
  try {
    const { op } = e.data;

    if (op === 'union') {
      const result = unionFeatures(e.data.features);
      postMessage({ result });

    } else if (op === 'clip') {
      const result = clipFeatures(e.data.layerFeatures, e.data.maskFeature);
      postMessage({ result });

    } else if (op === 'clip_exclude') {
      const result = clipExcludeFeatures(e.data.layerFeatures, e.data.maskFeature);
      postMessage({ result });

    } else {
      postMessage({ error: `Operación desconocida: ${op}` });
    }

  } catch (err) {
    postMessage({ error: err.message });
  }
};
