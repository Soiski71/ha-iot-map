class HaIotMap extends HTMLElement {
  constructor() {
    super();

    this._hass = null;
    this._config = {};
    this._loaded = false;
    this._loading = false;

    this._areas = [];
    this._devices = [];
    this._entities = [];
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

    if (this._loaded) {
      this._render();
    }
  }

  async _loadRegistryData() {
    if (!this._hass) return;

    this._loading = true;
    this._renderLoading();

    try {
      const [areas, devices, entities] = await Promise.all([
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

      this._render();
    } catch (err) {
      console.error("HA IoT Map: registry load failed", err);

      this._loading = false;

      this.innerHTML = `
        <ha-card header="HA IoT Map">
          <div style="padding:16px;color:var(--error-color)">
            Registry loading failed.
            <br><br>
            ${this._escapeHtml(err?.message || String(err))}
          </div>
        </ha-card>
      `;
    }
  }

  _buildRawInventory() {
    const areaMap = new Map(
      this._areas.map(area => [area.area_id, area.name])
    );

    const entitiesByDevice = new Map();
    const standaloneEntities = [];

    for (const entity of this._entities) {
      if (entity.disabled_by) continue;

      if (entity.device_id) {
        if (!entitiesByDevice.has(entity.device_id)) {
          entitiesByDevice.set(entity.device_id, []);
        }

        entitiesByDevice.get(entity.device_id).push(entity);
      } else if (entity.entity_id?.startsWith("device_tracker.")) {
        standaloneEntities.push(entity);
      }
    }

    const inventory = [];

    // HA Device Registry devices
    for (const device of this._devices) {
      const deviceEntities = entitiesByDevice.get(device.id) || [];

      if (deviceEntities.length === 0) continue;

      const areaId =
        device.area_id ||
        deviceEntities.find(e => e.area_id)?.area_id ||
        null;

      const platforms = [
        ...new Set(
          deviceEntities
            .map(e => e.platform)
            .filter(Boolean)
        ),
      ];

      const trackerEntities = deviceEntities.filter(e =>
        e.entity_id?.startsWith("device_tracker.")
      );

      const stateInfo = this._getDeviceState(deviceEntities);

      const networkInfo =
        this._extractNetworkInfo(device, deviceEntities);

      inventory.push({
        id: device.id,
        sourceType: "device",

        name:
          device.name_by_user ||
          device.name ||
          device.model ||
          "Unnamed device",

        areaId,

        areaName: areaId
          ? areaMap.get(areaId) || areaId
          : null,

        floating:
          platforms.includes("mobile_app"),

        platforms,

        manufacturer:
          device.manufacturer || null,

        model:
          device.model || null,

        swVersion:
          device.sw_version || null,

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
          deviceEntities.map(e => e.entity_id),

        mergedItems: [],
      });
    }

    // Standalone device_tracker entities
    for (const entity of standaloneEntities) {
      const state = this._hass.states[entity.entity_id];

      if (!state) continue;

      const attrs = state.attributes || {};
      const areaId = entity.area_id || null;
      const platform = entity.platform || "unknown";

      inventory.push({
        id: entity.entity_id,
        sourceType: "tracker",

        name:
          attrs.friendly_name ||
          entity.original_name ||
          entity.entity_id,

        areaId,

        areaName: areaId
          ? areaMap.get(areaId) || areaId
          : null,

        floating:
          platform === "mobile_app",

        platforms: [platform],

        manufacturer:
          attrs.manufacturer || null,

        model:
          attrs.model || null,

        swVersion: null,

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
          ].includes(state.state),

        entityCount: 1,
        trackerCount: 1,

        entityIds: [entity.entity_id],

        mergedItems: [],
      });
    }

    return inventory;
  }

  _normalizeMac(mac) {
    if (!mac) return null;

    const compact = String(mac)
      .trim()
      .toLowerCase()
      .replace(/[^0-9a-f]/g, "");

    if (compact.length !== 12) return null;

    return compact.match(/.{2}/g).join(":");
  }

  _deduplicateInventory(rawInventory) {
    const macGroups = new Map();
    const noMac = [];

    for (const item of rawInventory) {
      const normalizedMac = this._normalizeMac(item.mac);

      if (!normalizedMac) {
        noMac.push(item);
        continue;
      }

      item.normalizedMac = normalizedMac;

      if (!macGroups.has(normalizedMac)) {
        macGroups.set(normalizedMac, []);
      }

      macGroups.get(normalizedMac).push(item);
    }

    const mergedInventory = [];
    const duplicateGroups = [];
    let mergedAwayCount = 0;

    for (const [mac, items] of macGroups.entries()) {
      if (items.length === 1) {
        mergedInventory.push(items[0]);
        continue;
      }

      const merged = this._mergeExactMacGroup(mac, items);

      mergedInventory.push(merged);

      duplicateGroups.push({
        mac,
        items,
        merged,
      });

      mergedAwayCount += items.length - 1;
    }

    mergedInventory.push(...noMac);

    return {
      inventory: mergedInventory,
      duplicateGroups,
      mergedAwayCount,
    };
  }

  _mergeExactMacGroup(mac, items) {
    const preferred =
      items.find(item => item.sourceType === "device") ||
      items[0];

    const assigned =
      items.find(item => item.areaId) ||
      null;

    const allPlatforms = [
      ...new Set(
        items.flatMap(item => item.platforms || [])
      ),
    ];

    const allEntityIds = [
      ...new Set(
        items.flatMap(item => item.entityIds || [])
      ),
    ];

    const bestName = this._chooseBestName(items);

    const ips = [
      ...new Set(
        items
          .map(item => item.ip)
          .filter(Boolean)
      ),
    ];

    const hostnames = [
      ...new Set(
        items
          .map(item => item.hostname)
          .filter(Boolean)
      ),
    ];

    const manufacturers = [
      ...new Set(
        items
          .map(item => item.manufacturer)
          .filter(Boolean)
      ),
    ];

    const models = [
      ...new Set(
        items
          .map(item => item.model)
          .filter(Boolean)
      ),
    ];

    return {
      ...preferred,

      id: `mac:${mac}`,

      name: bestName,

      mac,

      normalizedMac: mac,

      areaId:
        assigned?.areaId ||
        preferred.areaId ||
        null,

      areaName:
        assigned?.areaName ||
        preferred.areaName ||
        null,

      // If it has a fixed HA Area, don't classify it as floating.
      floating:
        assigned
          ? false
          : items.some(item => item.floating),

      platforms: allPlatforms,

      manufacturer:
        manufacturers[0] || null,

      model:
        models[0] || null,

      ip:
        ips[0] || null,

      hostname:
        hostnames[0] || null,

      online:
        items.some(item => item.online),

      entityCount:
        allEntityIds.length,

      trackerCount:
        items.reduce(
          (sum, item) => sum + (item.trackerCount || 0),
          0
        ),

      entityIds: allEntityIds,

      mergedItems: items,

      duplicateInfo: {
        reason: "Exact MAC match",
        sourceCount: items.length,
        ips,
        hostnames,
      },
    };
  }

  _chooseBestName(items) {
    const badNamePatterns = [
      /^device_tracker\./i,
      /^unknown/i,
      /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i,
    ];

    const scored = items.map(item => {
      let score = 0;
      const name = item.name || "";

      if (item.sourceType === "device") score += 5;
      if (item.areaId) score += 3;
      if (item.manufacturer) score += 2;
      if (item.model) score += 2;

      if (
        !badNamePatterns.some(pattern =>
          pattern.test(name)
        )
      ) {
        score += 5;
      }

      if (
        item.platforms?.some(p =>
          ["esphome", "mqtt", "shelly", "tradfri"].includes(p)
        )
      ) {
        score += 2;
      }

      return {
        item,
        score,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored[0]?.item?.name || "Unnamed device";
  }

  _getDeviceState(entities) {
    let hasUsableEntity = false;
    let hasOnlineTracker = false;
    let hasTracker = false;

    for (const entity of entities) {
      const state = this._hass.states[entity.entity_id];

      if (!state) continue;

      if (entity.entity_id.startsWith("device_tracker.")) {
        hasTracker = true;

        if (
          state.state !== "not_home" &&
          state.state !== "unavailable" &&
          state.state !== "unknown"
        ) {
          hasOnlineTracker = true;
        }

        continue;
      }

      if (
        state.state !== "unavailable" &&
        state.state !== "unknown"
      ) {
        hasUsableEntity = true;
      }
    }

    if (hasTracker) {
      return {
        online: hasOnlineTracker,
      };
    }

    return {
      online: hasUsableEntity,
    };
  }

  _extractNetworkInfo(device, entities) {
    let mac = null;
    let ip = null;
    let hostname = null;

    if (Array.isArray(device.connections)) {
      for (const connection of device.connections) {
        if (
          Array.isArray(connection) &&
          connection.length >= 2
        ) {
          const [type, value] = connection;

          if (
            String(type).toLowerCase() === "mac"
          ) {
            mac = value;
          }
        }
      }
    }

    for (const entity of entities) {
      const state = this._hass.states[entity.entity_id];

      if (!state) continue;

      const attrs = state.attributes || {};

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

  _groupInventory(inventory) {
    const groups = {
      areas: new Map(),
      unassigned: [],
      floating: [],
    };

    for (const item of inventory) {
      if (item.floating) {
        groups.floating.push(item);
        continue;
      }

      if (!item.areaId) {
        groups.unassigned.push(item);
        continue;
      }

      if (!groups.areas.has(item.areaName)) {
        groups.areas.set(item.areaName, []);
      }

      groups.areas.get(item.areaName).push(item);
    }

    for (const list of groups.areas.values()) {
      list.sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    }

    groups.unassigned.sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    groups.floating.sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return groups;
  }

  _render() {
    if (!this._hass || !this._loaded) return;

    const rawInventory = this._buildRawInventory();

    const dedupeResult =
      this._deduplicateInventory(rawInventory);

    const inventory =
      dedupeResult.inventory;

    const duplicateGroups =
      dedupeResult.duplicateGroups;

    const mergedAwayCount =
      dedupeResult.mergedAwayCount;

    const groups =
      this._groupInventory(inventory);

    const assignedCount =
      [...groups.areas.values()]
        .reduce(
          (total, list) =>
            total + list.length,
          0
        );

    this.innerHTML = `
      <ha-card>
        <style>
          .iot-wrap {
            padding: 18px;
          }

          .iot-title {
            font-size: 24px;
            font-weight: 500;
            margin-bottom: 16px;
          }

          .summary {
            display: grid;
            grid-template-columns:
              repeat(auto-fit, minmax(120px, 1fr));
            gap: 8px;
            margin-bottom: 22px;
          }

          .summary-box {
            padding: 12px;
            border-radius: 10px;
            background:
              var(--secondary-background-color);
          }

          .summary-number {
            font-size: 24px;
            font-weight: 600;
          }

          .summary-label {
            opacity: .7;
            font-size: 12px;
            margin-top: 2px;
          }

          .section {
            margin-top: 22px;
          }

          .section-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
          }

          .area-title {
            font-size: 15px;
            font-weight: 600;
            margin: 16px 0 6px 0;
            opacity: .85;
          }

          .device {
            display: grid;
            grid-template-columns:
              14px minmax(150px, 1fr) auto;
            gap: 10px;
            align-items: center;
            padding: 10px 8px;
            border-bottom:
              1px solid var(--divider-color);
          }

          .status {
            width: 10px;
            height: 10px;
            border-radius: 50%;
          }

          .online {
            background:
              var(--success-color, #4caf50);
          }

          .offline {
            background:
              var(--disabled-text-color);
          }

          .device-name {
            font-weight: 500;
          }

          .device-details {
            font-size: 12px;
            opacity: .65;
            margin-top: 3px;
            line-height: 1.4;
          }

          .source {
            font-size: 11px;
            opacity: .6;
            text-align: right;
          }

          .merge-badge {
            display: inline-block;
            font-size: 10px;
            margin-left: 8px;
            padding: 2px 6px;
            border-radius: 8px;
            background:
              var(--secondary-background-color);
            opacity: .8;
          }

          .empty {
            opacity: .55;
            font-style: italic;
            padding: 8px;
          }

          .diagnostics {
            margin-top: 24px;
            padding-top: 12px;
            border-top:
              1px solid var(--divider-color);
          }

          details {
            margin-top: 8px;
          }

          summary {
            cursor: pointer;
            font-weight: 600;
          }

          .dup-group {
            margin-top: 12px;
            padding: 10px;
            border-radius: 8px;
            background:
              var(--secondary-background-color);
          }

          .dup-mac {
            font-family: monospace;
            font-weight: 600;
            margin-bottom: 6px;
          }

          .dup-item {
            font-size: 12px;
            opacity: .8;
            margin: 4px 0;
          }

          @media (max-width: 600px) {
            .source {
              display: none;
            }

            .device {
              grid-template-columns:
                14px minmax(100px, 1fr);
            }
          }
        </style>

        <div class="iot-wrap">

          <div class="iot-title">
            HA IoT Map
          </div>

          <div class="summary">

            ${this._summaryBox(
              inventory.length,
              "Physical devices"
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
              mergedAwayCount,
              "Duplicates merged"
            )}

          </div>

          ${this._renderAssigned(groups)}

          ${this._renderSection(
            "Unassigned",
            groups.unassigned
          )}

          ${this._renderSection(
            "Floating / Mobile",
            groups.floating
          )}

          ${this._renderDuplicateDiagnostics(
            rawInventory,
            inventory,
            duplicateGroups,
            mergedAwayCount
          )}

          <div
            style="
              margin-top:20px;
              opacity:.45;
              font-size:11px;
            "
          >
            HA IoT Map v0.2
            • HA ${this._escapeHtml(
              this._hass.config.version || ""
            )}
          </div>

        </div>
      </ha-card>
    `;
  }

  _renderAssigned(groups) {
    const areas =
      [...groups.areas.entries()]
        .sort((a, b) =>
          a[0].localeCompare(b[0])
        );

    if (areas.length === 0) {
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

        ${areas.map(([areaName, devices]) => `
          <div class="area-title">
            ${this._escapeHtml(areaName)}
          </div>

          ${devices
            .map(device =>
              this._renderDevice(device)
            )
            .join("")}

        `).join("")}

      </div>
    `;
  }

  _renderSection(title, devices) {
    return `
      <div class="section">

        <div class="section-title">
          ${this._escapeHtml(title)}
        </div>

        ${
          devices.length
            ? devices
                .map(device =>
                  this._renderDevice(device)
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

  _renderDevice(device) {
    const networkParts = [];

    if (device.ip) {
      networkParts.push(
        this._escapeHtml(device.ip)
      );
    }

    if (device.mac) {
      networkParts.push(
        this._escapeHtml(device.mac)
      );
    }

    if (device.hostname) {
      networkParts.push(
        this._escapeHtml(device.hostname)
      );
    }

    const hardwareParts = [];

    if (device.manufacturer) {
      hardwareParts.push(
        this._escapeHtml(device.manufacturer)
      );
    }

    if (device.model) {
      hardwareParts.push(
        this._escapeHtml(device.model)
      );
    }

    const details = [];

    if (networkParts.length) {
      details.push(
        networkParts.join(" • ")
      );
    }

    if (hardwareParts.length) {
      details.push(
        hardwareParts.join(" ")
      );
    }

    details.push(
      `${device.entityCount} entit${
        device.entityCount === 1 ? "y" : "ies"
      }`
    );

    const source =
      device.platforms.length
        ? device.platforms.join(", ")
        : "unknown";

    const mergeBadge =
      device.mergedItems?.length > 1
        ? `
          <span class="merge-badge">
            ${device.mergedItems.length} records merged
          </span>
        `
        : "";

    return `
      <div class="device">

        <div
          class="
            status
            ${device.online ? "online" : "offline"}
          "
          title="${
            device.online ? "Online" : "Offline"
          }"
        ></div>

        <div>

          <div class="device-name">
            ${this._escapeHtml(device.name)}
            ${mergeBadge}
          </div>

          <div class="device-details">
            ${details.join("<br>")}
          </div>

        </div>

        <div class="source">
          ${this._escapeHtml(source)}
        </div>

      </div>
    `;
  }

  _renderDuplicateDiagnostics(
    rawInventory,
    inventory,
    duplicateGroups,
    mergedAwayCount
  ) {
    if (!duplicateGroups.length) {
      return `
        <div class="diagnostics">
          <details>
            <summary>
              Duplicate diagnostics
            </summary>

            <div style="padding:10px 0;opacity:.7">
              No exact-MAC duplicates found.
              Raw records: ${rawInventory.length}.
            </div>
          </details>
        </div>
      `;
    }

    return `
      <div class="diagnostics">

        <details>

          <summary>
            Duplicate diagnostics
            (${duplicateGroups.length} groups,
            ${mergedAwayCount} records removed)
          </summary>

          <div style="padding-top:8px;opacity:.7;font-size:12px">
            Raw records:
            ${rawInventory.length}
            • Physical devices:
            ${inventory.length}
          </div>

          ${duplicateGroups.map(group => `
            <div class="dup-group">

              <div class="dup-mac">
                ${this._escapeHtml(group.mac)}
              </div>

              <div style="font-size:12px;margin-bottom:6px">
                Exact MAC match
                • ${group.items.length} records
                → ${this._escapeHtml(group.merged.name)}
              </div>

              ${group.items.map(item => `
                <div class="dup-item">
                  <strong>
                    ${this._escapeHtml(item.name)}
                  </strong>
                  • ${this._escapeHtml(
                    item.sourceType
                  )}
                  • ${this._escapeHtml(
                    item.platforms.join(", ")
                  )}
                  ${
                    item.ip
                      ? ` • ${this._escapeHtml(item.ip)}`
                      : ""
                  }
                  ${
                    item.areaName
                      ? ` • Area: ${this._escapeHtml(item.areaName)}`
                      : ""
                  }
                </div>
              `).join("")}

            </div>
          `).join("")}

        </details>

      </div>
    `;
  }

  _summaryBox(number, label) {
    return `
      <div class="summary-box">

        <div class="summary-number">
          ${number}
        </div>

        <div class="summary-label">
          ${this._escapeHtml(label)}
        </div>

      </div>
    `;
  }

  _renderLoading() {
    this.innerHTML = `
      <ha-card header="HA IoT Map">
        <div style="padding:16px">
          Reading Home Assistant registries...
        </div>
      </ha-card>
    `;
  }

  _escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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

if (!customElements.get("ha-iot-map")) {
  customElements.define(
    "ha-iot-map",
    HaIotMap
  );
}

window.customCards =
  window.customCards || [];

if (
  !window.customCards.some(
    card => card.type === "ha-iot-map"
  )
) {
  window.customCards.push({
    type: "ha-iot-map",
    name: "HA IoT Map",
    description:
      "Automatic visual IoT inventory and floor map for Home Assistant",
  });
}

console.info(
  "%c HA IoT Map %c v0.2 ",
  "background:#03a9f4;color:white;font-weight:bold;",
  "background:#333;color:white;"
);
