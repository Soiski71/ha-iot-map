class HaIotMap extends HTMLElement {
  constructor() {
    super();

    this._hass = null;
    this._config = {};
    this._loaded = false;
    this._loading = false;
    this._savingArea = new Set();
    this._savingClass = new Set();

    this._areas = [];
    this._devices = [];
    this._entities = [];
    this._labels = [];

    this._autoUpdate = false;
    this._lastAutoRefresh = 0;
    this._autoRefreshInterval = 5000;

    this._legacyStorageKey = "ha_iot_map_classifications_v1";
    this._migrationStorageKey = "ha_iot_map_labels_migrated_v07";

    this._labelDefs = {
      fixed:    { name: "IoT Fixed",    icon: "mdi:map-marker" },
      floating: { name: "IoT Floating", icon: "mdi:access-point-network" },
      ignored:  { name: "IoT Ignored",  icon: "mdi:eye-off" },
    };

    this._labelIds = {
      fixed: null,
      floating: null,
      ignored: null,
    };

    this._setupError = null;
    this._setupMessage = null;
  }

  setConfig(config) {
    this._config = config || {};
  }

  set hass(hass) {
    this._hass = hass;

    if (!this._loaded && !this._loading) {
      this._loadAll();
      return;
    }

    if (!this._loaded || !this._autoUpdate) return;

    const now = Date.now();

    if (
      now - this._lastAutoRefresh >=
      this._autoRefreshInterval
    ) {
      this._lastAutoRefresh = now;
      this._render();
    }
  }

  get _isAdmin() {
    return !!this._hass?.user?.is_admin;
  }

  async _loadAll() {
    if (!this._hass) return;

    this._loading = true;
    this._renderLoading();

    try {
      await this._reloadRegistries(false);
      await this._ensureSharedLabels();
      await this._migrateLegacyClassifications();

      this._loaded = true;
      this._loading = false;
      this._lastAutoRefresh = Date.now();

      this._render();
    } catch (err) {
      console.error("HA IoT Map: initial load failed", err);

      this._loading = false;
      this._setupError =
        err?.message || String(err);

      this.innerHTML = `
        <ha-card header="HA IoT Map">
          <div style="
            padding:16px;
            color:var(--error-color)
          ">
            HA IoT Map failed to initialize.
            <br><br>
            ${this._escapeHtml(this._setupError)}
          </div>
        </ha-card>
      `;
    }
  }

  async _reloadRegistries(renderAfter = true) {
    const [areas, devices, entities, labels] =
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

        this._hass.callWS({
          type: "config/label_registry/list",
        }),
      ]);

    this._areas = areas || [];
    this._devices = devices || [];
    this._entities = entities || [];
    this._labels = labels || [];

    this._resolveLabelIds();
    this._lastAutoRefresh = Date.now();

    if (
      renderAfter &&
      this._loaded
    ) {
      this._render();
    }
  }

  _resolveLabelIds() {
    for (
      const key
      of Object.keys(this._labelDefs)
    ) {
      const wanted =
        this._labelDefs[key]
          .name
          .toLowerCase();

      const match =
        this._labels.find(
          label =>
            String(label.name || "")
              .trim()
              .toLowerCase() ===
            wanted
        );

      this._labelIds[key] =
        match?.label_id ||
        match?.id ||
        null;
    }
  }

  async _ensureSharedLabels() {
    this._resolveLabelIds();

    const missing =
      Object.entries(
        this._labelIds
      )
        .filter(
          ([, id]) =>
            !id
        )
        .map(
          ([key]) =>
            key
        );

    if (!missing.length) {
      this._setupMessage =
        "Shared classification labels ready";
      return;
    }

    if (!this._isAdmin) {
      this._setupMessage =
        "Shared classification setup is incomplete. An administrator must open this card once.";
      return;
    }

    for (
      const key
      of missing
    ) {
      const def =
        this._labelDefs[key];

      try {
        await this._hass.callWS({
          type:
            "config/label_registry/create",

          name:
            def.name,

          icon:
            def.icon,
        });
      } catch (err) {
        console.warn(
          `HA IoT Map: could not create label ${def.name}`,
          err
        );
      }
    }

    this._labels =
      (
        await this._hass.callWS({
          type:
            "config/label_registry/list",
        })
      ) || [];

    this._resolveLabelIds();

    const stillMissing =
      Object.entries(
        this._labelIds
      )
        .filter(
          ([, id]) =>
            !id
        )
        .map(
          ([key]) =>
            this._labelDefs[key].name
        );

    if (stillMissing.length) {
      this._setupMessage =
        `Could not initialize shared labels: ${stillMissing.join(", ")}`;
    } else {
      this._setupMessage =
        "Shared classification labels initialized automatically";
    }
  }

  _getRegistryLabels(item) {
    const labels =
      item.registryLabels;

    return Array.isArray(labels)
      ? labels
      : [];
  }

  _getStoredClassification(item) {
    const labels =
      new Set(
        this._getRegistryLabels(item)
      );

    if (
      this._labelIds.ignored &&
      labels.has(
        this._labelIds.ignored
      )
    ) {
      return "ignored";
    }

    if (
      this._labelIds.floating &&
      labels.has(
        this._labelIds.floating
      )
    ) {
      return "floating";
    }

    if (
      this._labelIds.fixed &&
      labels.has(
        this._labelIds.fixed
      )
    ) {
      return "fixed";
    }

    return "auto";
  }

  async _setClassification(
    itemId,
    value
  ) {
    if (!this._isAdmin) return;

    const {
      inventory
    } =
      this._deduplicateInventory(
        this._buildRawInventory()
      );

    const item =
      inventory.find(
        x =>
          x.id === itemId
      );

    if (
      !item ||
      this._savingClass.has(
        item.id
      )
    ) {
      return;
    }

    this._savingClass.add(
      item.id
    );

    try {
      const current =
        new Set(
          this._getRegistryLabels(
            item
          )
        );

      for (
        const id
        of Object.values(
          this._labelIds
        )
      ) {
        if (id) {
          current.delete(id);
        }
      }

      if (
        value !== "auto"
      ) {
        const labelId =
          this._labelIds[value];

        if (!labelId) {
          throw new Error(
            `Shared label for "${value}" is not available`
          );
        }

        current.add(
          labelId
        );
      }

      const labels =
        [...current];

      if (
        item.registryDeviceId
      ) {
        await this._hass.callWS({
          type:
            "config/device_registry/update",

          device_id:
            item.registryDeviceId,

          labels,
        });
      } else if (
        item.registryEntityId
      ) {
        await this._hass.callWS({
          type:
            "config/entity_registry/update",

          entity_id:
            item.registryEntityId,

          labels,
        });
      } else {
        throw new Error(
          "This item has no writable HA registry entry"
        );
      }

      await this._reloadRegistries(false);
      this._render();
    } catch (err) {
      console.error(
        "HA IoT Map: classification update failed",
        item,
        err
      );

      alert(
        `Could not update classification for ${item.name}\n\n` +
        (
          err?.message ||
          String(err)
        )
      );

      await this._reloadRegistries(false);
      this._render();
    } finally {
      this._savingClass.delete(
        item.id
      );
    }
  }

  async _migrateLegacyClassifications() {
    if (!this._isAdmin) return;

    if (
      localStorage.getItem(
        this._migrationStorageKey
      ) === "1"
    ) {
      return;
    }

    let legacy = {};

    try {
      legacy =
        JSON.parse(
          localStorage.getItem(
            this._legacyStorageKey
          ) || "{}"
        );
    } catch {
      legacy = {};
    }

    const entries =
      Object.entries(
        legacy
      ).filter(
        ([, value]) =>
          [
            "fixed",
            "floating",
            "ignored"
          ].includes(value)
      );

    if (!entries.length) {
      localStorage.setItem(
        this._migrationStorageKey,
        "1"
      );
      return;
    }

    const {
      inventory
    } =
      this._deduplicateInventory(
        this._buildRawInventory()
      );

    let migrated = 0;

    for (
      const [
        itemId,
        classification
      ]
      of entries
    ) {
      const item =
        inventory.find(
          x =>
            x.id === itemId
        );

      if (!item) continue;

      const labelId =
        this._labelIds[
          classification
        ];

      if (!labelId) continue;

      const current =
        new Set(
          this._getRegistryLabels(
            item
          )
        );

      for (
        const id
        of Object.values(
          this._labelIds
        )
      ) {
        if (id) {
          current.delete(id);
        }
      }

      current.add(
        labelId
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

            labels:
              [...current],
          });

          migrated++;
        } else if (
          item.registryEntityId
        ) {
          await this._hass.callWS({
            type:
              "config/entity_registry/update",

            entity_id:
              item.registryEntityId,

            labels:
              [...current],
          });

          migrated++;
        }
      } catch (err) {
        console.warn(
          "HA IoT Map: legacy classification migration failed",
          item,
          err
        );
      }
    }

    if (migrated) {
      await this._reloadRegistries(false);

      this._setupMessage =
        `Migrated ${migrated} browser-local classifications to Home Assistant labels`;
    }

    localStorage.setItem(
      this._migrationStorageKey,
      "1"
    );
  }

  _isPhysicalCandidate(item) {
    const platforms =
      (item.platforms || [])
        .map(
          p =>
            String(p)
              .toLowerCase()
        );

    const softwareOnly =
      new Set([
        "hacs",
        "backup",
        "frontend",
      ]);

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

    if (item.mac) return true;
    if (item.ip) return true;
    if (item.hostname) return true;
    if (item.trackerCount > 0) return true;

    if (
      platforms.some(
        p =>
          physicalPlatforms.has(p)
      )
    ) {
      return true;
    }

    if (
      platforms.some(
        p =>
          softwareOnly.has(p)
      )
    ) {
      return false;
    }

    return false;
  }

  _getEffectiveClassification(item) {
    const stored =
      this._getStoredClassification(
        item
      );

    if (
      stored !== "auto"
    ) {
      return stored;
    }

    if (
      !this._isPhysicalCandidate(
        item
      )
    ) {
      return "filtered";
    }

    if (
      item.floating
    ) {
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

    for (
      const entity
      of this._entities
    ) {
      if (
        entity.disabled_by
      ) {
        continue;
      }

      if (
        entity.device_id
      ) {
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
          .get(
            entity.device_id
          )
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

    const inventory =
      [];

    for (
      const device
      of this._devices
    ) {
      const deviceEntities =
        entitiesByDevice.get(
          device.id
        ) || [];

      if (
        !deviceEntities.length
      ) {
        continue;
      }

      const entityArea =
        deviceEntities.find(
          e =>
            e.area_id
        )?.area_id || null;

      const areaId =
        device.area_id ||
        entityArea ||
        null;

      const platforms = [
        ...new Set(
          deviceEntities
            .map(
              e =>
                e.platform
            )
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
        id:
          device.id,

        sourceType:
          "device",

        registryDeviceId:
          device.id,

        registryEntityId:
          null,

        registryLabels:
          Array.isArray(
            device.labels
          )
            ? device.labels
            : [],

        name:
          device.name_by_user ||
          device.name ||
          device.model ||
          "Unnamed device",

        areaId,

        areaName:
          areaId
            ? areaMap.get(
                areaId
              ) ||
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
            e =>
              e.entity_id
          ),

        mergedItems:
          [],
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
        state.attributes ||
        {};

      const areaId =
        entity.area_id ||
        null;

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

        registryLabels:
          Array.isArray(
            entity.labels
          )
            ? entity.labels
            : [],

        name:
          attrs.friendly_name ||
          entity.original_name ||
          entity.entity_id,

        areaId,

        areaName:
          areaId
            ? areaMap.get(
                areaId
              ) ||
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
      compact.length !==
      12
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

      if (
        !normalizedMac
      ) {
        noMac.push(
          item
        );
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
        .get(
          normalizedMac
        )
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
        items.length -
        1;
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
      ) ||
      items[0];

    const assigned =
      items.find(
        item =>
          item.areaId
      ) ||
      null;

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
          i =>
            i.manufacturer
        )?.manufacturer ||
        null,

      model:
        items.find(
          i =>
            i.model
        )?.model ||
        null,

      ip:
        items.find(
          i =>
            i.ip
        )?.ip ||
        null,

      hostname:
        items.find(
          i =>
            i.hostname
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

  _chooseBestName(
    items
  ) {
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
            item.name ||
            "";

          if (
            item.sourceType ===
            "device"
          ) {
            score += 5;
          }

          if (
            item.areaId
          ) {
            score += 3;
          }

          if (
            item.manufacturer
          ) {
            score += 2;
          }

          if (
            item.model
          ) {
            score += 2;
          }

          if (
            !badNamePatterns.some(
              pattern =>
                pattern.test(
                  name
                )
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
      (
        a,
        b
      ) =>
        b.score -
        a.score
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
          ![
            "not_home",
            "unavailable",
            "unknown"
          ].includes(
            state.state
          )
        ) {
          hasOnlineTracker =
            true;
        }

        continue;
      }

      if (
        ![
          "unavailable",
          "unknown"
        ].includes(
          state.state
        )
      ) {
        hasUsableEntity =
          true;
      }
    }

    return {
      online:
        hasTracker
          ? hasOnlineTracker
          : hasUsableEntity,
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
          ] =
            connection;

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
        state.attributes ||
        {};

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

      if (
        !item.areaId
      ) {
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
        .get(
          item.areaName
        )
        .push(item);
    }

    const sorter =
      (
        a,
        b
      ) =>
        a.name.localeCompare(
          b.name
        );

    for (
      const list
      of groups.areas.values()
    ) {
      list.sort(
        sorter
      );
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
    if (!this._isAdmin) return;

    const {
      inventory
    } =
      this._deduplicateInventory(
        this._buildRawInventory()
      );

    const item =
      inventory.find(
        device =>
          device.id ===
          itemId
      );

    if (
      !item ||
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

      await this._reloadRegistries(
        false
      );

      this._render();
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

      await this._reloadRegistries(
        false
      );

      this._render();
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
    await this._reloadRegistries(
      false
    );

    await this._ensureSharedLabels();

    this._render();
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
          ).size >
          1
      ).length;

    const missingLabels =
      Object.entries(
        this._labelIds
      )
        .filter(
          ([, id]) =>
            !id
        )
        .map(
          ([key]) =>
            this._labelDefs[
              key
            ].name
        );

    this.innerHTML = `
      <ha-card>

        <style>

          .iot-wrap {
            padding:18px;
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
              var(
                --secondary-background-color
              );

            color:
              var(
                --primary-text-color
              );

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

          .setup {
            margin-bottom:16px;
            padding:10px 12px;
            border-radius:8px;

            background:
              var(
                --secondary-background-color
              );

            font-size:12px;
          }

          .setup-ok {
            border-left:
              4px solid
              var(
                --success-color,
                #4caf50
              );
          }

          .setup-warn {
            border-left:
              4px solid
              var(
                --warning-color,
                #ff9800
              );
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
            margin:16px 0 6px;
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
            opacity:.45;
            cursor:not-allowed;
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
              var(
                --divider-color
              );
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

          <div
            class="
              setup
              ${
                missingLabels.length
                  ? "setup-warn"
                  : "setup-ok"
              }
            "
          >

            ${
              missingLabels.length
                ? this._isAdmin
                  ? `Shared label setup incomplete: ${this._escapeHtml(
                      missingLabels.join(
                        ", "
                      )
                    )}`
                  : `Read-only mode: an administrator must open HA IoT Map once to initialize shared classifications.`
                : `Shared HA classification storage ready${
                    this._isAdmin
                      ? ""
                      : " • read-only user"
                  }`
            }

            ${
              this._setupMessage
                ? `<br>${this._escapeHtml(
                    this._setupMessage
                  )}`
                : ""
            }

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
              groups.ignored,
              "Devices explicitly classified as Ignored."
            )
          }

          ${
            this._renderCollapsedSection(
              "Filtered / software-only",
              groups.filtered,
              "Automatically filtered. Set one to Fixed or Floating to force it into the IoT inventory."
            )
          }

          <div class="special-section">

            <details>

              <summary>
                Shared storage diagnostics
              </summary>

              <div
                style="
                  padding-top:10px;
                  opacity:.7;
                  font-size:12px;
                  line-height:1.6;
                "
              >

                Classification backend:
                Home Assistant Labels

                <br>

                IoT Fixed:
                ${this._escapeHtml(
                  this._labelIds.fixed ||
                  "missing"
                )}

                <br>

                IoT Floating:
                ${this._escapeHtml(
                  this._labelIds.floating ||
                  "missing"
                )}

                <br>

                IoT Ignored:
                ${this._escapeHtml(
                  this._labelIds.ignored ||
                  "missing"
                )}

                <br>

                User:
                ${
                  this._isAdmin
                    ? "Administrator"
                    : "Non-admin / read-only editing"
                }

                <br>

                Raw HA records:
                ${rawInventory.length}

                <br>

                After MAC deduplication:
                ${inventory.length}

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
            HA IoT Map v0.7
            • HA
            ${this._escapeHtml(
              this._hass.config
                .version ||
              ""
            )}
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

    for (
      const select
      of this.querySelectorAll(
        "select[data-iot-classification]"
      )
    ) {
      select.addEventListener(
        "change",
        event => {
          const itemId =
            event.target.dataset
              .iotClassification;

          const value =
            event.target.value;

          event.target.disabled =
            true;

          this._setClassification(
            itemId,
            value
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

  _renderAssigned(groups) {
    const areas =
      [
        ...groups.areas.entries()
      ].sort(
        (
          a,
          b
        ) =>
          a[0].localeCompare(
            b[0]
          )
      );

    if (
      !areas.length
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

        ${
          areas.map(
            (
              [
                areaName,
                devices
              ]
            ) => `
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
          ).join("")
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

  _renderCollapsedSection(
    title,
    devices,
    note
  ) {
    return `
      <div class="special-section">

        <details>

          <summary>
            ${this._escapeHtml(
              title
            )}
            (${devices.length})
          </summary>

          <div
            style="
              padding:8px 0 4px;
              opacity:.65;
              font-size:12px;
            "
          >
            ${this._escapeHtml(
              note
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
              : ""
          }
          ${
            stored === "floating"
              ? "classification-floating"
              : ""
          }
        "
        data-iot-classification="${
          this._escapeHtml(
            device.id
          )
        }"
        ${
          !this._isAdmin
            ? "disabled"
            : ""
        }
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
          !this._isAdmin
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
          sortedAreas.map(
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
          ).join("")
        }

      </select>
    `;
  }

  _renderDevice(
    device
  ) {
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
  "%c HA IoT Map %c v0.7 ",
  "background:#03a9f4;color:white;font-weight:bold;",
  "background:#333;color:white;"
);
