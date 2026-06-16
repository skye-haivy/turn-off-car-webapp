# TURN-OFF Car Navigation Web App

Static phone-first web app for sending car navigation updates to an ESP32 over WebSocket or Web Bluetooth.

## Run

Open `index.html` in a browser, serve this folder with any static file server, or use the hosted GitHub Pages version.

GitHub Pages uses HTTPS. For live ESP32 testing from the hosted page, use `Connect Bluetooth`. Plain `ws://` WebSocket is still available under `Local WebSocket testing` for local HTTP testing.

The app stores these values in `localStorage`:

- ESP32 IP address
- OpenRouteService API key

## ESP32 Protocol

The app sends the same JSON over either transport:

- WebSocket: `ws://<ESP32_IP>:81`
- Web Bluetooth: device name `TURN-OFF-CAR`

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

The route request uses `[lon, lat]` coordinate order, sends `Accept: application/geo+json`, allows route-point snapping with `radiuses: [-1, -1]`, and refreshes every 25 seconds during navigation.
