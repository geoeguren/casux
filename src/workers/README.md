# src/workers — Web Workers

## Turf.js local

Los workers usan Turf.js (`turf.min.js`) desde esta misma carpeta en lugar
de descargarlo desde unpkg en runtime. Esto evita dependencia de un CDN
externo para lógica crítica de fallback.

**Antes del primer deploy, y cada vez que se actualice la versión de Turf:**

```bash
curl -L "https://unpkg.com/@turf/turf@6.5.0/turf.min.js" -o src/workers/turf.min.js
```

O descargar manualmente desde:
https://unpkg.com/@turf/turf@6.5.0/turf.min.js

Guardar como `src/workers/turf.min.js`.

### Por qué versión fija (6.5.0)

- El código de los workers usa la API de Turf 6.x (no 7.x que cambió algunos nombres)
- Al actualizar Turf, verificar que `lineSplit`, `union`, `intersect`,
  `booleanPointInPolygon`, `area` y `buffer` sigan funcionando igual

---

## Cadena de fallback por operación

Cada operación sigue la misma cadena de decisión, de más eficiente a más costosa:

```
1. ¿La capa es pequeña (≤500 features) o la fuente es ArcGIS?
   → Procesamiento directo en el cliente (sin Worker, sin Edge Function)

2. ¿La capa es grande (>500 features) y la fuente es WFS?
   → Edge Function (Vercel Serverless) con timeout de 90s
   → Si falla: Worker (este directorio) con timeout de 30–60s
   → Si falla: error explícito al usuario

3. ¿El WFS externo está caído?
   → Snapshot en Cloudflare R2 (generado por GitHub Actions diariamente)
   → Si el snapshot no existe: caché IndexedDB vencida (safety net)
   → Si no hay nada: error explícito
```

Las operaciones nuevas (within_layer, dissolve, adjacent, nearest) siempre van a
Edge Function primero, independientemente del featureCount, porque su lógica
es más compleja y necesita el servidor para el fetch de la máscara.

Las variantes `_exclude` (clip_exclude, intersect_exclude) siempre se procesan
en el cliente porque necesitan todos los features sin bbox, lo que hace que el
Edge Function sea menos ventajoso.

---

## Workers

| Worker | Operaciones | Turf usadas |
|--------|-------------|-------------|
| `clip-worker.js` | clip, clip_exclude | union, lineSplit, booleanPointInPolygon, intersect, area |
| `intersect-worker.js` | intersect, intersect_exclude | booleanPointInPolygon, intersect |
| `dissolve-worker.js` | dissolve, dissolve_exclude | union, booleanPointInPolygon |
| `within_layer-worker.js` | within_layer, within_layer_exclude | booleanPointInPolygon, distance, centroid, buffer |
| `adjacent-worker.js` | adjacent, adjacent_exclude | booleanTouches, intersect, booleanPointInPolygon |
| `nearest-worker.js` | nearest, nearest_exclude | distance, centroid |
| `classify-worker.js` | clasificación de features por campo | ninguna (no usa Turf) |

> `buffer-worker.js` fue eliminado — `within_layer-worker.js` lo reemplaza con la misma
> funcionalidad (genera un buffer alrededor del área de referencia y filtra por distancia).
