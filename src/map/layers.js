/**
 * Map sources and layers.
 *
 * Everything on the map is drawn from five GeoJSON sources. Nothing uses a DOM
 * marker, so a plan with 60 cameras and 40 cables still pans smoothly.
 */
import { CAMERA_COLOUR, CAMERA_TYPES, CABLE_TYPES, MARKER_TYPES, SWITCH_COLOUR } from '../data/constants.js';
import { positionId } from '../lib/cameraNumber.js';

export const SOURCES = {
  holes: 'holes', cables: 'cables', draft: 'draft', items: 'items', vertices: 'vertices',
};
const empty = { type: 'FeatureCollection', features: [] };

/* ------------------------------------------------------------ builders --- */

export const holesGeoJSON = (holes = []) => ({
  type: 'FeatureCollection',
  features: holes.flatMap((h) => [
    { type: 'Feature', properties: { part: 'line' }, geometry: { type: 'LineString', coordinates: h.line } },
    { type: 'Feature', properties: { part: 'green', n: String(h.number) }, geometry: { type: 'Point', coordinates: h.green } },
    { type: 'Feature', properties: { part: 'tee', n: String(h.number) }, geometry: { type: 'Point', coordinates: h.tee } },
  ]),
});

export const cablesGeoJSON = (entities, selectedId) => ({
  type: 'FeatureCollection',
  features: entities
    .filter((e) => e.kind === 'cable')
    .map((e) => ({
      type: 'Feature',
      properties: {
        id: e.id,
        colour: CABLE_TYPES.find((t) => t.id === e.cableType)?.colour ?? '#888',
        selected: e.id === selectedId ? 1 : 0,
        label: `${e.label} · ${Math.round(e.lengthM)} m`,
      },
      geometry: { type: 'LineString', coordinates: e.coords },
    })),
});

export const draftGeoJSON = (draft, cursor) => {
  if (!draft) return empty;
  const line = cursor ? [...draft.coords, cursor] : draft.coords;
  const features = draft.coords.map((c) => ({
    type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c },
  }));
  if (line.length >= 2) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } });
  }
  return { type: 'FeatureCollection', features };
};

/**
 * Handles for the cable being edited: one draggable point each, plus a large
 * (+) above either end for extending the run.
 */
export const verticesGeoJSON = (cable) => {
  if (!cable) return empty;
  const last = cable.coords.length - 1;
  return {
    type: 'FeatureCollection',
    features: [
      ...cable.coords.map((c, i) => ({
        type: 'Feature',
        properties: { role: 'point', index: i, pinned: cable.attach?.[i] ? 1 : 0 },
        geometry: { type: 'Point', coordinates: c },
      })),
      { type: 'Feature', properties: { role: 'plus', end: 'start' },
        geometry: { type: 'Point', coordinates: cable.coords[0] } },
      { type: 'Feature', properties: { role: 'plus', end: 'end' },
        geometry: { type: 'Point', coordinates: cable.coords[last] } },
    ],
  };
};

export const itemsGeoJSON = (entities, selectedId) => ({
  type: 'FeatureCollection',
  features: entities
    .filter((e) => e.kind !== 'cable')
    .map((e) => ({
      type: 'Feature',
      properties: {
        id: e.id,
        kind: e.kind,
        selected: e.id === selectedId ? 1 : 0,
        hasNotes: e.notes?.trim() ? 1 : 0,
        // Cameras are a numbered dot with a type letter; everything else is an icon.
        number: e.kind === 'camera' ? String(e.number ?? '?') : '',
        // The rig position sits under the dot — h01-g03 is how the crew names it.
        posId: e.kind === 'camera' ? (positionId(e.hole, e.position) ?? '') : '',
        badge: e.kind === 'camera'
          ? CAMERA_TYPES.find((t) => t.id === e.camType)?.badge ?? 'T'
          : '',
        icon: e.kind === 'switch' ? 'node-switch'
            : e.kind === 'marker' ? `marker-${e.markerType}`
            : '',
      },
      geometry: { type: 'Point', coordinates: e.coords },
    })),
});

