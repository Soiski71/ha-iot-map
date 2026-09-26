import {
  HaIotMapCore
} from "./ha-iot-map-core.js?v=4";


class HaIotMapManager extends HTMLElement {

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

    this._sortMode =
      "name";

    this._offlineFilter =
      "all";
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

      this._loading =
        false;

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
    try {
      await this._core.reloadRegistries();

      await this._core.ensureSharedLabels();

      this._render();

    } catch (err) {
      console.error(
        "HA IoT Map Manager refresh failed",
        err
      );
    }
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


  async _changeFriendlyName(
    itemId,
    currentName,
    currentUserName
  ) {
    const value =
      prompt(
        "Friendly display name\n\nThis changes only the Home Assistant display name. Entity IDs, MQTT topics, unique IDs, MAC addresses and hostnames are not changed.\n\nLeave blank to restore the integration/original name.",
        currentUserName ||
        currentName ||
        ""
      );

    if (
      value === null
    ) {
      return;
    }

    try {
      await this._core.setFriendlyName(
        itemId,
        value
      );

      this._render();

    } catch (err) {
      console.error(
        "Friendly name update failed",
        err
      );

      alert(
        err?.message ||
        String(err)
      );

      this._render();
    }
  }


  _formatTimestamp(
    timestamp
  ) {
    if (
      !Number.isFinite(
        timestamp
      )
    ) {
      return "Unavailable";
    }

    try {
      return new Intl.DateTimeFormat(
        undefined,
        {
          year:
            "numeric",

          month:
            "2-digit",

          day:
            "2-digit",

          hour:
            "2-digit",

          minute:
            "2-digit"
        }
      ).format(
        new Date(
          timestamp
        )
      );

    } catch {
      return new Date(
        timestamp
      ).toLocaleString();
    }
  }


  _formatAge(
    timestamp
  ) {
    if (
      !Number.isFinite(
        timestamp
      )
    ) {
      return "";
    }

    const delta =
      Math.max(
        0,
        Date.now() -
        timestamp
      );

    const minutes =
      Math.floor(
        delta /
        60000
      );

    if (
      minutes <
      60
    ) {
      return `${minutes} min ago`;
    }

    const hours =
      Math.floor(
        minutes /
        60
      );

    if (
      hours <
      24
    ) {
      return `${hours} h ago`;
    }

    const days =
      Math.floor(
        hours /
        24
      );

    if (
      days <
      60
    ) {
      return `${days} d ago`;
    }

    const months =
      Math.floor(
        days /
        30.44
      );

    if (
      months <
      24
    ) {
      return `${months} mo ago`;
    }

    const years =
      Math.floor(
        days /
        365.25
      );

    return `${years} y ago`;
  }


  _passesOfflineFilter(
    device
  ) {
    if (
      this._offlineFilter ===
      "all"
    ) {
      return true;
    }

    if (
      device.online
    ) {
      return false;
    }

    if (
      this._offlineFilter ===
      "offline"
    ) {
      return true;
    }

    const match =
      /^offline_(\d+)$/.exec(
        this._offlineFilter
      );

    if (!match) {
      return true;
    }

    const days =
      Number(
        match[1]
      );

    const reference =
      device.offlineSinceTs ||
      device.lastSeenTs;

    if (
      !Number.isFinite(
        reference
      )
    ) {
      return false;
    }

    return (
      Date.now() -
      reference
    ) >=
      days *
      86400000;
  }


