const ROUTE_ENDPOINT = "https://api.openrouteservice.org/v2/directions/driving-car/geojson";
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const ROUTE_REFRESH_MS = 25000;
const ARRIVAL_DISTANCE_M = 35;
const DEFAULT_ESP32_IP = "10.42.177.234";
const BLE_SERVICE_UUID = "6f9d0001-7f8a-4a9f-bdd6-4f9ec75d0001";
const BLE_RX_CHARACTERISTIC_UUID = "6f9d0002-7f8a-4a9f-bdd6-4f9ec75d0001";

const elements = {
  apiKey: document.querySelector("#apiKey"),
  bleConnectButton: document.querySelector("#bleConnectButton"),
  connectButton: document.querySelector("#connectButton"),
  connectionStatus: document.querySelector("#connectionStatus"),
  destinationQuery: document.querySelector("#destinationQuery"),
  destinationStatus: document.querySelector("#destinationStatus"),
  disconnectButton: document.querySelector("#disconnectButton"),
  distanceStatus: document.querySelector("#distanceStatus"),
  espIp: document.querySelector("#espIp"),
  eventLog: document.querySelector("#eventLog"),
  gpsStatus: document.querySelector("#gpsStatus"),
  nextInstruction: document.querySelector("#nextInstruction"),
  searchButton: document.querySelector("#searchButton"),
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  suggestions: document.querySelector("#suggestions"),
  transportStatus: document.querySelector("#transportStatus"),
  httpsNotice: document.querySelector("#httpsNotice"),
};

const state = {
  bleCharacteristic: null,
  bleDevice: null,
  connectionTimer: null,
  connectionTimedOut: false,
  currentLocation: null,
  destination: null,
  lastMessage: "",
  lastRouteUpdate: 0,
  navigating: false,
  routeFeature: null,
  routeRefreshTimer: null,
  watchId: null,
  ws: null,
};

loadSettings();
wireEvents();
showHostingNotice();
updateControls();
startGpsWatch();
logEvent("Ready. Enter API key, connect Bluetooth, and search a driving destination.");

function wireEvents() {
  elements.connectButton.addEventListener("click", connectWebSocket);
  elements.bleConnectButton.addEventListener("click", connectBluetooth);
  elements.disconnectButton.addEventListener("click", disconnectWebSocket);
  elements.searchButton.addEventListener("click", searchDestination);
  elements.destinationQuery.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchDestination();
    }
  });
  elements.startButton.addEventListener("click", startNavigation);
  elements.stopButton.addEventListener("click", stopNavigation);
  elements.espIp.addEventListener("change", saveSettings);
  elements.apiKey.addEventListener("change", saveSettings);

  document.querySelectorAll("[data-test-direction]").forEach((button) => {
    button.addEventListener("click", () => {
      const direction = button.dataset.testDirection;
      const distance = direction === "ARRIVED" ? "0m" : "120m";
      const road = direction === "ARRIVED" ? "ARRIVED" : "TEST";
      sendNavigationUpdate({ direction, distance, road }, true);
    });
  });
}

function loadSettings() {
  elements.espIp.value = localStorage.getItem("turnoff.espIp") || DEFAULT_ESP32_IP;
  elements.apiKey.value = localStorage.getItem("turnoff.apiKey") || "";
}

function showHostingNotice() {
  if (elements.httpsNotice && location.protocol === "https:") {
    elements.httpsNotice.hidden = false;
    logEvent("Hosted page loaded. Use Bluetooth for ESP32 connection.");
  }
}

function saveSettings() {
  localStorage.setItem("turnoff.espIp", elements.espIp.value.trim());
  localStorage.setItem("turnoff.apiKey", elements.apiKey.value.trim());
}