/* -------------------------------------------------------------- layers --- */

/** Called once, on map load. Order matters: holes, cables, then items on top. */
export function addLayers(map) {
  for (const id of Object.values(SOURCES)) {
    map.addSource(id, { type: 'geojson', data: empty });
  }

  /* --- course ---------------------------------------------------------- */
  map.addLayer({
    id: 'hole-line', type: 'line', source: SOURCES.holes,
    filter: ['==', ['get', 'part'], 'line'],
    paint: { 'line-color': '#FFFFFF', 'line-opacity': 0.35, 'line-width': 1.5, 'line-dasharray': [3, 2] },
  });
  map.addLayer({
    id: 'hole-point', type: 'circle', source: SOURCES.holes,
    filter: ['in', ['get', 'part'], ['literal', ['tee', 'green']]],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'part'], 'green'], 6, 4],
      'circle-color': ['case', ['==', ['get', 'part'], 'green'], '#FFFFFF', '#0B1017'],
      'circle-stroke-width': 1.5, 'circle-stroke-color': '#FFFFFF', 'circle-opacity': 0.85,
    },
  });
  map.addLayer({
    id: 'hole-number', type: 'symbol', source: SOURCES.holes,
    filter: ['==', ['get', 'part'], 'green'],
    layout: { 'text-field': ['get', 'n'], 'text-size': 13, 'text-offset': [0, -1.4], 'text-allow-overlap': true },
    paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#000000', 'text-halo-width': 1.6 },
  });

  /* --- cables ---------------------------------------------------------- */
  map.addLayer({
    id: 'cable-casing', type: 'line', source: SOURCES.cables,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#000000', 'line-opacity': 0.5, 'line-width': 7 },
  });
  map.addLayer({
    id: 'cable-line', type: 'line', source: SOURCES.cables,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'colour'],
      'line-width': ['case', ['==', ['get', 'selected'], 1], 6, 3.5],
    },
  });
  map.addLayer({
    id: 'cable-hit', type: 'line', source: SOURCES.cables,
    paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 22 },
  });
  map.addLayer({
    id: 'cable-label', type: 'symbol', source: SOURCES.cables,
    layout: { 'text-field': ['get', 'label'], 'symbol-placement': 'line-center', 'text-size': 11 },
    paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#000000', 'text-halo-width': 1.8 },
  });

  map.addLayer({
    id: 'draft-line', type: 'line', source: SOURCES.draft,
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#42C6FF', 'line-width': 3, 'line-dasharray': [1.5, 1.2] },
  });
  map.addLayer({
    id: 'draft-vertex', type: 'circle', source: SOURCES.draft,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 4.5, 'circle-color': '#42C6FF', 'circle-stroke-width': 2, 'circle-stroke-color': '#06212B' },
  });

  /* --- items ----------------------------------------------------------- */
  map.addLayer({          // oversized invisible hit target
    id: 'item-hit', type: 'circle', source: SOURCES.items,
    paint: { 'circle-radius': 20, 'circle-color': '#000', 'circle-opacity': 0 },
  });
  map.addLayer({
    id: 'item-selected', type: 'circle', source: SOURCES.items,
    filter: ['==', ['get', 'selected'], 1],
    paint: { 'circle-radius': 19, 'circle-color': '#42C6FF', 'circle-opacity': 0.25,
             'circle-stroke-width': 2, 'circle-stroke-color': '#42C6FF' },
  });
  map.addLayer({          // cameras: one colour, the badge says what it is
    id: 'item-dot', type: 'circle', source: SOURCES.items,
    filter: ['==', ['get', 'kind'], 'camera'],
    paint: {
      'circle-radius': 12, 'circle-color': CAMERA_COLOUR,
      'circle-stroke-width': 2, 'circle-stroke-color': '#0B1017',
    },
  });
  map.addLayer({
    id: 'item-number', type: 'symbol', source: SOURCES.items,
    filter: ['==', ['get', 'kind'], 'camera'],
    layout: {
      'text-field': ['get', 'number'], 'text-size': 12,
      'text-allow-overlap': true, 'text-ignore-placement': true,
    },
    paint: { 'text-color': '#0B1017', 'text-halo-color': '#FFFFFF', 'text-halo-width': 0.8 },
  });
  map.addLayer({          // switches and markers: real drawn shapes
    id: 'item-icon', type: 'symbol', source: SOURCES.items,
    filter: ['in', ['get', 'kind'], ['literal', ['switch', 'marker']]],
    layout: {
      'icon-image': ['get', 'icon'], 'icon-size': 0.8,
      'icon-allow-overlap': true, 'icon-ignore-placement': true,
    },
  });
  map.addLayer({          // rig position, under the dot: h01-g03
    id: 'item-position', type: 'symbol', source: SOURCES.items,
    filter: ['all', ['==', ['get', 'kind'], 'camera'], ['!=', ['get', 'posId'], '']],
    layout: {
      'text-field': ['get', 'posId'], 'text-size': 10.5, 'text-offset': [0, 1.6],
      'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true,
    },
    paint: { 'text-color': '#DEE7F0', 'text-halo-color': '#000000', 'text-halo-width': 1.8 },
  });
  map.addLayer({          // camera type: M mast, L LED, ▲ tower, H hospitality
    id: 'item-badge', type: 'symbol', source: SOURCES.items,
    filter: ['==', ['get', 'kind'], 'camera'],
    layout: {
      'text-field': ['get', 'badge'], 'text-size': 11, 'text-offset': [1.4, -1.0],
      'text-allow-overlap': true, 'text-ignore-placement': true,
    },
    paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#000000', 'text-halo-width': 1.8 },
  });
  map.addLayer({          // notes badge, below the type so the type reads first
    id: 'item-note', type: 'symbol', source: SOURCES.items,
    filter: ['==', ['get', 'hasNotes'], 1],
    layout: {
      'text-field': '✎', 'text-size': 12,
      'text-offset': ['case', ['==', ['get', 'kind'], 'camera'],
                      ['literal', [1.4, 0.5]], ['literal', [1.4, -1.0]]],
      'text-allow-overlap': true, 'text-ignore-placement': true,
    },
    paint: { 'text-color': '#FFD166', 'text-halo-color': '#000000', 'text-halo-width': 1.6 },
  });

  /* --- cable point handles (only while editing a run) ------------------- */
  map.addLayer({
    id: 'vertex-hit', type: 'circle', source: SOURCES.vertices,
    filter: ['==', ['get', 'role'], 'point'],
    paint: { 'circle-radius': 16, 'circle-color': '#000', 'circle-opacity': 0 },
  });
  map.addLayer({
    id: 'vertex-dot', type: 'circle', source: SOURCES.vertices,
    filter: ['==', ['get', 'role'], 'point'],
    paint: {
      'circle-radius': 6,
      // A pinned point is filled; a free one is hollow.
      'circle-color': ['case', ['==', ['get', 'pinned'], 1], '#42C6FF', '#0B1017'],
      'circle-stroke-width': 2.5, 'circle-stroke-color': '#42C6FF',
    },
  });
  map.addLayer({          // (+) above each end — click to carry the run on
    id: 'vertex-plus', type: 'symbol', source: SOURCES.vertices,
    filter: ['==', ['get', 'role'], 'plus'],
    layout: {
      'icon-image': 'cable-plus', 'icon-size': 0.85, 'icon-offset': [0, -42],
      'icon-allow-overlap': true, 'icon-ignore-placement': true,
    },
  });
}
