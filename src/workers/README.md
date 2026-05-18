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

### Archivos

| Worker | Operaciones Turf usadas |
|--------|------------------------|
| `clip-worker.js` | union, lineSplit, booleanPointInPolygon, intersect, area |
| `intersect-worker.js` | booleanPointInPolygon, intersect |
| `buffer-worker.js` | booleanPointInPolygon, intersect |
| `classify-worker.js` | ninguna (no usa Turf) |
