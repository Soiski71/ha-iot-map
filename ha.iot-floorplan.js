import {
  HaIotMapCore
} from "./ha-iot-map-core.js?v=1";


class HaIotFloorplan extends HTMLElement {
  constructor() {
    super();

    this._config = {};
    this._core = new HaIotMapCore();

    this._loaded = false;
    this._loading = false;
  }

  setConfig(config) {
    this._config = config || {};
  }

  set hass(hass) {
    this._core.setHass(hass);

    if (!this._loaded && !this._loading) {
      this._initialize();
      return;
    }

    if (this._loaded) {
      this._render();
    }
  }

  async _initialize() {
    this._loading = true;
    this._renderLoading();

    try {
      await this._core.initialize();

      this._loaded = true;
      this._loading = false;

      this._render();
    } catch (err) {
      console.error(
        "HA IoT Floorplan initialization failed",
        err
      );

      this.innerHTML = `
        <ha-card header="HA IoT Floorplan">
          <div style="
            padding:16px;
            color:var(--error-color);
          ">
            Initialization failed.
            <br><br>
            ${this._escapeHtml(
              err?.message || String(err)
            )}
          </div>
        </ha-card>
      `;
    }
  }

  _getFloorplanData() {
    const snapshot =
      this._core.getSnapshot();

    const areaGroups =
      [];

    for (
      const [areaName, devices]
      of snapshot.groups.areas.entries()
    ) {
      const fixedDevices =
        devices.filter(
          device =>
            this._core.getEffectiveClassification(
              device
            ) === "fixed"
        );

      if (!fixedDevices.length) {
        continue;
      }

      areaGroups.push({
        areaName,
        devices: fixedDevices
      });
    }

    areaGroups.sort(
      (a, b) =>
        a.areaName.localeCompare(
          b.areaName
        )
    );

    const floatingDevices =
      snapshot.groups.floating;

    return {
      areaGroups,
      floatingDevices,
      snapshot
    };
  }

  _render() {
    if (!this._loaded) {
      return;
    }

    const {
      areaGroups,
      floatingDevices
    } =
      this._getFloorplanData();

    this.innerHTML = `
      <ha-card>

        <style>

          .wrap {
            padding:18px;
          }

          .header {
            display:flex;
            justify-content:space-between;
            align-items:center;
            gap:12px;
            margin-bottom:18px;
          }

          .title {
            font-size:24px;
            font-weight:500;
          }

          .sub {
            font-size:12px;
            opacity:.6;
          }

          .areas {
            display:grid;

            grid-template-columns:
              repeat(
                auto-fit,
                minmax(
                  260px,
                  1fr
                )
              );

            gap:14px;
          }

          .area-card {
            border:
              1px solid
              var(--divider-color);

            border-radius:
              12px;

            background:
              var(
                --secondary-background-color
              );

            min-height:
              160px;

            padding:
              14px;
          }

          .area-name {
            font-size:
              17px;

            font-weight:
              600;

            margin-bottom:
              12px;
          }

          .device-grid {
            display:grid;

            grid-template-columns:
              repeat(
                auto-fit,
                minmax(
                  105px,
                  1fr
                )
              );

            gap:8px;
          }

          .device {
            position:relative;

            border:
              1px solid
              var(--divider-color);

            border-radius:
              10px;

            background:
              var(
                --card-background-color
              );

            padding:
              10px;

            min-height:
              82px;

            display:flex;
            flex-direction:column;
            align-items:center;
            justify-content:center;

            text-align:center;
          }

          .device-icon {
            --mdc-icon-size:
              28px;

            margin-bottom:
              6px;
          }

          .device-name {
            font-size:
              12px;

            font-weight:
              600;

            line-height:
              1.25;

            word-break:
              break-word;
          }

          .device-category {
            font-size:
              10px;

            opacity:
              .55;

            margin-top:
              3px;
          }

          .status-dot {
            position:absolute;

            top:
              7px;

            right:
              7px;

            width:
              8px;

            height:
              8px;

            border-radius:
              50%;
          }

          .online {
            background:
              var(
                --success-color,
                #4caf50
              );
          }

          .offline {
            background:
              var(
                --disabled-text-color
              );
          }

          .floating-section {
            margin-top:
              22px;
          }

          .floating-title {
            font-size:
              17px;

            font-weight:
              600;

            margin-bottom:
              10px;
          }

          .floating-strip {
            display:flex;
            flex-wrap:wrap;
            gap:8px;
          }

          .floating-device {
            display:flex;
            align-items:center;
            gap:8px;

            border:
              1px solid
              var(--divider-color);

            border-radius:
              999px;

            background:
              var(
                --secondary-background-color
              );

            padding:
              7px 10px;
          }

          .floating-device ha-icon {
            --mdc-icon-size:
              18px;
          }

          .floating-name {
            font-size:
              12px;

            font-weight:
              500;
          }

          .empty {
            opacity:
              .55;

            font-style:
              italic;

            padding:
              12px 0;
          }

          .footer {
            margin-top:
              20px;

            font-size:
              11px;

            opacity:
              .45;
          }

        </style>


        <div class="wrap">

          <div class="header">

            <div>

              <div class="title">
                HA IoT Floorplan
              </div>

              <div class="sub">
                Fixed devices grouped by Home Assistant Area
              </div>

            </div>

          </div>


          ${
            areaGroups.length
              ? `
                <div class="areas">

                  ${
                    areaGroups
                      .map(
                        group =>
                          this._renderArea(
                            group
                          )
                      )
                      .join("")
                  }

                </div>
              `
              : `
                <div class="empty">
                  No fixed devices with Areas found.
                </div>
              `
          }


          <div class="floating-section">

            <div class="floating-title">
              Floating / Mobile
            </div>

            ${
              floatingDevices.length
                ? `
                  <div class="floating-strip">

                    ${
                      floatingDevices
                        .map(
                          device =>
                            this._renderFloatingDevice(
                              device
                            )
                        )
                        .join("")
                    }

                  </div>
                `
                : `
                  <div class="empty">
                    No floating devices.
                  </div>
                `
            }

          </div>


          <div class="footer">
            HA IoT Floorplan prototype v0.1
            • Shared Core v0.9
          </div>

        </div>

      </ha-card>
    `;
  }

