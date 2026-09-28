/**
 * Mapbox geocoding — used to place a course from its name, so nobody has to
 * type coordinates. Uses the same token as the map.
 */
export async function geocode(searchText, token) {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchText)}.json` +
    `?access_token=${token}&limit=5&types=poi,address,place`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed (HTTP ${res.status})`);
  const json = await res.json();

  return (json.features || []).map((f) => ({
    name: f.text,
    full: f.place_name,
    lngLat: f.center,
  }));
}