function connectWebSocket() {
  const espIp = elements.espIp.value.trim();
  if (!espIp) {
    setConnectionState("error", "ERROR");
    logEvent("ESP32 IP is required.");
    return;
  }

  saveSettings();
  disconnectWebSocket(false);
  setConnectionState("connecting", "CONNECTING");

  try {
    state.connectionTimedOut = false;
    state.ws = new WebSocket(`ws://${espIp}:81`);
  } catch (error) {
    setConnectionState("error", "ERROR");
    logEvent(`WebSocket setup failed: ${error.message}`);
    updateControls();
    return;
  }

  state.ws.addEventListener("open", () => {
    clearTimeout(state.connectionTimer);
    state.connectionTimer = null;
    setConnectionState("connected", "CONNECTED");
    logEvent(`Connected to ESP32 at ${espIp}:81.`);
    updateControls();
  });

  state.ws.addEventListener("close", () => {
    clearTimeout(state.connectionTimer);
    state.connectionTimer = null;
    if (state.connectionTimedOut) {
      setConnectionState("error", "ERROR");
      logEvent("WebSocket connection timed out.");
      updateControls();
      return;
    }
    setConnectionState("disconnected", "DISCONNECTED");
    logEvent("WebSocket disconnected.");
    updateControls();
  });

  state.ws.addEventListener("error", () => {
    clearTimeout(state.connectionTimer);
    state.connectionTimer = null;
    setConnectionState("error", "ERROR");
    logEvent("WebSocket error. Check ESP32 IP, Wi-Fi, and port 81.");
    updateControls();
  });

  state.connectionTimer = setTimeout(() => {
    if (state.ws && state.ws.readyState === WebSocket.CONNECTING) {
      state.connectionTimedOut = true;
      state.ws.close();
      setConnectionState("error", "ERROR");
      updateControls();
    }
  }, 5000);

  updateControls();
}

async function connectBluetooth() {
  if (!navigator.bluetooth) {
    setConnectionState("error", "ERROR");
    logEvent("Web Bluetooth is not available in this browser. Use Android Chrome or local WebSocket.");
    updateControls();
    return;
  }

  try {
    setConnectionState("connecting", "CONNECTING");
    logEvent("Select TURN-OFF-CAR from the Bluetooth chooser.");

    state.bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "TURN-OFF" }],
      optionalServices: [BLE_SERVICE_UUID],
    });

    state.bleDevice.addEventListener("gattserverdisconnected", () => {
      state.bleCharacteristic = null;
      setConnectionState("disconnected", "DISCONNECTED");
      updateControls();
      logEvent("Bluetooth disconnected.");
    });

    const server = await state.bleDevice.gatt.connect();
    const service = await server.getPrimaryService(BLE_SERVICE_UUID);
    state.bleCharacteristic = await service.getCharacteristic(BLE_RX_CHARACTERISTIC_UUID);
    setConnectionState("connected", "CONNECTED");
    logEvent(`Bluetooth connected to ${state.bleDevice.name || "ESP32"}.`);
    updateControls();
  } catch (error) {
    state.bleCharacteristic = null;
    setConnectionState("error", "ERROR");
    logEvent(`Bluetooth connection failed: ${error.message}`);
    updateControls();
  }
}

function disconnectWebSocket(log = true) {
  clearTimeout(state.connectionTimer);
  state.connectionTimer = null;
  state.connectionTimedOut = false;
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  if (state.bleDevice?.gatt?.connected) {
    state.bleDevice.gatt.disconnect();
  }
  state.bleCharacteristic = null;
  setConnectionState("disconnected", "DISCONNECTED");
  if (log) {
    logEvent("Disconnected from ESP32.");
  }
  updateControls();
}

function setConnectionState(stateName, label) {
  elements.connectionStatus.dataset.state = stateName;
  elements.connectionStatus.textContent = label;
  updateTransportStatus();
}

function startGpsWatch() {
  if (!("geolocation" in navigator)) {
    elements.gpsStatus.textContent = "Unavailable";
    logEvent("Geolocation is not supported by this browser.");
    updateControls();
    return;
  }

  state.watchId = navigator.geolocation.watchPosition(
    (position) => {
      state.currentLocation = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      elements.gpsStatus.textContent = `${state.currentLocation.lat.toFixed(5)}, ${state.currentLocation.lon.toFixed(5)}`;

      if (state.navigating) {
        maybeRefreshRoute();
        sendCurrentInstruction();
      }
      updateControls();
    },
    (error) => {
      elements.gpsStatus.textContent = "Denied or unavailable";
      logEvent(`GPS error: ${error.message}`);
      updateControls();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    }
  );
}