  _sortDevices(
    devices
  ) {
    const result =
      [...devices];

    const nameSort =
      (
        a,
        b
      ) =>
        String(
          a.name ||
          ""
        ).localeCompare(
          String(
            b.name ||
            ""
          )
        );

    if (
      this._sortMode ===
      "ip"
    ) {
      result.sort(
        (
          a,
          b
        ) =>
          this._compareIpAddresses(
            a.ip,
            b.ip
          ) ||
          nameSort(
            a,
            b
          )
      );

      return result;
    }

    if (
      this._sortMode ===
      "last_seen"
    ) {
      result.sort(
        (
          a,
          b
        ) => {
          const at =
            Number.isFinite(
              a.lastSeenTs
            )
              ? a.lastSeenTs
              : -Infinity;

          const bt =
            Number.isFinite(
              b.lastSeenTs
            )
              ? b.lastSeenTs
              : -Infinity;

          return (
            bt -
            at
          ) ||
          nameSort(
            a,
            b
          );
        }
      );

      return result;
    }

    if (
      this._sortMode ===
      "offline_longest"
    ) {
      result.sort(
        (
          a,
          b
        ) => {
          if (
            a.online !==
            b.online
          ) {
            return a.online
              ? 1
              : -1;
          }

          const at =
            Number.isFinite(
              a.offlineSinceTs
            )
              ? a.offlineSinceTs
              : (
                  Number.isFinite(
                    a.lastSeenTs
                  )
                    ? a.lastSeenTs
                    : Infinity
                );

          const bt =
            Number.isFinite(
              b.offlineSinceTs
            )
              ? b.offlineSinceTs
              : (
                  Number.isFinite(
                    b.lastSeenTs
                  )
                    ? b.lastSeenTs
                    : Infinity
                );

          return (
            at -
            bt
          ) ||
          nameSort(
            a,
            b
          );
        }
      );

      return result;
    }

    result.sort(
      nameSort
    );

    return result;
  }


  _compareIpAddresses(
    a,
    b
  ) {
    const parse =
      value => {
        const text =
          String(
            value ||
            ""
          )
            .trim()
            .split(/[\s,;]+/)[0];

        if (!text) {
          return {
            valid: false,
            value: 0,
            text: ""
          };
        }

        const parts =
          text.split(".");

        if (
          parts.length === 4 &&
          parts.every(
            part =>
              /^\d+$/.test(part) &&
              Number(part) >= 0 &&
              Number(part) <= 255
          )
        ) {
          const numeric =
            parts.reduce(
              (
                total,
                part
              ) =>
                total * 256 +
                Number(part),
              0
            );

          return {
            valid: true,
            value: numeric,
            text
          };
        }

        return {
          valid: false,
          value: 0,
          text
        };
      };

    const ai = parse(a);
    const bi = parse(b);

    if (
      ai.valid !==
      bi.valid
    ) {
      return ai.valid
        ? -1
        : 1;
    }

    if (
      ai.valid &&
      bi.valid
    ) {
      return ai.value -
        bi.value;
    }

    if (
      ai.text &&
      !bi.text
    ) {
      return -1;
    }

    if (
      !ai.text &&
      bi.text
    ) {
      return 1;
    }

    return ai.text.localeCompare(
      bi.text
    );
  }


  _csvValue(
    value
  ) {
    const text =
      String(
        value ?? ""
      );

    return `"${text.replaceAll(
      '"',
      '""'
    )}"`;
  }


  _csvTimestamp(
    timestamp
  ) {
    if (
      !Number.isFinite(
        timestamp
      )
    ) {
      return "";
    }

    try {
      return new Date(
        timestamp
      ).toISOString();
    } catch {
      return "";
    }
  }


