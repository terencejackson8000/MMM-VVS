const NodeHelper = require("node_helper");
const { XMLParser } = require("fast-xml-parser");
const Log = require("logger");

module.exports = NodeHelper.create({
  start() {
    this.parser = new XMLParser({ ignoreAttributes: false });
    Log.info("[MMM-VVS] node_helper started");
  },

  async socketNotificationReceived(notification, payload) {
    if (notification !== "VVS_FETCH") return;

    try {
      const { endpoint, originStopPointRef, destinationStopPointRef, numberOfResults, includeIntermediateStops } = payload;

      if (!endpoint || !originStopPointRef || !destinationStopPointRef) {
        throw new Error("Missing endpoint/originStopPointRef/destinationStopPointRef");
      }

      const tripXml = this.buildTripRequestXml({
        originStopPointRef,
        destinationStopPointRef,
        departureTime: new Date().toISOString(),
        numberOfResults: numberOfResults ?? 5,
        includeIntermediateStops: includeIntermediateStops ?? true
      });

      const xmlResponse = await this.postXml(endpoint, tripXml);
      const trips = this.extractTrips(xmlResponse);

      this.sendSocketNotification("VVS_RESULT", { trips });
    } catch (err) {
      this.sendSocketNotification("VVS_ERROR", { message: err.message });
    }
  },

  buildTripRequestXml({ originStopPointRef, destinationStopPointRef, departureTime, numberOfResults, includeIntermediateStops }) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Trias xmlns="http://www.vdv.de/trias" version="1.2">
  <ServiceRequest>
    <RequestTimestamp>${new Date().toISOString()}</RequestTimestamp>
    <RequestPayload>
      <TripRequest>
        <Origin>
          <LocationRef>
            <StopPointRef>${originStopPointRef}</StopPointRef>
          </LocationRef>
          <DepArrTime>${departureTime}</DepArrTime>
        </Origin>
        <Destination>
          <LocationRef>
            <StopPointRef>${destinationStopPointRef}</StopPointRef>
          </LocationRef>
        </Destination>
        <Params>
          <NumberOfResults>${numberOfResults}</NumberOfResults>
          <IncludeIntermediateStops>${includeIntermediateStops ? "true" : "false"}</IncludeIntermediateStops>
          <IncludeTrackSections>false</IncludeTrackSections>
          <IncludeFares>false</IncludeFares>
        </Params>
      </TripRequest>
    </RequestPayload>
  </ServiceRequest>
</Trias>`;
  },

  async postXml(endpoint, xmlBody) {
    // Node 18+ has global fetch. MagicMirror on older Node might not.
    // If fetch is not available, upgrade Node or add node-fetch.
    if (typeof fetch !== "function") {
      throw new Error("fetch is not available. Use Node 18+ or add node-fetch.");
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=UTF-8",
        "Accept": "text/xml"
      },
      body: xmlBody
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    return text;
  },

  extractTrips(tripResponseXml) {
    const json = this.parser.parse(tripResponseXml);

    const tripResults =
      json?.Trias
        ?.ServiceDelivery
        ?.DeliveryPayload
        ?.TripResponse
        ?.TripResult;

    if (!tripResults) return [];

    const resultsArray = Array.isArray(tripResults) ? tripResults : [tripResults];

    const trips = [];

    for (const r of resultsArray) {
      const trip = r?.Trip;
      if (!trip) continue;

      const legs = trip.TripLeg ? (Array.isArray(trip.TripLeg) ? trip.TripLeg : [trip.TripLeg]) : [];

      // Create a human-friendly summary: departure, arrival, duration, and first timed leg line info if present.
      const summary = {
        departureTime: trip?.StartTime || null,
        arrivalTime: trip?.EndTime || null,
        durationMinutes: trip?.Duration ? this.durationToMinutes(trip.Duration) : null,
        legs: []
      };

      for (const leg of legs) {
        if (leg.TimedLeg) {
          const tl = leg.TimedLeg;
          const board = tl.LegBoard || {};
          const alight = tl.LegAlight || {};
          const service = tl.Service || {};

          summary.legs.push({
            mode: service?.Mode?.PtMode || service?.Mode || "pt",
            line: Array.isArray(service?.PublishedLineName)
              ? service.PublishedLineName?.[0]?.Text
              : service?.PublishedLineName?.Text || null,
            journeyRef: service?.JourneyRef || null,
            operatingDayRef: service?.OperatingDayRef || null,
            from: board?.StopPointName?.Text || null,
            to: alight?.StopPointName?.Text || null,
            dep: board?.ServiceDeparture?.TimetabledTime || board?.ServiceDeparture?.EstimatedTime || null,
            arr: alight?.ServiceArrival?.TimetabledTime || alight?.ServiceArrival?.EstimatedTime || null
          });
        } else if (leg.ContinuousLeg) {
          summary.legs.push({ mode: "walk", line: "Walk" });
        }
      }

      trips.push(summary);
    }

    return trips;
  },

  // TRIAS durations are often ISO 8601 duration like "PT17M"
  durationToMinutes(duration) {
    if (typeof duration !== "string") return null;
    const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (!match) return null;
    const hours = match[1] ? parseInt(match[1], 10) : 0;
    const mins = match[2] ? parseInt(match[2], 10) : 0;
    return hours * 60 + mins;
  }
});