async function searchDestination() {
  const query = elements.destinationQuery.value.trim();
  if (!query) {
    logEvent("Enter a destination to search.");
    return;
  }

  elements.suggestions.innerHTML = "";
  elements.searchButton.disabled = true;
  logEvent(`Searching for "${query}"...`);

  try {
    const params = new URLSearchParams({
      format: "json",
      limit: "5",
      q: query,
    });
    const response = await fetch(`${NOMINATIM_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Nominatim returned ${response.status}`);
    }

    const places = await response.json();
    renderSuggestions(places.slice(0, 5));
    logEvent(`Found ${places.length} destination result(s).`);
  } catch (error) {
    logEvent(`Destination search failed: ${error.message}`);
  } finally {
    elements.searchButton.disabled = false;
    updateControls();
  }
}

function renderSuggestions(places) {
  elements.suggestions.innerHTML = "";

  if (places.length === 0) {
    elements.suggestions.textContent = "No suggestions found.";
    return;
  }

  places.forEach((place) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion";
    button.innerHTML = `<strong>${escapeHtml(place.name || place.display_name)}</strong><small>${escapeHtml(place.display_name)}</small>`;
    button.addEventListener("click", () => selectDestination(place));
    elements.suggestions.appendChild(button);
  });
}

function selectDestination(place) {
  state.destination = {
    lat: Number(place.lat),
    lon: Number(place.lon),
    label: place.display_name,
  };
  state.routeFeature = null;
  state.lastRouteUpdate = 0;
  elements.destinationStatus.textContent = state.destination.label;
  elements.suggestions.innerHTML = "";
  logEvent(`Selected destination: ${state.destination.label}`);
  updateControls();
}

async function startNavigation() {
  if (!elements.apiKey.value.trim()) {
    logEvent("OpenRouteService API key is required.");
    return;
  }
  if (!state.currentLocation) {
    logEvent("GPS location is required before navigation can start.");
    return;
  }
  if (!state.destination) {
    logEvent("Select a destination before starting navigation.");
    return;
  }

  saveSettings();
  state.navigating = true;
  state.lastMessage = "";
  logEvent("Starting driving navigation.");

  await refreshRoute();
  clearInterval(state.routeRefreshTimer);
  state.routeRefreshTimer = setInterval(refreshRoute, ROUTE_REFRESH_MS);
  updateControls();
}

function stopNavigation() {
  state.navigating = false;
  clearInterval(state.routeRefreshTimer);
  state.routeRefreshTimer = null;
  state.routeFeature = null;
  state.lastMessage = "";
  elements.nextInstruction.textContent = "None";
  elements.distanceStatus.textContent = "--";
  logEvent("Navigation stopped.");
  updateControls();
}

async function maybeRefreshRoute() {
  const now = Date.now();
  if (now - state.lastRouteUpdate > ROUTE_REFRESH_MS) {
    await refreshRoute();
  }
}

async function refreshRoute() {
  if (!state.currentLocation || !state.destination) {
    return;
  }

  const apiKey = elements.apiKey.value.trim();
  if (!apiKey) {
    logEvent("OpenRouteService API key is missing.");
    return;
  }

  try {
    const body = {
      coordinates: [
        [state.currentLocation.lon, state.currentLocation.lat],
        [state.destination.lon, state.destination.lat],
      ],
      instructions: true,
      instructions_format: "text",
    };

    const response = await fetch(ROUTE_ENDPOINT, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Authorization": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`OpenRouteService returned ${response.status}`);
    }

    const route = await response.json();
    state.routeFeature = route.features?.[0] || null;
    state.lastRouteUpdate = Date.now();

    if (!state.routeFeature) {
      throw new Error("No route feature returned");
    }

    logEvent("Driving route refreshed.");
    sendCurrentInstruction();
  } catch (error) {
    logEvent(`Route generation failed: ${error.message}`);
  }
}