  _exportCsv() {
    const snapshot =
      this._core.getSnapshot();

    const areaNames =
      new Map(
        this._core.areas.map(
          area => [
            area.area_id,
            area.name
          ]
        )
      );

    const devices =
      [...snapshot.inventory]
        .sort(
          (
            a,
            b
          ) =>
            this._compareIpAddresses(
              a.ip,
              b.ip
            ) ||
            String(
              a.name ||
              ""
            ).localeCompare(
              String(
                b.name ||
                ""
              )
            )
        );

    const headers = [
      "Name",
      "IP",
      "MAC",
      "Hostname",
      "Area",
      "Category",
      "Classification",
      "Online",
      "Last seen",
      "Offline since",
      "Timestamp source",
      "Manufacturer",
      "Model",
      "Software version",
      "Platforms",
      "Entity count",
      "Tracker count",
      "Entity IDs"
    ];

    const rows =
      devices.map(
        device => {
          const category =
            this._core.getResolvedCategory(
              device
            );

          const classification =
            this._core.getEffectiveClassification(
              device
            );

          const source =
            device.lastSeenSource?.startsWith(
              "reported:"
            )
              ? "device reported"
              : (
                  device.lastSeenSource
                    ? "HA state activity"
                    : ""
                );

          const platforms =
            Array.isArray(
              device.platforms
            )
              ? device.platforms.join(" | ")
              : (
                  device.platforms ||
                  device.platform ||
                  ""
                );

          const entityIds =
            Array.isArray(
              device.entityIds
            )
              ? device.entityIds.join(" | ")
              : "";

          return [
            device.name,
            device.ip,
            device.mac,
            device.hostname,
            device.areaName ||
              areaNames.get(
                device.areaId
              ) ||
              "",
            this._core.categoryTitle(
              category
            ),
            classification,
            device.online
              ? "Yes"
              : "No",
            this._csvTimestamp(
              device.lastSeenTs
            ),
            this._csvTimestamp(
              device.offlineSinceTs
            ),
            source,
            device.manufacturer,
            device.model,
            device.swVersion,
            platforms,
            device.entityCount,
            device.trackerCount,
            entityIds
          ];
        }
      );

    const csv =
      "\ufeff" +
      [
        headers,
        ...rows
      ]
        .map(
          row =>
            row
              .map(
                value =>
                  this._csvValue(
                    value
                  )
              )
              .join(",")
        )
        .join("\r\n");

    const blob =
      new Blob(
        [csv],
        {
          type:
            "text/csv;charset=utf-8"
        }
      );

    const url =
      URL.createObjectURL(
        blob
      );

    const today =
      new Date()
        .toLocaleDateString(
          "en-CA"
        );

    const link =
      document.createElement(
        "a"
      );

    link.href = url;
    link.download =
      `ha-iot-inventory-${today}.csv`;

    document.body.appendChild(
      link
    );

    link.click();
    link.remove();

    setTimeout(
      () =>
        URL.revokeObjectURL(
          url
        ),
      1000
    );
  }


  _prepareGroups(
    groups
  ) {
    const filterAndSort =
      list =>
        this._sortDevices(
          list.filter(
            device =>
              this._passesOfflineFilter(
                device
              )
          )
        );

    const areas =
      new Map();

    for (
      const [
        areaName,
        devices
      ]
      of groups.areas.entries()
    ) {
      const prepared =
        filterAndSort(
          devices
        );

      if (
        prepared.length
      ) {
        areas.set(
          areaName,
          prepared
        );
      }
    }

    return {
      areas,

      unassigned:
        filterAndSort(
          groups.unassigned
        ),

      floating:
        filterAndSort(
          groups.floating
        ),

      ignored:
        filterAndSort(
          groups.ignored
        ),

      filtered:
        filterAndSort(
          groups.filtered
        )
    };
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
      groups:
        rawGroups
    } =
      snapshot;