  _renderArea(group) {
    return `
      <div class="area-card">

        <div class="area-name">
          ${this._escapeHtml(
            group.areaName
          )}
        </div>

        <div class="device-grid">

          ${
            group.devices
              .map(
                device =>
                  this._renderDevice(
                    device
                  )
              )
              .join("")
          }

        </div>

      </div>
    `;
  }

  _renderDevice(device) {
    const category =
      this._core.getResolvedCategory(
        device
      );

    const icon =
      this._core.categoryIcon(
        category
      );

    return `
      <div
        class="device"
        title="${this._escapeHtml(
          this._deviceTooltip(
            device,
            category
          )
        )}"
      >

        <div
          class="
            status-dot
            ${
              device.online
                ? "online"
                : "offline"
            }
          "
        ></div>

        <ha-icon
          class="device-icon"
          icon="${this._escapeHtml(
            icon
          )}"
        ></ha-icon>

        <div class="device-name">
          ${this._escapeHtml(
            device.name
          )}
        </div>

        <div class="device-category">
          ${this._escapeHtml(
            this._core.categoryTitle(
              category
            )
          )}
        </div>

      </div>
    `;
  }

  _renderFloatingDevice(device) {
    const category =
      this._core.getResolvedCategory(
        device
      );

    const icon =
      this._core.categoryIcon(
        category
      );

    return `
      <div
        class="floating-device"
        title="${this._escapeHtml(
          this._deviceTooltip(
            device,
            category
          )
        )}"
      >

        <ha-icon
          icon="${this._escapeHtml(
            icon
          )}"
        ></ha-icon>

        <div class="floating-name">
          ${this._escapeHtml(
            device.name
          )}
        </div>

        <div
          class="
            status-dot
            ${
              device.online
                ? "online"
                : "offline"
            }
          "
          style="
            position:static;
            flex:0 0 auto;
          "
        ></div>

      </div>
    `;
  }

  _deviceTooltip(
    device,
    category
  ) {
    const parts = [
      device.name,
      this._core.categoryTitle(
        category
      )
    ];

    if (device.ip) {
      parts.push(
        `IP: ${device.ip}`
      );
    }

    if (device.mac) {
      parts.push(
        `MAC: ${device.mac}`
      );
    }

    return parts.join("\n");
  }

  _renderLoading() {
    this.innerHTML = `
      <ha-card header="HA IoT Floorplan">

        <div style="padding:16px">
          Loading shared IoT data...
        </div>

      </ha-card>
    `;
  }

  _escapeHtml(value) {
    return String(
      value ?? ""
    )
      .replaceAll(
        "&",
        "&amp;"
      )
      .replaceAll(
        "<",
        "&lt;"
      )
      .replaceAll(
        ">",
        "&gt;"
      )
      .replaceAll(
        '"',
        "&quot;"
      )
      .replaceAll(
        "'",
        "&#039;"
      );
  }

  getCardSize() {
    return 8;
  }

  getGridOptions() {
    return {
      columns: 12,
      min_columns: 6
    };
  }
}


if (
  !customElements.get(
    "ha-iot-floorplan"
  )
) {
  customElements.define(
    "ha-iot-floorplan",
    HaIotFloorplan
  );
}


window.customCards =
  window.customCards ||
  [];


if (
  !window.customCards.some(
    card =>
      card.type ===
      "ha-iot-floorplan"
  )
) {
  window.customCards.push({
    type:
      "ha-iot-floorplan",

    name:
      "HA IoT Floorplan",

    description:
      "Visual floorplan view for HA IoT Map"
  });
}


console.info(
  "%c HA IoT Floorplan %c prototype v0.1 ",
  "background:#673ab7;color:white;font-weight:bold;",
  "background:#333;color:white;"
);
