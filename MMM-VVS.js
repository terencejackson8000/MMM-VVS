Module.register("MMM-VVS", {

  defaults: {
    exampleContent: "",
    endpoint: "https://www.efa-bw.de/trias",

    originStopPointRef: "",
    destinationStopPointRef: "",

    updateInterval: 60 * 1000,
    numberOfResults: 3,
    includeIntermediateStops: true,

    title: "VVS Trips"
  },

  start() {
    this.trips = [];
    this.error = null;

    this.sendFetch();
    setInterval(() => this.sendFetch(), this.config.updateInterval);
  },

  sendFetch() {
    this.sendSocketNotification("VVS_FETCH", {
      endpoint: this.config.endpoint,
      originStopPointRef: this.config.originStopPointRef,
      destinationStopPointRef: this.config.destinationStopPointRef,
      numberOfResults: this.config.numberOfResults,
      includeIntermediateStops: this.config.includeIntermediateStops
    });
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "VVS_RESULT") {
      this.trips = payload.trips || [];
      this.error = null;
      this.updateDom();
    }

    if (notification === "VVS_ERROR") {
      this.error = payload.message || "Unknown error";
      this.trips = [];
      this.updateDom();
    }
  },

  getDom() {
    const wrapper = document.createElement("div");

    const title = document.createElement("div");
    title.className = "bright";
    title.innerText = this.config.title;
    wrapper.appendChild(title);

    if (this.error) {
      const err = document.createElement("div");
      err.className = "small dimmed";
      err.innerText = this.error;
      wrapper.appendChild(err);
      return wrapper;
    }

    if (!this.trips.length) {
      const empty = document.createElement("div");
      empty.className = "small dimmed";
      empty.innerText = "No trips";
      wrapper.appendChild(empty);
      return wrapper;
    }

    const list = document.createElement("div");
    list.className = "small";

    for (const t of this.trips) {
      const row = document.createElement("div");
      row.style.marginTop = "8px";

      const headline = document.createElement("div");
      headline.className = "bright";
      headline.innerText = `${this.formatTime(t.departureTime)} → ${this.formatTime(t.arrivalTime)} (${t.durationMinutes ?? "?"} min)`;
      row.appendChild(headline);

      const legs = document.createElement("div");
      legs.className = "dimmed";
      legs.innerText = (t.legs || [])
        .map(l => l.mode === "walk" ? "Walk" : (l.line || l.mode || "PT"))
        .join(" · ");
      row.appendChild(legs);

      list.appendChild(row);
    }

    wrapper.appendChild(list);
    return wrapper;
  },

  formatTime(iso) {
    if (!iso) return "?";
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
})