function sendCurrentInstruction() {
  if (!state.routeFeature || !state.currentLocation) {
    return;
  }

  const summary = state.routeFeature.properties?.summary;
  if (summary?.distance != null && summary.distance <= ARRIVAL_DISTANCE_M) {
    sendNavigationUpdate({ direction: "ARRIVED", distance: "0m", road: "ARRIVED" });
    return;
  }

  const step = getCurrentStep(state.routeFeature);
  if (!step) {
    return;
  }

  const direction = parseDirection(step.instruction || "");
  const distance = formatDistance(step.distance || 0);
  const road = normalizeRoadName(step.name) || "NAVIGATING";

  elements.nextInstruction.textContent = direction;
  elements.distanceStatus.textContent = distance;
  sendNavigationUpdate({ direction, distance, road });
}

function getCurrentStep(routeFeature) {
  const segments = routeFeature.properties?.segments || [];
  const steps = segments.flatMap((segment) => segment.steps || []);
  if (steps.length === 0) {
    return null;
  }

  const closestIndex = getClosestCoordinateIndex(routeFeature.geometry?.coordinates || []);
  const nextStep = steps.find((step) => {
    const waypoint = step.way_points || [];
    return waypoint.length === 2 && closestIndex <= waypoint[1];
  });

  return nextStep || steps[steps.length - 1];
}

function getClosestCoordinateIndex(coordinates) {
  if (!state.currentLocation || coordinates.length === 0) {
    return 0;
  }

  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  coordinates.forEach(([lon, lat], index) => {
    const distance = haversineMeters(
      state.currentLocation.lat,
      state.currentLocation.lon,
      lat,
      lon
    );

    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  return closestIndex;
}

function parseDirection(instruction) {
  const text = instruction.toLowerCase();
  if (text.includes("roundabout")) {
    return "ROUNDABOUT";
  }
  if (text.includes("u-turn") || text.includes("uturn") || text.includes("make a u")) {
    return "UTURN";
  }
  if (text.includes("left")) {
    return "LEFT";
  }
  if (text.includes("right")) {
    return "RIGHT";
  }
  if (text.includes("arrive") || text.includes("destination")) {
    return "ARRIVED";
  }
  return "STRAIGHT";
}

function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.max(0, Math.round(meters))}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

function normalizeRoadName(name) {
  return typeof name === "string" ? name.trim() : "";
}

async function sendNavigationUpdate(message, force = false) {
  const payload = JSON.stringify(message);
  elements.nextInstruction.textContent = message.direction;
  elements.distanceStatus.textContent = message.distance;

  if (!force && payload === state.lastMessage) {
    return;
  }

  if (state.bleCharacteristic) {
    try {
      await state.bleCharacteristic.writeValue(new TextEncoder().encode(payload));
      state.lastMessage = payload;
      logEvent(`Sent BLE ${payload}`);
      return;
    } catch (error) {
      logEvent(`Bluetooth send failed: ${error.message}`);
      state.bleCharacteristic = null;
      updateControls();
    }
  }

  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    logEvent(`Not connected. Pending payload: ${payload}`);
    state.lastMessage = payload;
    return;
  }

  state.ws.send(payload);
  state.lastMessage = payload;
  logEvent(`Sent ${payload}`);
}

function updateControls() {
  const connected = isTransportConnected();
  elements.disconnectButton.disabled = !state.ws && !state.bleCharacteristic;
  elements.startButton.disabled = state.navigating || !state.currentLocation || !state.destination;
  elements.stopButton.disabled = !state.navigating;
  elements.bleConnectButton.disabled = !navigator.bluetooth;

  document.querySelectorAll("[data-test-direction]").forEach((button) => {
    button.disabled = !connected;
  });

  updateTransportStatus();
}

function isTransportConnected() {
  return state.ws?.readyState === WebSocket.OPEN || Boolean(state.bleCharacteristic);
}

function updateTransportStatus() {
  const transports = [];
  if (state.ws?.readyState === WebSocket.OPEN) {
    transports.push("WebSocket");
  }
  if (state.bleCharacteristic) {
    transports.push("Bluetooth");
  }
  elements.transportStatus.textContent = transports.length > 0 ? transports.join(" + ") : "None";
}

function logEvent(message) {
  const time = new Date().toLocaleTimeString();
  elements.eventLog.textContent = `[${time}] ${message}\n${elements.eventLog.textContent}`.slice(0, 5000);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
