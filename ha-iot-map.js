class HaIotMap extends HTMLElement {
  constructor() {
    super();

    this._hass = null;
    this._config = {};

    this._loaded = false;
    this._loading = false;

    this._savingArea = new Set();
    this._savingClass = new Set();
    this._savingCategory = new Set();

    this._areas = [];
    this._devices = [];
    this._entities = [];
    this._labels = [];

    this._autoUpdate = false;
    this._lastAutoRefresh = 0;
    this._autoRefreshInterval = 5000;

    this._legacyStorageKey =
      "ha_iot_map_classifications_v1";

    this._migrationStorageKey =
      "ha_iot_map_labels_migrated_v07";

    /*
     * Placement / map-behaviour labels
     */
    this._labelDefs = {
      fixed: {
        name: "IoT Fixed",
        icon: "mdi:map-marker"
      },

      floating: {
        name: "IoT Floating",
        icon: "mdi:access-point-network"
      },

      ignored: {
        name: "IoT Ignored",
        icon: "mdi:eye-off"
      }
    };

    /*
     * Category override labels
     */
    this._categoryDefs = {
      camera: {
        name: "IoT Category Camera",
        title: "Camera",
        icon: "mdi:cctv"
      },

      sensor: {
        name: "IoT Category Sensor",
        title: "Sensor",
        icon: "mdi:thermometer"
      },

      lighting: {
        name: "IoT Category Lighting",
        title: "Lighting",
        icon: "mdi:lightbulb"
      },

      switch: {
        name: "IoT Category Switch Plug",
        title: "Switch / Plug",
        icon: "mdi:power-socket-eu"
      },

      server: {
        name: "IoT Category Server",
        title: "Server",
        icon: "mdi:server"
      },

      nas: {
        name: "IoT Category NAS",
        title: "NAS",
        icon: "mdi:nas"
      },

      network: {
        name: "IoT Category Network",
        title: "Network",
        icon: "mdi:access-point"
      },

      mobile: {
        name: "IoT Category Mobile",
        title: "Mobile",
        icon: "mdi:cellphone"
      },

      tablet: {
        name: "IoT Category Tablet",
        title: "Tablet",
        icon: "mdi:tablet"
      },

      computer: {
        name: "IoT Category Computer",
        title: "Computer",
        icon: "mdi:desktop-tower-monitor"
      },

      media: {
        name: "IoT Category AV Media",
        title: "AV / Media",
        icon: "mdi:television"
      },

      printer: {
        name: "IoT Category Printer",
        title: "Printer",
        icon: "mdi:printer"
      },

      vacuum: {
        name: "IoT Category Vacuum",
        title: "Vacuum",
        icon: "mdi:robot-vacuum"
      },

      appliance: {
        name: "IoT Category Appliance",
        title: "Appliance",
        icon: "mdi:washing-machine"
      },

      other: {
        name: "IoT Category Other",
        title: "Other",
        icon: "mdi:devices"
      }
    };

    this._labelIds = {
      fixed: null,
      floating: null,
      ignored: null
    };

    this._categoryLabelIds = {};

    for (const key of Object.keys(this._categoryDefs)) {
      this._categoryLabelIds[key] = null;
    }

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

    if (!this._loaded || !this._autoUpdate) {
      return;
    }

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
    if (!this._hass) {
      return;
    }

    this._loading = true;
    this._renderLoading();

    try {
      await this._reloadRegistries(false);

      await this._ensureSharedLabels();

      await this._migrateLegacyClassifications();

      this._loaded = true;
      this._loading = false;

      this._lastAutoRefresh =
        Date.now();

      this._render();
    } catch (err) {
      console.error(
        "HA IoT Map: initial load failed",
        err
      );

      this._loading = false;

      this.innerHTML = `
        <ha-card header="HA IoT Map Manager">
          <div
            style="
              padding:16px;
              color:var(--error-color);
            "
          >
            HA IoT Map failed to initialize.
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

  async _reloadRegistries(
    renderAfter = true
  ) {
    const [
      areas,
      devices,
      entities,
      labels
    ] =
      await Promise.all([
        this._hass.callWS({
          type:
            "config/area_registry/list"
        }),

        this._hass.callWS({
          type:
            "config/device_registry/list"
        }),

        this._hass.callWS({
          type:
            "config/entity_registry/list"
        }),

        this._hass.callWS({
          type:
            "config/label_registry/list"
        })
      ]);

    this._areas =
      areas || [];

    this._devices =
      devices || [];

    this._entities =
      entities || [];

    this._labels =
      labels || [];

    this._resolveLabelIds();

    this._lastAutoRefresh =
      Date.now();

    if (
      renderAfter &&
      this._loaded
    ) {
      this._render();
    }
  }

  _findLabelIdByName(name) {
    const wanted =
      String(name)
        .trim()
        .toLowerCase();

    const match =
      this._labels.find(
        label =>
          String(
            label.name || ""
          )
            .trim()
            .toLowerCase() ===
          wanted
      );

    return (
      match?.label_id ||
      match?.id ||
      null
    );
  }

  _resolveLabelIds() {
    for (
      const key
      of Object.keys(
        this._labelDefs
      )
    ) {
      this._labelIds[key] =
        this._findLabelIdByName(
          this._labelDefs[key].name
        );
    }

    for (
      const key
      of Object.keys(
        this._categoryDefs
      )
    ) {
      this._categoryLabelIds[key] =
        this._findLabelIdByName(
          this._categoryDefs[key].name
        );
    }
  }

  async _createLabel(def) {
    try {
      await this._hass.callWS({
        type:
          "config/label_registry/create",

        name:
          def.name,

        icon:
          def.icon
      });
    } catch (err) {
      console.warn(
        "HA IoT Map: label creation warning",
        def.name,
        err
      );
    }
  }

  async _ensureSharedLabels() {
    this._resolveLabelIds();

    const missingPlacement =
      Object.keys(
        this._labelDefs
      )
        .filter(
          key =>
            !this._labelIds[key]
        );

    const missingCategories =
      Object.keys(
        this._categoryDefs
      )
        .filter(
          key =>
            !this._categoryLabelIds[
              key
            ]
        );

    if (
      !missingPlacement.length &&
      !missingCategories.length
    ) {
      this._setupMessage =
        "Shared classification and category labels ready";

      return;
    }

    if (!this._isAdmin) {
      this._setupMessage =
        "Shared setup incomplete. An administrator must open this card once.";

      return;
    }

    for (
      const key
      of missingPlacement
    ) {
      await this._createLabel(
        this._labelDefs[key]
      );
    }

    for (
      const key
      of missingCategories
    ) {
      await this._createLabel(
        this._categoryDefs[key]
      );
    }

    this._labels =
      (
        await this._hass.callWS({
          type:
            "config/label_registry/list"
        })
      ) || [];

    this._resolveLabelIds();

    this._setupMessage =
      "Shared classification and category labels initialized";
  }

  _getRegistryLabels(item) {
    return Array.isArray(
      item.registryLabels
    )
      ? item.registryLabels
      : [];
  }

  _getStoredClassification(item) {
    const labels =
      new Set(
        this._getRegistryLabels(
          item
        )
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

  _getStoredCategory(item) {
    const labels =
      new Set(
        this._getRegistryLabels(
          item
        )
      );

    for (
      const [
        key,
        id
      ]
      of Object.entries(
        this._categoryLabelIds
      )
    ) {
      if (
        id &&
        labels.has(id)
      ) {
        return key;
      }
    }

    return "auto";
  }

  _getResolvedCategory(item) {
    const stored =
      this._getStoredCategory(
        item
      );

    if (
      stored !== "auto"
    ) {
      return stored;
    }

    return this._autoCategory(
      item
    );
  }

  _autoCategory(item) {
    const domains =
      new Set(
        (item.entityIds || [])
          .map(
            entityId =>
              String(entityId)
                .split(".")[0]
          )
      );

    const platforms =
      new Set(
        (item.platforms || [])
          .map(
            p =>
              String(p)
                .toLowerCase()
          )
      );

    const text =
      [
        item.name,
        item.hostname,
        item.manufacturer,
        item.model
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    /*
     * High-confidence categories first.
     */

    if (
      domains.has("camera") ||
      platforms.has("reolink") ||
      /\bcam\b|camera|cctv|reolink/.test(
        text
      )
    ) {
      return "camera";
    }

    if (
      domains.has("vacuum") ||
      platforms.has("roborock") ||
      /roborock|vacuum|imuri/.test(
        text
      )
    ) {
      return "vacuum";
    }

    if (
      /epson|brother|laserjet|printer|tulostin/.test(
        text
      )
    ) {
      return "printer";
    }

    if (
      /asustor|synology|qnap|\bnas\b/.test(
        text
      )
    ) {
      return "nas";
    }

    if (
      /securityserver|ubuntu.*server|\bserver\b|proxmox|docker host/.test(
        text
      )
    ) {
      return "server";
    }

    if (
      /pfsense|router|archer|access point|\bap\b|switch|gateway|be550|be230/.test(
        text
      )
    ) {
      return "network";
    }

    if (
      /ipad|tablet|lenovo[_ -]?tab|\btab\b/.test(
        text
      )
    ) {
      return "tablet";
    }

    if (
      platforms.has("mobile_app") ||
      /iphone|android phone|cellphone|phone|puhelin/.test(
        text
      )
    ) {
      return "mobile";
    }

    if (
      /laptop|desktop|computer|\bpc\b|windows|macbook/.test(
        text
      )
    ) {
      return "computer";
    }

    if (
      domains.has(
        "media_player"
      ) ||
      /television|\btv\b|soundbar|chromecast|apple tv|receiver|amplifier/.test(
        text
      )
    ) {
      return "media";
    }

    if (
      domains.has("light") ||
      /light|lamp|valo|valot|led/.test(
        text
      )
    ) {
      return "lighting";
    }

    if (
      domains.has("switch") ||
      /plug|pistorasia|socket|relay|rele/.test(
        text
      )
    ) {
      return "switch";
    }

    /*
     * Sensors after lighting/switch,
     * because ESP/Shelly devices can have
     * lots of sensor entities while their
     * primary purpose is something else.
     */
    if (
      domains.has("sensor") ||
      domains.has(
        "binary_sensor"
      ) ||
      /temp|temperature|humidity|sensor|bme|dht/.test(
        text
      )
    ) {
      return "sensor";
    }

    if (
      /dishwasher|washing machine|dryer|freezer|fridge|oven|sauna|appliance/.test(
        text
      )
    ) {
      return "appliance";
    }

    return "other";
  }

  _categoryIcon(category) {
    return (
      this._categoryDefs[
        category
      ]?.icon ||
      "mdi:devices"
    );
  }

  _categoryTitle(category) {
    return (
      this._categoryDefs[
        category
      ]?.title ||
      "Other"
    );
  }

  async _setClassification(
    itemId,
    value
  ) {
    if (!this._isAdmin) {
      return;
    }

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
          this._labelIds[
            value
          ];

        if (!labelId) {
          throw new Error(
            `Classification label missing: ${value}`
          );
        }

        current.add(
          labelId
        );
      }

      await this._writeLabels(
        item,
        [...current]
      );

      await this._reloadRegistries(
        false
      );

      this._render();
    } catch (err) {
      console.error(
        "HA IoT Map: classification update failed",
        err
      );

      alert(
        err?.message ||
        String(err)
      );
    } finally {
      this._savingClass.delete(
        item.id
      );
    }
  }

  async _setCategory(
    itemId,
    value
  ) {
    if (!this._isAdmin) {
      return;
    }

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
      this._savingCategory.has(
        item.id
      )
    ) {
      return;
    }

    this._savingCategory.add(
      item.id
    );

    try {
      const current =
        new Set(
          this._getRegistryLabels(
            item
          )
        );

      /*
       * Remove any previous category override.
       */
      for (
        const id
        of Object.values(
          this._categoryLabelIds
        )
      ) {
        if (id) {
          current.delete(id);
        }
      }

      /*
       * Auto means no category label.
       */
      if (
        value !== "auto"
      ) {
        const labelId =
          this._categoryLabelIds[
            value
          ];

        if (!labelId) {
          throw new Error(
            `Category label missing: ${value}`
          );
        }

        current.add(
          labelId
        );
      }

      await this._writeLabels(
        item,
        [...current]
      );

      await this._reloadRegistries(
        false
      );

      this._render();
    } catch (err) {
      console.error(
        "HA IoT Map: category update failed",
        err
      );

      alert(
        err?.message ||
        String(err)
      );
    } finally {
      this._savingCategory.delete(
        item.id
      );
    }
  }

  async _writeLabels(
    item,
    labels
  ) {
    if (
      item.registryDeviceId
    ) {
      await this._hass.callWS({
        type:
          "config/device_registry/update",

        device_id:
          item.registryDeviceId,

        labels
      });

      return;
    }

    if (
      item.registryEntityId
    ) {
      await this._hass.callWS({
        type:
          "config/entity_registry/update",

        entity_id:
          item.registryEntityId,

        labels
      });

      return;
    }

    throw new Error(
      "No writable HA registry entry"
    );
  }

  async _migrateLegacyClassifications() {
    if (!this._isAdmin) {
      return;
    }

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

      if (!item) {
        continue;
      }

      const labelId =
        this._labelIds[
          classification
        ];

      if (!labelId) {
        continue;
      }

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
        await this._writeLabels(
          item,
          [...current]
        );

        migrated++;
      } catch (err) {
        console.warn(
          "HA IoT Map migration warning",
          err
        );
      }
    }

    if (migrated) {
      await this._reloadRegistries(
        false
      );

      this._setupMessage =
        `Migrated ${migrated} browser-local classifications`;
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
        "frontend"
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
        "wled"
      ]);

    if (item.mac) {
      return true;
    }

    if (item.ip) {
      return true;
    }

    if (item.hostname) {
      return true;
    }

    if (
      item.trackerCount >
      0
    ) {
      return true;
    }

    if (
      platforms.some(
        p =>
          physicalPlatforms.has(
            p
          )
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

  _getEffectiveClassification(
    item
  ) {
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

    const inventory = [];

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
        )?.area_id ||
        null;

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
        )
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
          []
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

      if (!state) {
        continue;
      }

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
          []
      });
    }

    return inventory;
  }

  _normalizeMac(mac) {
    if (!mac) {
      return null;
    }

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

      if (!normalizedMac) {
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
        items.length ===
        1
      ) {
        mergedInventory.push(
          items[0]
        );

        continue;
      }

      mergedInventory.push(
        this._mergeExactMacGroup(
          mac,
          items
        )
      );

      mergedAwayCount +=
        items.length - 1;
    }

    mergedInventory.push(
      ...noMac
    );

    return {
      inventory:
        mergedInventory,

      mergedAwayCount
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
      )
    ];

    const allEntityIds = [
      ...new Set(
        items.flatMap(
          item =>
            item.entityIds ||
            []
        )
      )
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

      areaId:
        assigned?.areaId ||
        preferred.areaId ||
        null,

      areaName:
        assigned?.areaName ||
        preferred.areaName ||
        null,

      platforms:
        allPlatforms,

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

      online:
        items.some(
          i =>
            i.online
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
        items
    };
  }

  _chooseBestName(items) {
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
            !/^device_tracker\./i.test(
              name
            )
          ) {
            score += 3;
          }

          return {
            item,
            score
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
    let usable =
      false;

    let tracker =
      false;

    let trackerOnline =
      false;

    for (
      const entity
      of entities
    ) {
      const state =
        this._hass.states[
          entity.entity_id
        ];

      if (!state) {
        continue;
      }

      if (
        entity.entity_id.startsWith(
          "device_tracker."
        )
      ) {
        tracker = true;

        if (
          ![
            "not_home",
            "unavailable",
            "unknown"
          ].includes(
            state.state
          )
        ) {
          trackerOnline =
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
        usable = true;
      }
    }

    return {
      online:
        tracker
          ? trackerOnline
          : usable
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

      if (!state) {
        continue;
      }

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
      hostname
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
        []
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
    if (!this._isAdmin) {
      return;
    }

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

    if (!item) {
      return;
    }

    if (
      item.registryDeviceId
    ) {
      await this._hass.callWS({
        type:
          "config/device_registry/update",

        device_id:
          item.registryDeviceId,

        area_id:
          areaId ||
          null
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
          areaId ||
          null
      });
    }

    await this._reloadRegistries(
      false
    );

    this._render();
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

            padding:8px 12px;
            border-radius:8px;
            cursor:pointer;
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
            font-size:12px;
            opacity:.7;
          }

          .section {
            margin-top:24px;
          }

          .section-title {
            font-size:18px;
            font-weight:600;
          }

          .area-title {
            font-size:15px;
            font-weight:600;
            margin-top:18px;
          }

          /*
           * New v0.8 layout.
           *
           * status | device info | control stack
           */
          .device {
            display:grid;

            grid-template-columns:
              14px
              minmax(
                280px,
                1fr
              )
              260px;

            gap:16px;
            align-items:center;

            padding:12px 8px;

            border-bottom:
              1px solid
              var(
                --divider-color
              );
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

          .device-head {
            display:flex;
            align-items:center;
            gap:10px;
          }

          .device-icon {
            --mdc-icon-size:22px;
            opacity:.9;
          }

          .device-name {
            font-weight:600;
          }

          .category-auto {
            font-size:11px;
            opacity:.55;
            margin-left:6px;
          }

          .device-details {
            font-size:12px;
            opacity:.65;
            margin-top:5px;
            line-height:1.5;
          }

          /*
           * All controls share one x position.
           */
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
            align-items:center;
          }

          .field-label {
            font-size:11px;
            opacity:.6;
            text-transform:uppercase;
            letter-spacing:.04em;
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

          .area-select.unassigned {
            border-color:
              var(
                --warning-color,
                #ff9800
              );
          }

          .source {
            margin-top:3px;
            padding-left:80px;
            font-size:10px;
            opacity:.45;
          }

          .empty {
            opacity:.55;
            font-style:italic;
            padding:10px;
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

          details {
            margin-top:8px;
          }

          summary {
            cursor:pointer;
            font-weight:600;
          }

          @media (
            max-width:900px
          ) {

            .iot-header {
              flex-direction:column;
              align-items:flex-start;
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
              grid-column:2;
              width:100%;
              max-width:360px;
              margin-top:6px;
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
                class="control-button"
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
              "Filtered"
            )}

            ${this._summaryBox(
              dedupeResult
                .mergedAwayCount,
              "Duplicates"
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
            HA IoT Map Manager v0.8
            • HA
            ${this._escapeHtml(
              this._hass.config.version ||
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
          event.target.disabled =
            true;

          this._changeArea(
            event.target.dataset
              .iotArea,

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

          this._setClassification(
            event.target.dataset
              .iotClassification,

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

          this._setCategory(
            event.target.dataset
              .iotCategory,

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

  _renderCategorySelector(
    device
  ) {
    const stored =
      this._getStoredCategory(
        device
      );

    const resolved =
      this._getResolvedCategory(
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
          Auto (${this._escapeHtml(
            this._categoryTitle(
              resolved
            )
          )})
        </option>

        ${
          Object.entries(
            this._categoryDefs
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
                    stored === key
                      ? "selected"
                      : ""
                  }
                >
                  ${this._escapeHtml(
                    def.title
                  )}
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
      this._getStoredClassification(
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

  _renderDevice(device) {
    const category =
      this._getResolvedCategory(
        device
      );

    const categoryIcon =
      this._categoryIcon(
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
        ></div>

        <div>

          <div class="device-head">

            <ha-icon
              class="device-icon"
              icon="${this._escapeHtml(
                categoryIcon
              )}"
            ></ha-icon>

            <div class="device-name">
              ${this._escapeHtml(
                device.name
              )}
            </div>

            <span class="category-auto">
              ${this._escapeHtml(
                this._categoryTitle(
                  category
                )
              )}
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
            ${this._escapeHtml(
              source
            )}
          </div>

        </div>

      </div>
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

                    <div class="area-title">
                      ${this._escapeHtml(
                        area
                      )}
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
          ${this._escapeHtml(
            title
          )}
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
            ${this._escapeHtml(
              title
            )}
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
          ${this._escapeHtml(
            label
          )}
        </div>

      </div>
    `;
  }

  _renderLoading() {
    this.innerHTML = `
      <ha-card header="HA IoT Map Manager">
        <div style="padding:16px">
          Reading Home Assistant registries...
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
      columns:12,
      min_columns:6
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
      "HA IoT Map Manager",

    description:
      "Automatic IoT inventory manager for Home Assistant"
  });
}

console.info(
  "%c HA IoT Map Manager %c v0.8 ",
  "background:#03a9f4;color:white;font-weight:bold;",
  "background:#333;color:white;"
);
