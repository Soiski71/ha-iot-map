class HaIotMap extends HTMLElement {
  set hass(hass) {
    if (!this.content) {
      this.innerHTML = `
        <ha-card header="HA IoT Map">
          <div style="padding:16px">
            <div style="font-size:18px;font-weight:600;margin-bottom:8px">
              IoT Map prototype is alive 🎯
            </div>
            <div>
              Home Assistant version: ${hass.config.version || "unknown"}
            </div>
          </div>
        </ha-card>
      `;

      this.content = true;
    }
  }

  setConfig(config) {
    this.config = config;
  }

  getCardSize() {
    return 2;
  }
}

customElements.define("ha-iot-map", HaIotMap);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "ha-iot-map",
  name: "HA IoT Map",
  description: "Visual IoT inventory and floor map for Home Assistant",
});