    const assignedCount =
      [
        ...rawGroups.areas.values()
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
      rawGroups.unassigned.length +
      rawGroups.floating.length;

    const groups =
      this._prepareGroups(
        rawGroups
      );

    const shownCount =
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
      ) +
      groups.unassigned.length +
      groups.floating.length +
      groups.ignored.length +
      groups.filtered.length;

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
            align-items:center;
            flex-wrap:wrap;
          }


          .inventory-tools {
            display:flex;
            gap:10px;
            align-items:center;
            flex-wrap:wrap;
            margin-bottom:18px;
            padding:10px 12px;
            border:1px solid var(--divider-color);
            border-radius:9px;
            background:rgba(255,255,255,.025);
          }


          .tool-label {
            font-size:11px;
            opacity:.6;
            text-transform:uppercase;
            letter-spacing:.04em;
          }


          .tool-select {
            min-width:170px;
            padding:7px 9px;
            border-radius:7px;
            border:1px solid var(--divider-color);
            background:var(--card-background-color);
            color:var(--primary-text-color);
          }


          .shown-count {
            margin-left:auto;
            font-size:11px;
            opacity:.55;
          }


          .export-button {
            padding:7px 11px;
            white-space:nowrap;
          }


          .area-group,
          .group-section {
            margin-top:10px;
            border:1px solid var(--divider-color);
            border-radius:9px;
            overflow:hidden;
            background:rgba(255,255,255,.015);
          }


          .area-group > summary,
          .group-section > summary {
            padding:10px 12px;
            list-style:none;
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:10px;
            user-select:none;
          }


          .area-group > summary::-webkit-details-marker,
          .group-section > summary::-webkit-details-marker {
            display:none;
          }


          .area-group > summary::before,
          .group-section > summary::before {
            content:"▶";
            font-size:9px;
            opacity:.55;
            transition:transform .12s ease;
          }


          .area-group[open] > summary::before,
          .group-section[open] > summary::before {
            transform:rotate(90deg);
          }


          .group-summary-title {
            flex:1;
          }


          .group-summary-count {
            font-size:10px;
            opacity:.55;
          }


          .group-device-list {
            padding:0 8px 4px;
            border-top:1px solid var(--divider-color);
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

            margin-bottom:
              24px;
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


          .rename-button {
            width:24px;
            height:24px;
            display:flex;
            align-items:center;
            justify-content:center;
            padding:0;
            border:1px solid transparent;
            border-radius:50%;
            background:transparent;
            color:var(--secondary-text-color);
            cursor:pointer;
          }


          .rename-button:hover {
            border-color:#00a8ff;
            color:#00a8ff;
            background:rgba(0,168,255,.08);
          }


          .rename-button ha-icon {
            --mdc-icon-size:15px;
          }


          .activity-line {
            display:flex;
            flex-wrap:wrap;
            gap:6px 10px;
            margin-top:5px;
            font-size:11px;
            line-height:1.4;
            opacity:.72;
          }


          .activity-offline {
            color:var(--warning-color,#ff9800);
            opacity:1;
          }


          .activity-source {
            opacity:.55;
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

            cursor:
              not-allowed;
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


          <div class="inventory-tools">

            <div class="tool-label">
              Sort
            </div>

            <select
              id="iot-sort-mode"
              class="tool-select"
            >
              <option
                value="name"
                ${this._sortMode === "name" ? "selected" : ""}
              >
                Name
              </option>

              <option
                value="ip"
                ${this._sortMode === "ip" ? "selected" : ""}
              >
                IP address
              </option>

              <option
                value="last_seen"
                ${this._sortMode === "last_seen" ? "selected" : ""}
              >
                Last seen
              </option>

              <option
                value="offline_longest"
                ${this._sortMode === "offline_longest" ? "selected" : ""}
              >
                Offline longest
              </option>
            </select>


            <div class="tool-label">
              Show
            </div>

            <select
              id="iot-offline-filter"
              class="tool-select"
            >
              <option
                value="all"
                ${this._offlineFilter === "all" ? "selected" : ""}
              >
                All devices
              </option>

              <option
                value="offline"
                ${this._offlineFilter === "offline" ? "selected" : ""}
              >
                Offline only
              </option>

              <option
                value="offline_7"
                ${this._offlineFilter === "offline_7" ? "selected" : ""}
              >
                Offline &gt; 7 days
              </option>

              <option
                value="offline_30"
                ${this._offlineFilter === "offline_30" ? "selected" : ""}
              >
                Offline &gt; 30 days
              </option>

              <option
                value="offline_90"
                ${this._offlineFilter === "offline_90" ? "selected" : ""}
              >
                Offline &gt; 90 days
              </option>
            </select>


            <button
              class="control-button export-button"
              id="iot-export-csv"
              title="Export complete IoT inventory as CSV"
            >
              Export CSV
            </button>


            <div class="shown-count">
              Showing ${shownCount} records
            </div>

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
                rawGroups.unassigned.length,
                "Unassigned"
              )
            }


            ${
              this._summaryBox(
                rawGroups.floating.length,
                "Floating"
              )
            }


            ${
              this._summaryBox(
                rawGroups.ignored.length,
                "Ignored"
              )
            }


            ${
              this._summaryBox(
                rawGroups.filtered.length,
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
            this._renderCollapsedSection(
              "Unassigned",
              groups.unassigned
            )
          }


          ${
            this._renderCollapsedSection(
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

            HA IoT Map Manager v0.11
            • Core v0.10

          </div>

        </div>

      </ha-card>
    `;

    this._attachHandlers();
  }


  _attachHandlers() {

    this.querySelector(
      "#iot-sort-mode"
    )?.addEventListener(
      "change",
      event => {
        this._sortMode =
          event.target.value;

        this._render();
      }
    );


    this.querySelector(
      "#iot-offline-filter"
    )?.addEventListener(
      "change",
      event => {
        this._offlineFilter =
          event.target.value;

        this._render();
      }
    );


    this.querySelector(
      "#iot-export-csv"
    )?.addEventListener(
      "click",
      () =>
        this._exportCsv()
    );


    for (
      const button
      of this.querySelectorAll(
        "[data-iot-rename]"
      )
    ) {
      button.addEventListener(
        "click",
        () => {
          const itemId =
            button.dataset.iotRename;

          const currentName =
            button.dataset.currentName ||
            "";

          const currentUserName =
            button.dataset.currentUserName ||
            "";

          this._changeFriendlyName(
            itemId,
            currentName,
            currentUserName
          );
        }
      );
    }


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


    const lastSeenText =
      this._formatTimestamp(
        device.lastSeenTs
      );


    const lastSeenAge =
      this._formatAge(
        device.lastSeenTs
      );


    const offlineSinceText =
      this._formatTimestamp(
        device.offlineSinceTs
      );


    const offlineAge =
      this._formatAge(
        device.offlineSinceTs
      );


    const sourceText =
      device.lastSeenSource?.startsWith(
        "reported:"
      )
        ? "device reported"
        : "HA state activity";


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


            ${
              this._core.isAdmin
                ? `
                  <button
                    class="rename-button"
                    data-iot-rename="${
                      this._escapeHtml(
                        device.id
                      )
                    }"
                    data-current-name="${
                      this._escapeHtml(
                        device.name ||
                        ""
                      )
                    }"
                    data-current-user-name="${
                      this._escapeHtml(
                        device.userName ||
                        ""
                      )
                    }"
                    title="Rename friendly display name"
                  >
                    <ha-icon
                      icon="mdi:pencil"
                    ></ha-icon>
                  </button>
                `
                : ""
            }


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


          <div
            class="
              activity-line
              ${
                device.online
                  ? ""
                  : "activity-offline"
              }
            "
          >

            ${
              device.online
                ? `
                  <span>
                    Last seen:
                    ${this._escapeHtml(
                      lastSeenText
                    )}
                    ${
                      lastSeenAge
                        ? `(${this._escapeHtml(
                            lastSeenAge
                          )})`
                        : ""
                    }
                  </span>
                `
                : `
                  <span>
                    Offline since:
                    ${this._escapeHtml(
                      offlineSinceText
                    )}
                    ${
                      offlineAge
                        ? `(${this._escapeHtml(
                            offlineAge
                          )})`
                        : ""
                    }
                  </span>

                  <span>
                    Last seen:
                    ${this._escapeHtml(
                      lastSeenText
                    )}
                    ${
                      lastSeenAge
                        ? `(${this._escapeHtml(
                            lastSeenAge
                          )})`
                        : ""
                    }
                  </span>
                `
            }

            ${
              Number.isFinite(
                device.lastSeenTs
              )
                ? `
                  <span class="activity-source">
                    ${this._escapeHtml(
                      sourceText
                    )}
                  </span>
                `
                : ""
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


  _renderAssigned(
    groups
  ) {

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

                    <details class="area-group">

                      <summary>

                        <span class="group-summary-title">
                          ${
                            this._escapeHtml(
                              area
                            )
                          }
                        </span>

                        <span class="group-summary-count">
                          ${devices.length}
                        </span>

                      </summary>


                      <div class="group-device-list">

                        ${
                          devices
                            .map(
                              device =>
                                this._renderDevice(
                                  device
                                )
                            )
                            .join("")
                        }

                      </div>

                    </details>

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
                  device =>
                    this._renderDevice(
                      device
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
      <div class="section">

        <details class="group-section">

          <summary>

            <span class="group-summary-title">
              ${
                this._escapeHtml(
                  title
                )
              }
            </span>

            <span class="group-summary-count">
              ${devices.length}
            </span>

          </summary>


          <div class="group-device-list">

            ${
              devices.length
                ? devices
                    .map(
                      device =>
                        this._renderDevice(
                          device
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


/*
 * Primary v0.9+ custom element.
 */
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
 * IMPORTANT:
 * Browsers do NOT allow the same constructor
 * to be registered under two custom-element
 * names.
 *
 * Therefore the old ha-iot-map name uses
 * a tiny subclass.
 */
class HaIotMapLegacy
  extends HaIotMapManager {
}


if (
  !customElements.get(
    "ha-iot-map"
  )
) {

  customElements.define(
    "ha-iot-map",
    HaIotMapLegacy
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
  "%c HA IoT Map Manager %c v0.11 ",
  "background:#03a9f4;color:white;font-weight:bold;",
  "background:#333;color:white;"
);
