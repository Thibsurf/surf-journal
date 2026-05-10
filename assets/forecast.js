async function loadSpotForecast(selectedSpot) {

  const locationId = SPOT_STATIONS[selectedSpot];

  if (!locationId) {
    console.warn("Spot inconnu:", selectedSpot);
    return;
  }

  const { data, error } = await supabase
    .from("meteo_data")
    .select("*")
    .eq("location_id", locationId)
    .single();

  if (error) {
    console.error(error);
    return;
  }

  return data;
}
