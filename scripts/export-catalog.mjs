/**
 * scripts/export-catalog.mjs
 *
 * Exporta el catálogo completo de capas como JSON a stdout.
 * Usado por generate-snapshots.js para leer las capas sin
 * depender de la sintaxis de browser (window.LAYERS).
 *
 * Uso interno — no correr directamente.
 * El script generate-snapshots.js lo invoca con child_process.
 */

import { AR_LAYERS } from '../layers/ar/index.js';
import { UY_LAYERS } from '../layers/uy/index.js';
import { CL_LAYERS } from '../layers/cl/index.js';

const ALL = { ...AR_LAYERS, ...UY_LAYERS, ...CL_LAYERS };

// Emitir solo los campos que necesita el script de snapshots
const catalog = {};
for (const [key, def] of Object.entries(ALL)) {
  if (!def || typeof def !== 'object') continue;
  if (!def.typename) continue;
  if (!def.source) continue;
  catalog[key] = {
    typename:     def.typename,
    source:       def.source,
    geomType:     def.geomType || 'polygon',
    featureCount: def.featureCount ?? null,
    visible:      def.visible !== false,
    filterField:  def.filterField || null,
    filterValues: def.filterValues || null,
  };
}

process.stdout.write(JSON.stringify(catalog));
