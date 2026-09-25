import {
  HaIotMapCore
} from "./ha-iot-map-core.js?v=1";


class HaIotMapManager
  extends HTMLElement {

  constructor() {
    super();

    this._config = {};

    this._core =
      new HaIotMapCore();

    this._loaded =
      false;

    this._loading =
      false;

    this._autoUpdate =
      false;

    this._lastAutoRefresh =
      0;

    this._autoRefreshInterval =
      5000;
  }

  setConfig(config) {
    this._config =
      config || {};
  }

  set hass(hass) {
    this._core.setHass(
      hass
    );

    if (
      !this._loaded &&
      !this._loading
    ) {
      this._initialize();
      return;
    }

    if (
      !this._loaded ||
      !this._autoUpdate
    ) {
      return;
    }

    const now =
      Date.now();

    if (
      now -
      this._lastAutoRefresh >=
      this._autoRefreshInterval
    ) {
      this._lastAutoRefresh =
        now;

      this._render();
    }
  }

  async _initialize() {
    this._loading =
      true;

    this._renderLoading();

    try {
      await this._core.initialize();

      this._loaded =
        true;

      this._loading =
        false;

      this._lastAutoRefresh =
        Date.now();

      this._render();
    } catch (err) {
      console.error(
        "HA IoT Map Manager initialization failed",
        err
      );

      this.innerHTML = `
        <ha-card header="HA IoT Map Manager">

          <div
            style="
              padding:16px;
              color:var(--error-color);
            "
          >
            Initialization failed.
            <br><br>

            ${this._escapeHtml(
              err?.message ||
              String(err)
            )}

          </div>

        </ha-card>
      `;
    }
  }

  _toggleAutoUpdate() {
    this._autoUpdate =
      !this._autoUpdate;

    this._lastAutoRefresh =
      Date.now();

    this._render();
  }

  async _manualRefresh() {
    await this._core.reloadRegistries();

    await this._core.ensureSharedLabels();

    this._render();
  }

  async _changeArea(
    itemId,
    areaId
  ) {
    try {
      await this._core.setArea(
        itemId,
        areaId
      );

      this._render();
    } catch (err) {
      console.error(
        "Area update failed",
        err
      );

      alert(
        err?.message ||
        String(err)
      );

      this._render();
    }
  }

  async _changeClassification(
    itemId,
    value
  ) {
    try {
      await this._core.setClassification(
        itemId,
        value
      );

      this._render();
    } catch (err) {
      console.error(
        "Classification update failed",
        err
      );

      alert(
        err?.message ||
        String(err)
      );

      this._render();
    }
  }

  async _changeCategory(
    itemId,
    value
  ) {
    try {
      await this._core.setCategory(
        itemId,
        value
      );

      this._render();
    } catch (err) {
      console.error(
        "Category update failed",
        err
      );

      alert(
        err?.message ||
        String(err)
      );

      this._render();
    }
  }

  _render() {
    if (
      !this._loaded
    ) {
      return;
    }

    const snapshot =
      this._core.getSnapshot();

    const {
      inventory,
      mergedAwayCount,
      groups
    } =
      snapshot;

    const assignedCount =
      [
        ...groups.areas.values()
      ].reduce(
        (
          total,
          list
        ) =>
          total +
          list.length,
        0
      );

    const visibleCount =
      assignedCount +
      groups.unassigned.length +
      groups.floating.length;

    this.innerHTML = `
      <ha-card>

        <style>

          .iot-wrap {
            padding:18px;
          }

          .iot-header {
            display:flex;
            justify-content:space-between;
            align-items:center;
            gap:16px;
            margin-bottom:16px;
          }

          .iot-title {
            font-size:24px;
            font-weight:500;
          }

          .controls {
            display:flex;
            gap:8px;
          }

          .control-button {
            border:
              1px solid
              var(--divider-color);

            background:
              var(
                --secondary-background-color
              );

            color:
              var(
                --primary-text-color
              );

            padding:
              8px 12px;

            border-radius:
              8px;

            cursor:pointer;
          }

          .auto-on {
            border-color:
              var(
                --success-color,
                #4caf50
              );
          }

          .setup {
            margin-bottom:
              16px;

            padding:
              10px 12px;

            border-radius:
              8px;

            background:
              var(
                --secondary-background-color
              );

            border-left:
              4px solid
              var(
                --success-color,
                #4caf50
              );

            font-size:
              12px;
          }

          .summary {
            display:grid;

            grid-template-columns:
              repeat(
                auto-fit,
                minmax(
                  120px,
                  1fr
                )
              );

            gap:8px;
            margin-bottom:24px;
          }

          .summary-box {
            padding:12px;

            border-radius:
              10px;

            background:
              var(
                --secondary-background-color
              );
          }

          .summary-number {
            font-size:
              24px;

            font-weight:
              600;
          }

          .summary-label {
            font-size:
              12px;

            opacity:
              .7;
          }

          .section {
            margin-top:
              24px;
          }

          .section-title {
            font-size:
              18px;

            font-weight:
              600;
          }

          .area-title {
            font-size:
              15px;

            font-weight:
              600;

            margin-top:
              18px;
          }

          .device {
            display:grid;

            grid-template-columns:
              14px
              minmax(
                280px,
                1fr
              )
              260px;

            gap:
              16px;

            align-items:
              center;

            padding:
              12px 8px;

            border-bottom:
              1px solid
              var(
                --divider-color
              );
          }

          .status {
            width:
              10px;

            height:
              10px;

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

          .device-head {
            display:flex;
            align-items:center;
            gap:10px;
          }

          .device-icon {
            --mdc-icon-size:
              22px;

            opacity:
              .9;
          }

          .device-name {
            font-weight:
              600;
          }

          .category-auto {
            font-size:
              11px;

            opacity:
              .55;

            margin-left:
              6px;
          }

          .device-details {
            font-size:
              12px;

            opacity:
              .65;

            margin-top:
              5px;

            line-height:
              1.5;
          }

          .device-controls {
            display:flex;
            flex-direction:column;
            gap:8px;
          }

          .control-field {
            display:grid;

            grid-template-columns:
              72px
              1fr;

            gap:8px;

            align-items:
              center;
          }

          .field-label {
            font-size:
              11px;

            opacity:
              .6;

            text-transform:
              uppercase;

            letter-spacing:
              .04em;
          }

          .select-control {
            width:
              100%;

            box-sizing:
              border-box;

            padding:
              7px 9px;

            border-radius:
              7px;

            border:
              1px solid
              var(
                --divider-color
              );

            background:
              var(
                --card-background-color
              );

            color:
              var(
                --primary-text-color
              );
          }

          .select-control:disabled {
            opacity:
              .45;
          }

          .area-select.unassigned {
            border-color:
              var(
                --warning-color,
                #ff9800
              );
          }

          .source {
            margin-top:
              3px;

            padding-left:
              80px;

            font-size:
              10px;

            opacity:
              .45;
          }

          .empty {
            opacity:
              .55;

            font-style:
              italic;

            padding:
              10px;
          }

          .special-section {
            margin-top:
              24px;

            padding-top:
              12px;

            border-top:
              1px solid
              var(
                --divider-color
              );
          }

          details {
            margin-top:
              8px;
          }

          summary {
            cursor:
              pointer;

            font-weight:
              600;
          }

          @media (
            max-width:
              900px
          ) {

            .iot-header {
              flex-direction:
                column;

              align-items:
                flex-start;
            }

            .device {
              grid-template-columns:
                14px
                minmax(
                  140px,
                  1fr
                );
            }

            .device-controls {
              grid-column:
                2;

              width:
                100%;

              max-width:
                360px;

              margin-top:
                6px;
            }
          }

        </style>

        <div class="iot-wrap">

          <div class="iot-header">

            <div class="iot-title">
              HA IoT Map Manager
            </div>

            <div class="controls">

              <button
                class="
                  control-button
                  ${
                    this._autoUpdate
                      ? "auto-on"
                      : ""
                  }
                "
                id="iot-auto-update"
              >
                Auto update:
                ${
                  this._autoUpdate
                    ? "ON"
                    : "OFF"
                }
              </button>

              <button
                class="control-button"
                id="iot-refresh-now"
              >
                Refresh now
              </button>

            </div>

          </div>

          <div class="setup">
            ${
              this._escapeHtml(
                this._core.setupMessage ||
                "Shared HA storage ready"
              )
            }
          </div>

          <div class="summary">

            ${
              this._summaryBox(
                visibleCount,
                "IoT devices"
              )
            }

            ${
              this._summaryBox(
                assignedCount,
                "Assigned"
              )
            }

            ${
              this._summaryBox(
                groups.unassigned.length,
                "Unassigned"
              )
            }

            ${
              this._summaryBox(
                groups.floating.length,
                "Floating"
              )
            }

            ${
              this._summaryBox(
                groups.ignored.length,
                "Ignored"
              )
            }

            ${
              this._summaryBox(
                groups.filtered.length,
                "Filtered"
              )
            }

            ${
              this._summaryBox(
                mergedAwayCount,
                "Duplicates"
              )
            }

          </div>

          ${
            this._renderAssigned(
              groups
            )
          }

          ${
            this._renderSection(
              "Unassigned",
              groups.unassigned
            )
          }

          ${
            this._renderSection(
              "Floating / Mobile",
              groups.floating
            )
          }

          ${
            this._renderCollapsedSection(
              "Ignored devices",
              groups.ignored
            )
          }

          ${
            this._renderCollapsedSection(
              "Filtered / software-only",
              groups.filtered
            )
          }

          <div
            style="
              margin-top:20px;
              opacity:.45;
              font-size:11px;
            "
          >
            HA IoT Map Manager v0.9
            • Core v0.9
          </div>

        </div>

      </ha-card>
    `;

    this._attachHandlers();
  }

  _attachHandlers() {
    for (
      const select
      of this.querySelectorAll(
        "select[data-iot-area]"
      )
    ) {
      select.addEventListener(
        "change",
        event => {
          event.target.disabled =
            true;

          this._changeArea(
            event.target.dataset.iotArea,
            event.target.value
          );
        }
      );
    }

    for (
      const select
      of this.querySelectorAll(
        "select[data-iot-classification]"
      )
    ) {
      select.addEventListener(
        "change",
        event => {
          event.target.disabled =
            true;

          this._changeClassification(
            event.target.dataset.iotClassification,
            event.target.value
          );
        }
      );
    }

    for (
      const select
      of this.querySelectorAll(
        "select[data-iot-category]"
      )
    ) {
      select.addEventListener(
        "change",
        event => {
          event.target.disabled =
            true;

          this._changeCategory(
            event.target.dataset.iotCategory,
            event.target.value
          );
        }
      );
    }

    this.querySelector(
      "#iot-auto-update"
    )?.addEventListener(
      "click",
      () =>
        this._toggleAutoUpdate()
    );

    this.querySelector(
      "#iot-refresh-now"
    )?.addEventListener(
      "click",
      () =>
        this._manualRefresh()
    );
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

    const networkParts =
      [];

    if (
      device.ip
    ) {
      networkParts.push(
        this._escapeHtml(
          device.ip
        )
      );
    }

    if (
      device.mac
    ) {
      networkParts.push(
        this._escapeHtml(
          device.mac
        )
      );
    }

    if (
      device.hostname
    ) {
      networkParts.push(
        this._escapeHtml(
          device.hostname
        )
      );
    }

    const hardwareParts =
      [];

    if (
      device.manufacturer
    ) {
      hardwareParts.push(
        this._escapeHtml(
          device.manufacturer
        )
      );
    }

    if (
      device.model
    ) {
      hardwareParts.push(
        this._escapeHtml(
          device.model
        )
      );
    }

    return `
      <div class="device">

        <div
          class="
            status
            ${
              device.online
                ? "online"
                : "offline"
            }
          "
        ></div>

        <div>

          <div class="device-head">

            <ha-icon
              class="device-icon"
              icon="${
                this._escapeHtml(
                  icon
                )
              }"
            ></ha-icon>

            <div class="device-name">
              ${
                this._escapeHtml(
                  device.name
                )
              }
            </div>

            <span class="category-auto">
              ${
                this._escapeHtml(
                  this._core.categoryTitle(
                    category
                  )
                )
              }
            </span>

          </div>

          <div class="device-details">

            ${
              networkParts.length
                ? networkParts.join(
                    " • "
                  ) +
                  "<br>"
                : ""
            }

            ${
              hardwareParts.length
                ? hardwareParts.join(
                    " "
                  ) +
                  "<br>"
                : ""
            }

            ${
              device.entityCount
            }
            entit${
              device.entityCount ===
              1
                ? "y"
                : "ies"
            }

          </div>

        </div>

        <div class="device-controls">

          <div class="control-field">

            <div class="field-label">
              Category
            </div>

            ${
              this._renderCategorySelector(
                device
              )
            }

          </div>

          <div class="control-field">

            <div class="field-label">
              Class
            </div>

            ${
              this._renderClassificationSelector(
                device
              )
            }

          </div>

          <div class="control-field">

            <div class="field-label">
              Area
            </div>

            ${
              this._renderAreaSelector(
                device
              )
            }

          </div>

          <div class="source">
            ${
              this._escapeHtml(
                device.platforms.join(
                  ", "
                )
              )
            }
          </div>

        </div>

      </div>
    `;
  }

  _renderCategorySelector(
    device
  ) {
    const stored =
      this._core.getStoredCategory(
        device
      );

    const resolved =
      this._core.getResolvedCategory(
        device
      );

    return `
      <select
        class="select-control"
        data-iot-category="${
          this._escapeHtml(
            device.id
          )
        }"
        ${
          !this._core.isAdmin
            ? "disabled"
            : ""
        }
      >

        <option
          value="auto"
          ${
            stored ===
            "auto"
              ? "selected"
              : ""
          }
        >
          Auto (${
            this._escapeHtml(
              this._core.categoryTitle(
                resolved
              )
            )
          })
        </option>

        ${
          Object.entries(
            this._core.categoryDefs
          )
            .map(
              (
                [
                  key,
                  def
                ]
              ) => `
                <option
                  value="${key}"
                  ${
                    stored ===
                    key
                      ? "selected"
                      : ""
                  }
                >
                  ${
                    this._escapeHtml(
                      def.title
                    )
                  }
                </option>
              `
            )
            .join("")
        }

      </select>
    `;
  }

  _renderClassificationSelector(
    device
  ) {
    const stored =
      this._core.getStoredClassification(
        device
      );

    return `
      <select
        class="select-control"
        data-iot-classification="${
          this._escapeHtml(
            device.id
          )
        }"
        ${
          !this._core.isAdmin
            ? "disabled"
            : ""
        }
      >

        <option
          value="auto"
          ${
            stored ===
            "auto"
              ? "selected"
              : ""
          }
        >
          Auto
        </option>

        <option
          value="fixed"
          ${
            stored ===
            "fixed"
              ? "selected"
              : ""
          }
        >
          Fixed
        </option>

        <option
          value="floating"
          ${
            stored ===
            "floating"
              ? "selected"
              : ""
          }
        >
          Floating
        </option>

        <option
          value="ignored"
          ${
            stored ===
            "ignored"
              ? "selected"
              : ""
          }
        >
          Ignored
        </option>

      </select>
    `;
  }

  _renderAreaSelector(
    device
  ) {
    const sortedAreas =
      [
        ...this._core.areas
      ]
        .sort(
          (
            a,
            b
          ) =>
            a.name.localeCompare(
              b.name
            )
        );

    return `
      <select
        class="
          select-control
          area-select
          ${
            device.areaId
              ? ""
              : "unassigned"
          }
        "
        data-iot-area="${
          this._escapeHtml(
            device.id
          )
        }"
        ${
          !this._core.isAdmin
            ? "disabled"
            : ""
        }
      >

        <option
          value=""
          ${
            !device.areaId
              ? "selected"
              : ""
          }
        >
          Unassigned
        </option>

        ${
          sortedAreas
            .map(
              area => `
                <option
                  value="${
                    this._escapeHtml(
                      area.area_id
                    )
                  }"
                  ${
                    device.areaId ===
                    area.area_id
                      ? "selected"
                      : ""
                  }
                >
                  ${
                    this._escapeHtml(
                      area.name
                    )
                  }
                </option>
              `
            )
            .join("")
        }

      </select>
    `;
  }

  _renderAssigned(groups) {
    const areas =
      [
        ...groups.areas.entries()
      ]
        .sort(
          (
            a,
            b
          ) =>
            a[0].localeCompare(
              b[0]
            )
        );

    return `
      <div class="section">

        <div class="section-title">
          Assigned
        </div>

        ${
          areas.length
            ? areas
                .map(
                  (
                    [
                      area,
                      devices
                    ]
                  ) => `

                    <div class="area-title">
                      ${
                        this._escapeHtml(
                          area
                        )
                      }
                    </div>

                    ${
                      devices
                        .map(
                          d =>
                            this._renderDevice(
                              d
                            )
                        )
                        .join("")
                    }

                  `
                )
                .join("")
            : `
              <div class="empty">
                Nothing assigned.
              </div>
            `
        }

      </div>
    `;
  }

  _renderSection(
    title,
    devices
  ) {
    return `
      <div class="section">

        <div class="section-title">
          ${
            this._escapeHtml(
              title
            )
          }
        </div>

        ${
          devices.length
            ? devices
                .map(
                  d =>
                    this._renderDevice(
                      d
                    )
                )
                .join("")
            : `
              <div class="empty">
                Nothing here.
              </div>
            `
        }

      </div>
    `;
  }

  _renderCollapsedSection(
    title,
    devices
  ) {
    return `
      <div class="special-section">

        <details>

          <summary>
            ${
              this._escapeHtml(
                title
              )
            }
            (${devices.length})
          </summary>

          ${
            devices.length
              ? devices
                  .map(
                    d =>
                      this._renderDevice(
                        d
                      )
                  )
                  .join("")
              : `
                <div class="empty">
                  Nothing here.
                </div>
              `
          }

        </details>

      </div>
    `;
  }

  _summaryBox(
    number,
    label
  ) {
    return `
      <div class="summary-box">

        <div class="summary-number">
          ${number}
        </div>

        <div class="summary-label">
          ${
            this._escapeHtml(
              label
            )
          }
        </div>

      </div>
    `;
  }

  _renderLoading() {
    this.innerHTML = `
      <ha-card header="HA IoT Map Manager">

        <div style="padding:16px">
          Loading shared IoT core...
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
      columns:
        12,

      min_columns:
        6
    };
  }
}


if (
  !customElements.get(
    "ha-iot-map-manager"
  )
) {
  customElements.define(
    "ha-iot-map-manager",
    HaIotMapManager
  );
}


/*
 * Backward compatibility.
 *
 * Your existing dashboards using:
 *
 * type: custom:ha-iot-map
 *
 * continue to work.
 */
if (
  !customElements.get(
    "ha-iot-map"
  )
) {
  customElements.define(
    "ha-iot-map",
    HaIotMapManager
  );
}


window.customCards =
  window.customCards ||
  [];


if (
  !window.customCards.some(
    card =>
      card.type ===
      "ha-iot-map-manager"
  )
) {
  window.customCards.push({
    type:
      "ha-iot-map-manager",

    name:
      "HA IoT Map Manager",

    description:
      "Inventory and staging manager for HA IoT Map"
  });
}


console.info(
  "%c HA IoT Map Manager %c v0.9 ",
  "background:#03a9f4;color:white;font-weight:bold;",
  "background:#333;color:white;"
);
