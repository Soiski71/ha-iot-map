class HaIotMap extends HTMLElement {
  constructor() {
    super();

    this._hass = null;
    this._config = {};
    this._loaded = false;
    this._loading = false;
    this._savingArea = new Set();

    this._areas = [];
    this._devices = [];
    this._entities = [];

    this._autoUpdate = false;
    this._lastAutoRefresh = 0;
    this._autoRefreshInterval = 5000;

    this._classificationStorageKey =
      "ha_iot_map_classifications_v1";

    this._classifications =
      this._loadClassifications();
  }

  setConfig(config) {
    this._config = config || {};
  }

  set hass(hass) {
    this._hass = hass;

    if (!this._loaded && !this._loading) {
      this._loadRegistryData();
      return;
    }

    if (!this._loaded) return;
    if (!this._autoUpdate) return;

    const now = Date.now();

    if (
      now - this._lastAutoRefresh >=
      this._autoRefreshInterval
    ) {
      this._lastAutoRefresh = now;
      this._render();
    }
  }

  async _loadRegistryData() {
    if (!this._hass) return;

    this._loading = true;
    this._renderLoading();

    try {
      const [areas, devices, entities] =
        await Promise.all([
          this._hass.callWS({
            type: "config/area_registry/list",
          }),

          this._hass.callWS({
            type: "config/device_registry/list",
          }),

          this._hass.callWS({
            type: "config/entity_registry/list",
          }),
        ]);

      this._areas = areas || [];
      this._devices = devices || [];
      this._entities = entities || [];

      this._loaded = true;
      this._loading = false;
      this._lastAutoRefresh = Date.now();

      this._render();
    } catch (err) {
      console.error(
        "HA IoT Map: registry load failed",
        err
      );

      this._loading = false;

      this.innerHTML = `
        <ha-card header="HA IoT Map">
          <div style="
            padding:16px;
            color:var(--error-color)
          ">
            Registry loading failed.
            <br><br>
            ${this._escapeHtml(
              err?.message || String(err)
            )}
          </div>
        </ha-card>
      `;
    }
  }

  async _reloadRegistries() {
    try {
      const [areas, devices, entities] =
        await Promise.all([
          this._hass.callWS({
            type: "config/area_registry/list",
          }),

          this._hass.callWS({
            type: "config/device_registry/list",
          }),

          this._hass.callWS({
            type: "config/entity_registry/list",
          }),
        ]);

      this._areas = areas || [];
      this._devices = devices || [];
      this._entities = entities || [];

      this._lastAutoRefresh = Date.now();

      this._render();
    } catch (err) {
      console.error(
        "HA IoT Map: registry refresh failed",
        err
      );
    }
  }

  _loadClassifications() {
    try {
      const raw =
        localStorage.getItem(
          this._classificationStorageKey
        );

      if (!raw) return {};

      const parsed =
        JSON.parse(raw);

      return (
        parsed &&
        typeof parsed === "object"
      )
        ? parsed
        : {};
    } catch (err) {
      console.warn(
        "HA IoT Map: classification load failed",
        err
      );

      return {};
    }
  }

  _saveClassifications() {
    try {
      localStorage.setItem(
        this._classificationStorageKey,
        JSON.stringify(
          this._classifications
        )
      );
    } catch (err) {
      console.warn(
        "HA IoT Map: classification save failed",
        err
      );
    }
  }

  _getStoredClassification(item) {
    const stored =
      this._classifications[item.id];

    if (
      stored === "fixed" ||
      stored === "floating" ||
      stored === "ignored"
    ) {
      return stored;
    }

    return "auto";
  }

  _setClassification(itemId, value) {
    if (value === "auto") {
      delete this._classifications[itemId];
    } else if (
      value === "fixed" ||
      value === "floating" ||
      value === "ignored"
    ) {
      this._classifications[itemId] =
        value;
    } else {
      return;
    }

    this._saveClassifications();
    this._render();
  }

  _isPhysicalCandidate(item) {
    const platforms =
      (item.platforms || [])
        .map(p =>
          String(p).toLowerCase()
        );

    /*
     * Things we know are software objects,
     * not physical devices.
     */
    const softwareOnly =
      new Set([
        "hacs",
        "backup",
        "frontend",
      ]);

    /*
     * Known integrations that commonly
     * represent physical hardware.
     */
    const physicalPlatforms =
      new Set([
        "esphome",
        "mqtt",
        "shelly",
        "tradfri",
        "zha",
        "zigbee2mqtt",
        "tplink_router",
        "mobile_app",
        "cast",
        "homekit_controller",
        "bluetooth",
        "reolink",
        "frigate",
        "roborock",
        "tuya",
        "tasmota",
        "matter",
        "thread",
        "wled",
      ]);

    /*
     * Explicit software platform means
     * software unless there is strong
     * physical/network evidence.
     */
    const softwarePlatform =
      platforms.some(
        p => softwareOnly.has(p)
      );

    /*
     * Strong evidence of a real network
     * endpoint.
     */
    if (item.mac) return true;
    if (item.ip) return true;
    if (item.hostname) return true;
    if (item.trackerCount > 0) return true;

    /*
     * Known hardware integrations.
     */
    if (
      platforms.some(
        p =>
          physicalPlatforms.has(p)
      )
    ) {
      return true;
    }

    /*
     * Software-only objects are rejected.
     */
    if (softwarePlatform) {
      return false;
    }

    /*
     * Unknown/no-network/no-known-hardware
     * defaults to filtered.
     */
    return false;
  }

  _getEffectiveClassification(item) {
    const stored =
      this._getStoredClassification(item);

    if (stored !== "auto") {
      return stored;
    }

    if (!this._isPhysicalCandidate(item)) {
      return "filtered";
    }

    if (item.floating) {
      return "floating";
    }

    return "fixed";
  }

  _buildRawInventory() {
    const areaMap =
      new Map(
        this._areas.map(
          area => [
            area.area_id,
            area.name
          ]
        )
      );

    const entitiesByDevice =
      new Map();

    const standaloneEntities =
      [];

    for (const entity of this._entities) {
      if (entity.disabled_by) continue;

      if (entity.device_id) {
        if (
          !entitiesByDevice.has(
            entity.device_id
          )
        ) {
          entitiesByDevice.set(
            entity.device_id,
            []
          );
        }

        entitiesByDevice
          .get(entity.device_id)
          .push(entity);
      } else if (
        entity.entity_id?.startsWith(
          "device_tracker."
        )
      ) {
        standaloneEntities.push(
          entity
        );
      }
    }

    const inventory = [];

    for (const device of this._devices) {
      const deviceEntities =
        entitiesByDevice.get(
          device.id
        ) || [];

      if (
        deviceEntities.length === 0
      ) {
        continue;
      }

      const entityArea =
        deviceEntities.find(
          e => e.area_id
        )?.area_id || null;

      const areaId =
        device.area_id ||
        entityArea ||
        null;

      const platforms = [
        ...new Set(
          deviceEntities
            .map(e => e.platform)
            .filter(Boolean)
        ),
      ];

      const trackerEntities =
        deviceEntities.filter(
          e =>
            e.entity_id?.startsWith(
              "device_tracker."
            )
        );

      const stateInfo =
        this._getDeviceState(
          deviceEntities
        );

      const networkInfo =
        this._extractNetworkInfo(
          device,
          deviceEntities
        );

      inventory.push({
        id: device.id,

        sourceType:
          "device",

        registryDeviceId:
          device.id,

        registryEntityId:
          null,

        name:
          device.name_by_user ||
          device.name ||
          device.model ||
          "Unnamed device",

        areaId,

        areaName:
          areaId
            ? areaMap.get(areaId) ||
              areaId
            : null,

        floating:
          platforms.includes(
            "mobile_app"
          ),

        platforms,

        manufacturer:
          device.manufacturer ||
          null,

        model:
          device.model ||
          null,

        swVersion:
          device.sw_version ||
          null,

        mac:
          networkInfo.mac,

        ip:
          networkInfo.ip,

        hostname:
          networkInfo.hostname,

        online:
          stateInfo.online,

        entityCount:
          deviceEntities.length,

        trackerCount:
          trackerEntities.length,

        entityIds:
          deviceEntities.map(
            e => e.entity_id
          ),

        mergedItems: [],
      });
    }

    for (
      const entity
      of standaloneEntities
    ) {
      const state =
        this._hass.states[
          entity.entity_id
        ];

      if (!state) continue;

      const attrs =
        state.attributes || {};

      const areaId =
        entity.area_id || null;

      const platform =
        entity.platform ||
        "unknown";

      inventory.push({
        id:
          entity.entity_id,

        sourceType:
          "tracker",

        registryDeviceId:
          null,

        registryEntityId:
          entity.entity_id,

        name:
          attrs.friendly_name ||
          entity.original_name ||
          entity.entity_id,

        areaId,

        areaName:
          areaId
            ? areaMap.get(areaId) ||
              areaId
            : null,

        floating:
          platform ===
          "mobile_app",

        platforms: [
          platform
        ],

        manufacturer:
          attrs.manufacturer ||
          null,

        model:
          attrs.model ||
          null,

        swVersion:
          null,

        mac:
          attrs.mac ||
          attrs.mac_address ||
          null,

        ip:
          attrs.ip ||
          attrs.ip_address ||
          null,

        hostname:
          attrs.hostname ||
          attrs.host_name ||
          null,

        online:
          ![
            "not_home",
            "unavailable",
            "unknown"
          ].includes(
            state.state
          ),

        entityCount:
          1,

        trackerCount:
          1,

        entityIds: [
          entity.entity_id
        ],

        mergedItems:
          [],
      });
    }

    return inventory;
  }

  _normalizeMac(mac) {
    if (!mac) return null;

    const compact =
      String(mac)
        .trim()
        .toLowerCase()
        .replace(
          /[^0-9a-f]/g,
          ""
        );

    if (
      compact.length !== 12
    ) {
      return null;
    }

    return compact
      .match(/.{2}/g)
      .join(":");
  }

  _deduplicateInventory(
    rawInventory
  ) {
    const macGroups =
      new Map();

    const noMac =
      [];

    for (
      const item
      of rawInventory
    ) {
      const normalizedMac =
        this._normalizeMac(
          item.mac
        );

      if (!normalizedMac) {
        noMac.push(item);
        continue;
      }

      item.normalizedMac =
        normalizedMac;

      if (
        !macGroups.has(
          normalizedMac
        )
      ) {
        macGroups.set(
          normalizedMac,
          []
        );
      }

      macGroups
        .get(normalizedMac)
        .push(item);
    }

    const mergedInventory =
      [];

    const duplicateGroups =
      [];

    let mergedAwayCount =
      0;

    for (
      const [
        mac,
        items
      ]
      of macGroups.entries()
    ) {
      if (
        items.length === 1
      ) {
        mergedInventory.push(
          items[0]
        );

        continue;
      }

      const merged =
        this._mergeExactMacGroup(
          mac,
          items
        );

      mergedInventory.push(
        merged
      );

      duplicateGroups.push({
        mac,
        items,
        merged,
      });

      mergedAwayCount +=
        items.length - 1;
    }

    mergedInventory.push(
      ...noMac
    );

    return {
      inventory:
        mergedInventory,

      duplicateGroups,

      mergedAwayCount,
    };
  }

  _mergeExactMacGroup(
    mac,
    items
  ) {
    const preferred =
      items.find(
        item =>
          item.sourceType ===
          "device"
      ) || items[0];

    const assigned =
      items.find(
        item =>
          item.areaId
      ) || null;

    const allPlatforms = [
      ...new Set(
        items.flatMap(
          item =>
            item.platforms ||
            []
        )
      ),
    ];

    const allEntityIds = [
      ...new Set(
        items.flatMap(
          item =>
            item.entityIds ||
            []
        )
      ),
    ];

    return {
      ...preferred,

      id:
        `mac:${mac}`,

      name:
        this._chooseBestName(
          items
        ),

      mac,

      normalizedMac:
        mac,

      areaId:
        assigned?.areaId ||
        preferred.areaId ||
        null,

      areaName:
        assigned?.areaName ||
        preferred.areaName ||
        null,

      floating:
        assigned
          ? false
          : items.some(
              item =>
                item.floating
            ),

      platforms:
        allPlatforms,

      manufacturer:
        items.find(
          i => i.manufacturer
        )?.manufacturer ||
        null,

      model:
        items.find(
          i => i.model
        )?.model ||
        null,

      ip:
        items.find(
          i => i.ip
        )?.ip ||
        null,

      hostname:
        items.find(
          i => i.hostname
        )?.hostname ||
        null,

      online:
        items.some(
          item =>
            item.online
        ),

      entityCount:
        allEntityIds.length,

      trackerCount:
        items.reduce(
          (
            sum,
            item
          ) =>
            sum +
            (
              item.trackerCount ||
              0
            ),
          0
        ),

      entityIds:
        allEntityIds,

      mergedItems:
        items,
    };
  }

  _chooseBestName(items) {
    const badNamePatterns = [
      /^device_tracker\./i,
      /^unknown/i,
      /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i,
    ];

    const scored =
      items.map(
        item => {
          let score = 0;

          const name =
            item.name || "";

          if (
            item.sourceType ===
            "device"
          ) {
            score += 5;
          }

          if (item.areaId) {
            score += 3;
          }

          if (
            item.manufacturer
          ) {
            score += 2;
          }

          if (item.model) {
            score += 2;
          }

          if (
            !badNamePatterns.some(
              pattern =>
                pattern.test(name)
            )
          ) {
            score += 5;
          }

          return {
            item,
            score,
          };
        }
      );

    scored.sort(
      (a, b) =>
        b.score - a.score
    );

    return (
      scored[0]?.item?.name ||
      "Unnamed device"
    );
  }

  _getDeviceState(
    entities
  ) {
    let hasUsableEntity =
      false;

    let hasOnlineTracker =
      false;

    let hasTracker =
      false;

    for (
      const entity
      of entities
    ) {
      const state =
        this._hass.states[
          entity.entity_id
        ];

      if (!state) continue;

      if (
        entity.entity_id.startsWith(
          "device_tracker."
        )
      ) {
        hasTracker = true;

        if (
          state.state !==
            "not_home" &&
          state.state !==
            "unavailable" &&
          state.state !==
            "unknown"
        ) {
          hasOnlineTracker =
            true;
        }

        continue;
      }

      if (
        state.state !==
          "unavailable" &&
        state.state !==
          "unknown"
      ) {
        hasUsableEntity =
          true;
      }
    }

    if (hasTracker) {
      return {
        online:
          hasOnlineTracker,
      };
    }

    return {
      online:
        hasUsableEntity,
    };
  }

  _extractNetworkInfo(
    device,
    entities
  ) {
    let mac = null;
    let ip = null;
    let hostname = null;

    if (
      Array.isArray(
        device.connections
      )
    ) {
      for (
        const connection
        of device.connections
      ) {
        if (
          Array.isArray(
            connection
          ) &&
          connection.length >=
            2
        ) {
          const [
            type,
            value
          ] = connection;

          if (
            String(type)
              .toLowerCase() ===
            "mac"
          ) {
            mac = value;
          }
        }
      }
    }

    for (
      const entity
      of entities
    ) {
      const state =
        this._hass.states[
          entity.entity_id
        ];

      if (!state) continue;

      const attrs =
        state.attributes || {};

      mac =
        mac ||
        attrs.mac ||
        attrs.mac_address ||
        null;

      ip =
        ip ||
        attrs.ip ||
        attrs.ip_address ||
        null;

      hostname =
        hostname ||
        attrs.hostname ||
        attrs.host_name ||
        null;
    }

    return {
      mac,
      ip,
      hostname,
    };
  }

  _groupInventory(
    inventory
  ) {
    const groups = {
      areas:
        new Map(),

      unassigned:
        [],

      floating:
        [],

      ignored:
        [],

      filtered:
        [],
    };

    for (
      const item
      of inventory
    ) {
      const classification =
        this._getEffectiveClassification(
          item
        );

      if (
        classification ===
        "filtered"
      ) {
        groups.filtered.push(
          item
        );

        continue;
      }

      if (
        classification ===
        "ignored"
      ) {
        groups.ignored.push(
          item
        );

        continue;
      }

      if (
        classification ===
        "floating"
      ) {
        groups.floating.push(
          item
        );

        continue;
      }

      if (!item.areaId) {
        groups.unassigned.push(
          item
        );

        continue;
      }

      if (
        !groups.areas.has(
          item.areaName
        )
      ) {
        groups.areas.set(
          item.areaName,
          []
        );
      }

      groups.areas
        .get(item.areaName)
        .push(item);
    }

    const sorter =
      (a, b) =>
        a.name.localeCompare(
          b.name
        );

    for (
      const list
      of groups.areas.values()
    ) {
      list.sort(sorter);
    }

    groups.unassigned.sort(
      sorter
    );

    groups.floating.sort(
      sorter
    );

    groups.ignored.sort(
      sorter
    );

    groups.filtered.sort(
      sorter
    );

    return groups;
  }

  async _changeArea(
    itemId,
    areaId
  ) {
    const rawInventory =
      this._buildRawInventory();

    const dedupe =
      this._deduplicateInventory(
        rawInventory
      );

    const item =
      dedupe.inventory.find(
        device =>
          device.id ===
          itemId
      );

    if (!item) return;

    if (
      this._savingArea.has(
        item.id
      )
    ) {
      return;
    }

    this._savingArea.add(
      item.id
    );

    try {
      if (
        item.registryDeviceId
      ) {
        await this._hass.callWS({
          type:
            "config/device_registry/update",

          device_id:
            item.registryDeviceId,

          area_id:
            areaId || null,
        });
      } else if (
        item.registryEntityId
      ) {
        await this._hass.callWS({
          type:
            "config/entity_registry/update",

          entity_id:
            item.registryEntityId,

          area_id:
            areaId || null,
        });
      }

      await this._reloadRegistries();
    } catch (err) {
      console.error(
        "HA IoT Map: area update failed",
        item,
        err
      );

      alert(
        `Could not update Area for ${item.name}\n\n` +
        (
          err?.message ||
          String(err)
        )
      );
    } finally {
      this._savingArea.delete(
        item.id
      );
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
    await this._reloadRegistries();
  }

  _render() {
    if (
      !this._hass ||
      !this._loaded
    ) {
      return;
    }

    const rawInventory =
      this._buildRawInventory();

    const dedupeResult =
      this._deduplicateInventory(
        rawInventory
      );

    const inventory =
      dedupeResult.inventory;

    const groups =
      this._groupInventory(
        inventory
      );

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

    const multiSourceCount =
      inventory.filter(
        item =>
          new Set(
            item.platforms
          ).size > 1
      ).length;

    const standaloneTrackerCount =
      rawInventory.filter(
        item =>
          item.sourceType ===
          "tracker"
      ).length;

    this.innerHTML = `
      <ha-card>

        <style>

          .iot-wrap {
            padding: 18px;
          }

          .iot-header {
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:14px;
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

          .control-button {
            border:
              1px solid
              var(--divider-color);

            background:
              var(--secondary-background-color);

            color:
              var(--primary-text-color);

            border-radius:8px;
            padding:8px 12px;
            cursor:pointer;
            font-size:13px;
          }

          .auto-on {
            border-color:
              var(
                --success-color,
                #4caf50
              );
          }

          .auto-off {
            opacity:.75;
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
            margin-bottom:22px;
          }

          .summary-box {
            padding:12px;
            border-radius:10px;

            background:
              var(
                --secondary-background-color
              );
          }

          .summary-number {
            font-size:24px;
            font-weight:600;
          }

          .summary-label {
            opacity:.7;
            font-size:12px;
            margin-top:2px;
          }

          .section {
            margin-top:22px;
          }

          .section-title {
            font-size:18px;
            font-weight:600;
            margin-bottom:8px;
          }

          .area-title {
            font-size:15px;
            font-weight:600;
            margin:16px 0 6px 0;
            opacity:.85;
          }

          .device {
            display:grid;

            grid-template-columns:
              14px
              minmax(220px,1fr)
              minmax(150px,220px)
              minmax(180px,260px)
              minmax(120px,auto);

            gap:12px;
            align-items:center;
            padding:10px 8px;

            border-bottom:
              1px solid
              var(--divider-color);
          }

          .status {
            width:10px;
            height:10px;
            border-radius:50%;
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

          .device-name {
            font-weight:500;
          }

          .device-details {
            font-size:12px;
            opacity:.65;
            margin-top:3px;
            line-height:1.4;
          }

          .source {
            font-size:11px;
            opacity:.6;
            text-align:right;
          }

          .select-control {
            width:100%;
            box-sizing:border-box;
            padding:7px 9px;
            border-radius:7px;

            border:
              1px solid
              var(--divider-color);

            background:
              var(
                --card-background-color
              );

            color:
              var(
                --primary-text-color
              );
          }

          .area-select.unassigned {
            border-color:
              var(
                --warning-color,
                #ff9800
              );
          }

          .classification-ignored {
            border-color:
              var(
                --error-color,
                #f44336
              );
          }

          .classification-floating {
            border-color:
              var(
                --info-color,
                #2196f3
              );
          }

          .classification-auto {
            opacity:.8;
          }

          .empty {
            opacity:.55;
            font-style:italic;
            padding:8px;
          }

          details {
            margin-top:8px;
          }

          summary {
            cursor:pointer;
            font-weight:600;
          }

          .special-section {
            margin-top:24px;
            padding-top:12px;

            border-top:
              1px solid
              var(--divider-color);
          }

          .filtered-note {
            font-size:12px;
            opacity:.65;
            padding:8px 0 4px 0;
          }

          @media (
            max-width:900px
          ) {
            .iot-header {
              align-items:flex-start;
              flex-direction:column;
            }

            .device {
              grid-template-columns:
                14px
                minmax(
                  120px,
                  1fr
                );
            }

            .classification-control,
            .area-control {
              grid-column:2;
            }

            .source {
              display:none;
            }
          }

        </style>

        <div class="iot-wrap">

          <div class="iot-header">

            <div class="iot-title">
              HA IoT Map
            </div>

            <div class="controls">

              <button
                class="
                  control-button
                  ${
                    this._autoUpdate
                      ? "auto-on"
                      : "auto-off"
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

          <div class="summary">

            ${this._summaryBox(
              visibleCount,
              "IoT devices"
            )}

            ${this._summaryBox(
              assignedCount,
              "Assigned"
            )}

            ${this._summaryBox(
              groups.unassigned.length,
              "Unassigned"
            )}

            ${this._summaryBox(
              groups.floating.length,
              "Floating"
            )}

            ${this._summaryBox(
              groups.ignored.length,
              "Ignored"
            )}

            ${this._summaryBox(
              groups.filtered.length,
              "Filtered software"
            )}

            ${this._summaryBox(
              dedupeResult.mergedAwayCount,
              "Duplicates merged"
            )}

            ${this._summaryBox(
              multiSourceCount,
              "Multi-source"
            )}

          </div>

          ${this._renderAssigned(
            groups
          )}

          ${this._renderSection(
            "Unassigned",
            groups.unassigned
          )}

          ${this._renderSection(
            "Floating / Mobile",
            groups.floating
          )}

          ${this._renderIgnoredSection(
            groups.ignored
          )}

          ${this._renderFilteredSection(
            groups.filtered
          )}

          <div class="special-section">

            <details>

              <summary>
                Discovery diagnostics
              </summary>

              <div
                style="
                  padding-top:10px;
                  opacity:.7;
                  font-size:12px;
                  line-height:1.6;
                "
              >
                Raw HA records:
                ${rawInventory.length}

                <br>

                After MAC deduplication:
                ${inventory.length}

                <br>

                Standalone trackers:
                ${standaloneTrackerCount}

                <br>

                Auto-filtered software:
                ${groups.filtered.length}

              </div>

            </details>

          </div>

          <div
            style="
              margin-top:20px;
              opacity:.45;
              font-size:11px;
            "
          >
            HA IoT Map v0.6
            • HA ${
              this._escapeHtml(
                this._hass.config
                  .version || ""
              )
            }
          </div>

        </div>

      </ha-card>
    `;

    this._attachHandlers();
  }

  _attachHandlers() {
    const areaSelects =
      this.querySelectorAll(
        "select[data-iot-area]"
      );

    for (
      const select
      of areaSelects
    ) {
      select.addEventListener(
        "change",
        event => {
          const itemId =
            event.target.dataset
              .iotArea;

          const areaId =
            event.target.value;

          event.target.disabled =
            true;

          this._changeArea(
            itemId,
            areaId
          );
        }
      );
    }

    const classSelects =
      this.querySelectorAll(
        "select[data-iot-classification]"
      );

    for (
      const select
      of classSelects
    ) {
      select.addEventListener(
        "change",
        event => {
          const itemId =
            event.target.dataset
              .iotClassification;

          const value =
            event.target.value;

          this._setClassification(
            itemId,
            value
          );
        }
      );
    }

    const autoButton =
      this.querySelector(
        "#iot-auto-update"
      );

    if (autoButton) {
      autoButton.addEventListener(
        "click",
        () =>
          this._toggleAutoUpdate()
      );
    }

    const refreshButton =
      this.querySelector(
        "#iot-refresh-now"
      );

    if (refreshButton) {
      refreshButton.addEventListener(
        "click",
        () =>
          this._manualRefresh()
      );
    }
  }

  _renderAssigned(groups) {
    const areas =
      [
        ...groups.areas.entries()
      ].sort(
        (a, b) =>
          a[0].localeCompare(
            b[0]
          )
      );

    if (
      areas.length === 0
    ) {
      return `
        <div class="section">

          <div class="section-title">
            Assigned
          </div>

          <div class="empty">
            No assigned devices found.
          </div>

        </div>
      `;
    }

    return `
      <div class="section">

        <div class="section-title">
          Assigned
        </div>

        ${areas.map(
          ([
            areaName,
            devices
          ]) => `

            <div class="area-title">
              ${this._escapeHtml(
                areaName
              )}
            </div>

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

          `
        ).join("")}

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
          ${this._escapeHtml(
            title
          )}
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

  _renderIgnoredSection(
    devices
  ) {
    return `
      <div class="special-section">

        <details>

          <summary>
            Ignored devices
            (${devices.length})
          </summary>

          <div style="padding-top:8px">

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
                    Nothing ignored.
                  </div>
                `
            }

          </div>

        </details>

      </div>
    `;
  }

  _renderFilteredSection(
    devices
  ) {
    return `
      <div class="special-section">

        <details>

          <summary>
            Filtered / software-only
            (${devices.length})
          </summary>

          <div class="filtered-note">
            These objects were automatically
            filtered because they do not look
            like physical IoT/network devices.
            Set one to Fixed or Floating to
            force it into the main inventory.
          </div>

          <div>

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
                    Nothing filtered.
                  </div>
                `
            }

          </div>

        </details>

      </div>
    `;
  }

  _renderClassificationSelector(
    device
  ) {
    const stored =
      this._getStoredClassification(
        device
      );

    return `
      <select
        class="
          select-control
          ${
            stored === "ignored"
              ? "classification-ignored"
              : stored === "floating"
                ? "classification-floating"
                : stored === "auto"
                  ? "classification-auto"
                  : ""
          }
        "
        data-iot-classification="${
          this._escapeHtml(
            device.id
          )
        }"
      >

        <option
          value="auto"
          ${
            stored === "auto"
              ? "selected"
              : ""
          }
        >
          Auto
        </option>

        <option
          value="fixed"
          ${
            stored === "fixed"
              ? "selected"
              : ""
          }
        >
          Fixed
        </option>

        <option
          value="floating"
          ${
            stored === "floating"
              ? "selected"
              : ""
          }
        >
          Floating
        </option>

        <option
          value="ignored"
          ${
            stored === "ignored"
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
      [...this._areas]
        .sort(
          (a, b) =>
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

        ${sortedAreas.map(
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
              ${this._escapeHtml(
                area.name
              )}
            </option>
          `
        ).join("")}

      </select>
    `;
  }

  _renderDevice(device) {
    const networkParts =
      [];

    if (device.ip) {
      networkParts.push(
        this._escapeHtml(
          device.ip
        )
      );
    }

    if (device.mac) {
      networkParts.push(
        this._escapeHtml(
          device.mac
        )
      );
    }

    if (device.hostname) {
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

    if (device.model) {
      hardwareParts.push(
        this._escapeHtml(
          device.model
        )
      );
    }

    const details =
      [];

    if (
      networkParts.length
    ) {
      details.push(
        networkParts.join(
          " • "
        )
      );
    }

    if (
      hardwareParts.length
    ) {
      details.push(
        hardwareParts.join(
          " "
        )
      );
    }

    details.push(
      `${
        device.entityCount
      } entit${
        device.entityCount ===
        1
          ? "y"
          : "ies"
      }`
    );

    const source =
      device.platforms.length
        ? device.platforms.join(
            ", "
          )
        : "unknown";

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
          title="${
            device.online
              ? "Online"
              : "Offline"
          }"
        ></div>

        <div>

          <div class="device-name">
            ${this._escapeHtml(
              device.name
            )}
          </div>

          <div class="device-details">
            ${details.join(
              "<br>"
            )}
          </div>

        </div>

        <div class="classification-control">
          ${
            this._renderClassificationSelector(
              device
            )
          }
        </div>

        <div class="area-control">
          ${
            this._renderAreaSelector(
              device
            )
          }
        </div>

        <div class="source">
          ${this._escapeHtml(
            source
          )}
        </div>

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
          ${this._escapeHtml(
            label
          )}
        </div>

      </div>
    `;
  }

  _renderLoading() {
    this.innerHTML = `
      <ha-card header="HA IoT Map">

        <div style="padding:16px">
          Reading Home Assistant
          registries...
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
      min_columns: 6,
    };
  }
}

if (
  !customElements.get(
    "ha-iot-map"
  )
) {
  customElements.define(
    "ha-iot-map",
    HaIotMap
  );
}

window.customCards =
  window.customCards ||
  [];

if (
  !window.customCards.some(
    card =>
      card.type ===
      "ha-iot-map"
  )
) {
  window.customCards.push({
    type:
      "ha-iot-map",

    name:
      "HA IoT Map",

    description:
      "Automatic visual IoT inventory and floor map for Home Assistant",
  });
}

console.info(
  "%c HA IoT Map %c v0.6 ",
  "background:#03a9f4;color:white;font-weight:bold;",
  "background:#333;color:white;"
);
