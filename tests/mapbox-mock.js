/* Test double for mapbox-gl. Enough surface to drive the app headlessly.
   Linear projection at ~0.9 m/px so pixel snapping behaves realistically. */
const MPP = 0.91, MDEG_LAT = 110574, MDEG_LON = 98300;

class LngLat {
  constructor(lng, lat) { this.lng = lng; this.lat = lat; }
}

class Source {
  constructor(opts = {}) {
    this.opts = opts;
    this.type = opts.type || 'geojson';
    this.data = { type: 'FeatureCollection', features: [] };
    // Image sources carry a url and four corners instead of features.
    this.url = opts.url ?? null;
    this.coordinates = opts.coordinates ?? null;
    this.updates = 0;
  }
  setData(d) { this.data = d; }
  updateImage({ url, coordinates }) {
    if (url != null) this.url = url;
    if (coordinates != null) this.coordinates = coordinates;
    this.updates++;
  }
}

class Map {
  constructor(opts) {
    this.opts = opts;
    this.handlers = {};
    this.sources = {};
    this.layers = {};
    this.centre = opts.center;
    this.calls = { flyTo: [], panBy: [] };
    this.canvas = document.createElement('canvas');
    this.container = document.createElement('div');
    this.container.appendChild(this.canvas);
    (typeof opts.container === 'string' ? document.getElementById(opts.container) : opts.container)
      .appendChild(this.container);
    setTimeout(() => this.emit('load', {}), 0);
    window.__map = this;
  }
  key(type, layer) { return layer ? `${type}|${layer}` : type; }
  on(type, a, b) { const l = b ? a : null, f = b || a; (this.handlers[this.key(type, l)] ||= []).push(f); return this; }
  once(type, a, b) {
    const l = b ? a : null, f = b || a;
    const wrap = (e) => { this.off(type, l, wrap); f(e); };
    return l ? this.on(type, l, wrap) : this.on(type, wrap);
  }
  off(type, a, b) {
    const l = b ? a : null, f = b || a, k = this.key(type, l);
    this.handlers[k] = (this.handlers[k] || []).filter((x) => x !== f);
    return this;
  }
  emit(type, ev, layer) { for (const f of [...(this.handlers[this.key(type, layer || null)] || [])]) f(ev); }

  addSource(id, opts) { this.sources[id] = new Source(opts); }
  removeSource(id) { delete this.sources[id]; }
  addImage(id, img, opts) { (this.images ||= {})[id] = { img, opts }; }
  hasImage(id) { return !!(this.images && this.images[id]); }
  listImages() { return Object.keys(this.images || {}); }
  getSource(id) { return this.sources[id]; }
  addLayer(l, before) { this.layers[l.id] = { ...l, before: before ?? null }; }
  getLayer(id) { return this.layers[id]; }
  removeLayer(id) { delete this.layers[id]; }
  getStyle() { return { layers: Object.values(this.layers), sources: this.sources }; }
  setLayoutProperty() {} setPaintProperty() {} setTerrain() {} setFog() {}
  getCanvas() { return this.canvas; }
  getCanvasContainer() { return this.container; }
  getZoom() { return 17; }
  getCenter() { return new LngLat(this.centre[0], this.centre[1]); }

  project(ll) {
    const [lng, lat] = Array.isArray(ll) ? ll : [ll.lng, ll.lat];
    return { x: (lng - this.centre[0]) * MDEG_LON / MPP + window.innerWidth / 2,
             y: -(lat - this.centre[1]) * MDEG_LAT / MPP + window.innerHeight / 2 };
  }
  unproject(pt) {
    const [x, y] = Array.isArray(pt) ? pt : [pt.x, pt.y];
    return new LngLat(this.centre[0] + (x - window.innerWidth / 2) * MPP / MDEG_LON,
                      this.centre[1] - (y - window.innerHeight / 2) * MPP / MDEG_LAT);
  }
  queryRenderedFeatures(pt, o) {
    const layers = (o && o.layers) || [];
    const out = [];
    const hit = (srcName, radius, keep = () => true, offset = [0, 0]) => {
      const src = this.sources[srcName];
      if (!src) return;
      for (const f of src.data.features) {
        if (f.geometry.type !== 'Point' || !keep(f)) continue;
        const p = this.project(f.geometry.coordinates);
        if (Math.hypot(p.x + offset[0] - pt.x, p.y + offset[1] - pt.y) <= radius) out.push(f);
      }
    };
    if (layers.includes('vertex-hit')) hit('vertices', 16, (f) => f.properties.role === 'point');
    // The (+) symbols render 42 px above their point, so hit-test them there.
    if (layers.includes('vertex-plus')) hit('vertices', 20, (f) => f.properties.role === 'plus', [0, -42]);
    if (layers.includes('item-hit')) hit('items', 20);
    if (layers.includes('cable-hit')) {
      const src = this.sources.cables;
      for (const f of src?.data.features ?? []) {
        for (let i = 1; i < f.geometry.coordinates.length; i++) {
          const a = this.project(f.geometry.coordinates[i - 1]);
          const b = this.project(f.geometry.coordinates[i]);
          const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
          const t = len2 ? Math.max(0, Math.min(1, ((pt.x - a.x) * vx + (pt.y - a.y) * vy) / len2)) : 0;
          if (Math.hypot(pt.x - (a.x + t * vx), pt.y - (a.y + t * vy)) <= 22) { out.push(f); break; }
        }
      }
    }
    return out;
  }
  flyTo(o) { this.calls.flyTo.push(o); if (o.center) this.centre = Array.isArray(o.center) ? o.center : [o.center.lng, o.center.lat]; }
  easeTo(o) { this.flyTo(o); }
  panBy(offset) { this.calls.panBy.push(offset); }
  remove() {}

  /* --- test driver: fire an event at a screen point or lng/lat --- */
  fire(type, where, layer) {
    const isLngLat = where && where.lng !== undefined;
    const lngLat = isLngLat ? where : this.unproject(where);
    const point = isLngLat ? this.project(where) : where;
    const ev = { lngLat, point, points: [point], preventDefault() { ev.defaultPrevented = true; } };
    if (layer) { ev.features = this.queryRenderedFeatures(point, { layers: [layer] }); this.emit(type, ev, layer); }
    else this.emit(type, ev);
    return ev;
  }
}

export default { Map, LngLat, accessToken: null, supported: () => true };
export { Map, LngLat };
