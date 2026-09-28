import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useStore } from '../store/useStore.js';
import { MAP_STYLE } from '../data/constants.js';
import { SOURCES, addLayers, holesGeoJSON, cablesGeoJSON, draftGeoJSON, itemsGeoJSON, verticesGeoJSON } from './layers.js';
import { addIcons } from './icons.js';
import { MARKER_TYPES, SWITCH_COLOUR } from '../data/constants.js';
import { useMapInteractions } from './useMapInteractions.js';
import NoteTooltip from '../components/NoteTooltip.jsx';

/**
 * Owns the Mapbox instance. Draws whatever is in the store; all the clicking
 * and dragging lives in useMapInteractions so this file stays about the map.
 */
export default function MapView({ onReady }) {
  const container = useRef(null);
  const map = useRef(null);
  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [hover, setHover] = useState(null);

  const token = useStore((s) => s.token);
  const course = useStore((s) => s.course);
  const entities = useStore((s) => s.plan?.entities ?? []);
  const selectedId = useStore((s) => s.selectedId);
  const draft = useStore((s) => s.draft);
  const hole = useStore((s) => s.hole);
  const editingCableId = useStore((s) => s.editingCableId);
  const extending = useStore((s) => s.extending);

  /* ---- create once ---------------------------------------------------- */
  useEffect(() => {
    if (map.current || !course?.lngLat) return;
    mapboxgl.accessToken = token;
    const m = new mapboxgl.Map({
      container: container.current,
      style: MAP_STYLE,
      center: course.lngLat,
      zoom: 15.2,
      attributionControl: true,
    });
    m.on('load', () => {
      addIcons(m, MARKER_TYPES, SWITCH_COLOUR);   // marker shapes must exist before the layers use them
      addLayers(m);
      setReady(true);
      onReady?.(m);
    });
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, [course?.id, token, onReady]);

  /* ---- keep the sources in step with the store ------------------------ */
  useEffect(() => {
    if (!ready) return;
    map.current.getSource(SOURCES.holes).setData(holesGeoJSON(course?.holes ?? []));
  }, [ready, course?.holes]);

  useEffect(() => {
    if (!ready) return;
    map.current.getSource(SOURCES.items).setData(itemsGeoJSON(entities, selectedId));
    map.current.getSource(SOURCES.cables).setData(cablesGeoJSON(entities, selectedId));
  }, [ready, entities, selectedId]);

  useEffect(() => {
    if (!ready) return;
    // While extending, the rubber band runs from the end being carried on.
    if (extending && !draft) {
      const cable = entities.find((e) => e.id === extending.cableId);
      const anchor = cable && (extending.end === 'start' ? cable.coords[0] : cable.coords[cable.coords.length - 1]);
      map.current.getSource(SOURCES.draft).setData(
        draftGeoJSON(anchor ? { coords: [anchor] } : null, cursor)
      );
      return;
    }
    map.current.getSource(SOURCES.draft).setData(draftGeoJSON(draft, cursor));
  }, [ready, draft, cursor, extending, entities]);

  /* ---- draggable points for the cable being edited -------------------- */
  useEffect(() => {
    if (!ready) return;
    const cable = entities.find((e) => e.id === editingCableId) ?? null;
    map.current.getSource(SOURCES.vertices).setData(verticesGeoJSON(cable));
  }, [ready, editingCableId, entities]);

  /* ---- fly to the selected hole --------------------------------------- */
  useEffect(() => {
    if (!ready || !course?.holes?.length) return;
    if (hole == null) {
      map.current.flyTo({ center: course.lngLat, zoom: 15.2, duration: 500 });
      return;
    }
    const h = course.holes.find((x) => x.number === hole);
    if (!h) return;
    map.current.flyTo({ center: h.green, zoom: 17.2, duration: 500 });
  }, [ready, hole, course]);

  useMapInteractions(map, ready, setCursor, setHover);

  return (
    <>
      <div ref={container} className="map" />
      <NoteTooltip hover={hover} />
    </>
  );
}
