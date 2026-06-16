# TURN-OFF Car Navigation Web App

Static phone-first web app for sending car navigation updates to an ESP32 over WebSocket.

## Run

Open `index.html` in a browser, or serve this folder with any static file server.

The app stores these values in `localStorage`:

- ESP32 IP address
- OpenRouteService API key

## ESP32 Protocol

The app sends JSON to `ws://<ESP32_IP>:81`:

```json
{
  "direction": "LEFT",
  "distance": "250m",
  "road": "NAVIGATING"
}
```

Supported directions:

- `LEFT`
- `RIGHT`
- `STRAIGHT`
- `UTURN`
- `ROUNDABOUT`
- `ARRIVED`

## Routing

Destination search uses Nominatim. Route generation uses OpenRouteService:

```text
https://api.openrouteservice.org/v2/directions/driving-car/geojson
```

The route request uses `[lon, lat]` coordinate order and refreshes every 25 seconds during navigation.
