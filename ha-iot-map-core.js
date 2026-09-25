export class HaIotMapCore {
  constructor() {
    this.hass = null;

    this.areas = [];
    this.devices = [];
    this.entities = [];
    this.labels = [];

    this.loaded = false;
    this.loading = false;

    this.savingArea = new Set();
    this.savingClass = new Set();
    this.savingCategory = new Set();
    this.savingName = new Set();

    this.labelDefs = {
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

    this.categoryDefs = {
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

    this.labelIds = {
      fixed: null,
      floating: null,
      ignored: null
    };

    this.categoryLabelIds = {};

    for (const key of Object.keys(this.categoryDefs)) {
      this.categoryLabelIds[key] = null;
    }

    this.legacyStorageKey =
      "ha_iot_map_classifications_v1";

    this.migrationStorageKey =
      "ha_iot_map_labels_migrated_v07";

    this.setupMessage = null;
  }

  setHass(hass) {
    this.hass = hass;
  }

  get isAdmin() {
    return !!this.hass?.user?.is_admin;
  }

  async initialize() {
    if (!this.hass) {
      throw new Error(
        "Home Assistant object not available"
      );
    }

    this.loading = true;

    await this.reloadRegistries();
    await this.ensureSharedLabels();
    await this.migrateLegacyClassifications();

    this.loaded = true;
    this.loading = false;
  }

  async reloadRegistries() {
    const [
      areas,
      devices,
      entities,
      labels
    ] = await Promise.all([
      this.hass.callWS({
        type:
          "config/area_registry/list"
      }),

      this.hass.callWS({
        type:
          "config/device_registry/list"
      }),

      this.hass.callWS({
        type:
          "config/entity_registry/list"
      }),

      this.hass.callWS({
        type:
          "config/label_registry/list"
      })
    ]);

    this.areas =
      areas || [];

    this.devices =
      devices || [];

    this.entities =
      entities || [];

    this.labels =
      labels || [];

    this.resolveLabelIds();
  }

  findLabelIdByName(name) {
    const wanted =
      String(name)
        .trim()
        .toLowerCase();

    const match =
      this.labels.find(
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

  resolveLabelIds() {
    for (
      const key
      of Object.keys(
        this.labelDefs
      )
    ) {
      this.labelIds[key] =
        this.findLabelIdByName(
          this.labelDefs[
            key
          ].name
        );
    }

    for (
      const key
      of Object.keys(
        this.categoryDefs
      )
    ) {
      this.categoryLabelIds[
        key
      ] =
        this.findLabelIdByName(
          this.categoryDefs[
            key
          ].name
        );
    }
  }

  async createLabel(def) {
    try {
      await this.hass.callWS({
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

  async ensureSharedLabels() {
    this.resolveLabelIds();

    const missingPlacement =
      Object.keys(
        this.labelDefs
      )
        .filter(
          key =>
            !this.labelIds[
              key
            ]
        );

    const missingCategories =
      Object.keys(
        this.categoryDefs
      )
        .filter(
          key =>
            !this.categoryLabelIds[
              key
            ]
        );

    if (
      !missingPlacement.length &&
      !missingCategories.length
    ) {
      this.setupMessage =
        "Shared classification and category labels ready";

      return;
    }

    if (!this.isAdmin) {
      this.setupMessage =
        "Shared setup incomplete. An administrator must open this card once.";

      return;
    }

    for (
      const key
      of missingPlacement
    ) {
      await this.createLabel(
        this.labelDefs[
          key
        ]
      );
    }

    for (
      const key
      of missingCategories
    ) {
      await this.createLabel(
        this.categoryDefs[
          key
        ]
      );
    }

    this.labels =
      (
        await this.hass.callWS({
          type:
            "config/label_registry/list"
        })
      ) || [];

    this.resolveLabelIds();

    this.setupMessage =
      "Shared classification and category labels initialized";
  }

  getRegistryLabels(item) {
    return Array.isArray(
      item.registryLabels
    )
      ? item.registryLabels
      : [];
  }

  getStoredClassification(item) {
    const labels =
      new Set(
        this.getRegistryLabels(
          item
        )
      );

    if (
      this.labelIds.ignored &&
      labels.has(
        this.labelIds.ignored
      )
    ) {
      return "ignored";
    }

    if (
      this.labelIds.floating &&
      labels.has(
        this.labelIds.floating
      )
    ) {
      return "floating";
    }

    if (
      this.labelIds.fixed &&
      labels.has(
        this.labelIds.fixed
      )
    ) {
      return "fixed";
    }

    return "auto";
  }

  getStoredCategory(item) {
    const labels =
      new Set(
        this.getRegistryLabels(
          item
        )
      );

    for (
      const [
        key,
        id
      ]
      of Object.entries(
        this.categoryLabelIds
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

  getResolvedCategory(item) {
    const stored =
      this.getStoredCategory(
        item
      );

    if (
      stored !==
      "auto"
    ) {
      return stored;
    }

    return this.autoCategory(
      item
    );
  }

  autoCategory(item) {
    const domains =
      new Set(
        (
          item.entityIds ||
          []
        )
          .map(
            entityId =>
              String(
                entityId
              )
                .split(".")[0]
          )
      );

    const platforms =
      new Set(
        (
          item.platforms ||
          []
        )
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

    if (
      domains.has(
        "camera"
      ) ||
      platforms.has(
        "reolink"
      ) ||
      /\bcam\b|camera|cctv|reolink/.test(
        text
      )
    ) {
      return "camera";
    }

    if (
      domains.has(
        "vacuum"
      ) ||
      platforms.has(
        "roborock"
      ) ||
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
      /pfsense|router|archer|access point|\bap\b|gateway|be550|be230/.test(
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
      platforms.has(
        "mobile_app"
      ) ||
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
      domains.has(
        "light"
      ) ||
      /light|lamp|valo|valot|led/.test(
        text
      )
    ) {
      return "lighting";
    }

    if (
      domains.has(
        "switch"
      ) ||
      /plug|pistorasia|socket|relay|rele/.test(
        text
      )
    ) {
      return "switch";
    }

    if (
      domains.has(
        "sensor"
      ) ||
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

  categoryIcon(category) {
    return (
      this.categoryDefs[
        category
      ]?.icon ||
      "mdi:devices"
    );
  }

  categoryTitle(category) {
    return (
      this.categoryDefs[
        category
      ]?.title ||
      "Other"
    );
  }

  async writeLabels(
    item,
    labels
  ) {
    if (
      item.registryDeviceId
    ) {
      await this.hass.callWS({
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
      await this.hass.callWS({
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

  async setClassification(
    itemId,
    value
  ) {
    if (!this.isAdmin) {
      return;
    }

    const {
      inventory
    } =
      this.deduplicateInventory(
        this.buildRawInventory()
      );

    const item =
      inventory.find(
        x =>
          x.id ===
          itemId
      );

    if (
      !item ||
      this.savingClass.has(
        item.id
      )
    ) {
      return;
    }

    this.savingClass.add(
      item.id
    );

    try {
      const current =
        new Set(
          this.getRegistryLabels(
            item
          )
        );

      for (
        const id
        of Object.values(
          this.labelIds
        )
      ) {
        if (id) {
          current.delete(
            id
          );
        }
      }

      if (
        value !==
        "auto"
      ) {
        const labelId =
          this.labelIds[
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

      await this.writeLabels(
        item,
        [
          ...current
        ]
      );

      await this.reloadRegistries();

      return true;

    } finally {
      this.savingClass.delete(
        item.id
      );
    }
  }

  async setCategory(
    itemId,
    value
  ) {
    if (!this.isAdmin) {
      return;
    }

    const {
      inventory
    } =
      this.deduplicateInventory(
        this.buildRawInventory()
      );

    const item =
      inventory.find(
        x =>
          x.id ===
          itemId
      );

    if (
      !item ||
      this.savingCategory.has(
        item.id
      )
    ) {
      return;
    }

    this.savingCategory.add(
      item.id
    );

    try {
      const current =
        new Set(
          this.getRegistryLabels(
            item
          )
        );

      for (
        const id
        of Object.values(
          this.categoryLabelIds
        )
      ) {
        if (id) {
          current.delete(
            id
          );
        }
      }

      if (
        value !==
        "auto"
      ) {
        const labelId =
          this.categoryLabelIds[
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

      await this.writeLabels(
        item,
        [
          ...current
        ]
      );

      await this.reloadRegistries();

      return true;

    } finally {
      this.savingCategory.delete(
        item.id
      );
    }
  }

  async setArea(
    itemId,
    areaId
  ) {
    if (!this.isAdmin) {
      return;
    }

    const {
      inventory
    } =
      this.deduplicateInventory(
        this.buildRawInventory()
      );

    const item =
      inventory.find(
        x =>
          x.id ===
          itemId
      );

    if (!item) {
      return;
    }

    if (
      item.registryDeviceId
    ) {
      await this.hass.callWS({
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
      await this.hass.callWS({
        type:
          "config/entity_registry/update",

        entity_id:
          item.registryEntityId,

        area_id:
          areaId ||
          null
      });
    }

    await this.reloadRegistries();

    return true;
  }

  async setFriendlyName(
    itemId,
    value
  ) {
    if (!this.isAdmin) {
      return;
    }

    const {
      inventory
    } =
      this.deduplicateInventory(
        this.buildRawInventory()
      );

    const item =
      inventory.find(
        x =>
          x.id ===
          itemId
      );

    if (
      !item ||
      this.savingName.has(
        item.id
      )
    ) {
      return;
    }

    this.savingName.add(
      item.id
    );

    try {
      const trimmed =
        String(
          value ?? ""
        ).trim();

      if (
        item.registryDeviceId
      ) {
        await this.hass.callWS({
          type:
            "config/device_registry/update",

          device_id:
            item.registryDeviceId,

          name_by_user:
            trimmed ||
            null
        });

      } else if (
        item.registryEntityId
      ) {
        await this.hass.callWS({
          type:
            "config/entity_registry/update",

          entity_id:
            item.registryEntityId,

          name:
            trimmed ||
            null
        });

      } else {
        throw new Error(
          "No writable HA registry entry"
        );
      }

      await this.reloadRegistries();

      return true;

    } finally {
      this.savingName.delete(
        item.id
      );
    }
  }

  async migrateLegacyClassifications() {
    if (!this.isAdmin) {
      return;
    }

    if (
      localStorage.getItem(
        this.migrationStorageKey
      ) ===
      "1"
    ) {
      return;
    }

    let legacy =
      {};

    try {
      legacy =
        JSON.parse(
          localStorage.getItem(
            this.legacyStorageKey
          ) ||
          "{}"
        );

    } catch {
      legacy =
        {};
    }

    const entries =
      Object.entries(
        legacy
      )
        .filter(
          (
            [
              ,
              value
            ]
          ) =>
            [
              "fixed",
              "floating",
              "ignored"
            ].includes(
              value
            )
        );

    if (
      !entries.length
    ) {
      localStorage.setItem(
        this.migrationStorageKey,
        "1"
      );

      return;
    }

    const {
      inventory
    } =
      this.deduplicateInventory(
        this.buildRawInventory()
      );

    let migrated =
      0;

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
            x.id ===
            itemId
        );

      if (!item) {
        continue;
      }

      const labelId =
        this.labelIds[
          classification
        ];

      if (!labelId) {
        continue;
      }

      const current =
        new Set(
          this.getRegistryLabels(
            item
          )
        );

      for (
        const id
        of Object.values(
          this.labelIds
        )
      ) {
        if (id) {
          current.delete(
            id
          );
        }
      }

      current.add(
        labelId
      );

      try {
        await this.writeLabels(
          item,
          [
            ...current
          ]
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
      await this.reloadRegistries();

      this.setupMessage =
        `Migrated ${migrated} browser-local classifications`;
    }

    localStorage.setItem(
      this.migrationStorageKey,
      "1"
    );
  }

  isPhysicalCandidate(item) {
    const platforms =
      (
        item.platforms ||
        []
      )
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
          softwareOnly.has(
            p
          )
      )
    ) {
      return false;
    }

    return false;
  }

  getEffectiveClassification(
    item
  ) {
    const stored =
      this.getStoredClassification(
        item
      );

    if (
      stored !==
      "auto"
    ) {
      return stored;
    }

    if (
      !this.isPhysicalCandidate(
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

  buildRawInventory() {
    const areaMap =
      new Map(
        this.areas.map(
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
      of this.entities
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
          .push(
            entity
          );

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
      of this.devices
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
        this.getDeviceState(
          deviceEntities
        );

      const networkInfo =
        this.extractNetworkInfo(
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

        userName:
          device.name_by_user ||
          null,

        originalName:
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

        lastSeenTs:
          stateInfo.lastSeenTs,

        offlineSinceTs:
          stateInfo.offlineSinceTs,

        lastSeenSource:
          stateInfo.lastSeenSource,

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
        this.hass.states[
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

      const stateInfo =
        this.getDeviceState(
          [
            entity
          ]
        );

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
          entity.name ||
          attrs.friendly_name ||
          entity.original_name ||
          entity.entity_id,

        userName:
          entity.name ||
          null,

        originalName:
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
          stateInfo.online,

        lastSeenTs:
          stateInfo.lastSeenTs,

        offlineSinceTs:
          stateInfo.offlineSinceTs,

        lastSeenSource:
          stateInfo.lastSeenSource,

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

  normalizeMac(mac) {
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
      .match(
        /.{2}/g
      )
      .join(":");
  }

  deduplicateInventory(
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
        this.normalizeMac(
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
        .push(
          item
        );
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
        this.mergeExactMacGroup(
          mac,
          items
        )
      );

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

      mergedAwayCount
    };
  }

  mergeExactMacGroup(
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

    const latestSeen =
      this.maxTimestamp(
        items.map(
          item =>
            item.lastSeenTs
        )
      );

    return {
      ...preferred,

      id:
        `mac:${mac}`,

      name:
        this.chooseBestName(
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

      lastSeenTs:
        latestSeen,

      offlineSinceTs:
        items.some(
          i =>
            i.online
        )
          ? null
          : this.maxTimestamp(
              items.map(
                i =>
                  i.offlineSinceTs
              )
            ),

      lastSeenSource:
        items.find(
          i =>
            i.lastSeenTs ===
            latestSeen
        )?.lastSeenSource ||
        null,

      userName:
        items.find(
          i =>
            i.registryDeviceId &&
            i.userName
        )?.userName ||
        items.find(
          i =>
            i.userName
        )?.userName ||
        null,

      originalName:
        preferred.originalName ||
        preferred.name ||
        "Unnamed device",

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

  chooseBestName(items) {
    const scored =
      items.map(
        item => {
          let score =
            0;

          const name =
            item.name ||
            "";

          if (
            item.sourceType ===
            "device"
          ) {
            score +=
              5;
          }

          if (
            item.areaId
          ) {
            score +=
              3;
          }

          if (
            item.manufacturer
          ) {
            score +=
              2;
          }

          if (
            item.model
          ) {
            score +=
              2;
          }

          if (
            !/^device_tracker\./i.test(
              name
            )
          ) {
            score +=
              3;
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

  parseTimestamp(
    value
  ) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return null;
    }

    if (
      typeof value ===
      "number"
    ) {
      if (
        !Number.isFinite(
          value
        )
      ) {
        return null;
      }

      return value <
        1e12
          ? value *
            1000
          : value;
    }

    const text =
      String(value)
        .trim();

    if (!text) {
      return null;
    }

    if (
      /^\d+(\.\d+)?$/.test(
        text
      )
    ) {
      const numeric =
        Number(
          text
        );

      if (
        Number.isFinite(
          numeric
        )
      ) {
        return numeric <
          1e12
            ? numeric *
              1000
            : numeric;
      }
    }

    const parsed =
      Date.parse(
        text
      );

    return Number.isFinite(
      parsed
    )
      ? parsed
      : null;
  }

  maxTimestamp(values) {
    const valid =
      values
        .map(
          value =>
            this.parseTimestamp(
              value
            )
        )
        .filter(
          value =>
            Number.isFinite(
              value
            )
        );

    return valid.length
      ? Math.max(
          ...valid
        )
      : null;
  }

  getExplicitLastSeen(state) {
    const attrs =
      state?.attributes ||
      {};

    const keys = [
      "last_seen",
      "last_seen_at",
      "last_activity",
      "last_activity_at",
      "last_active",
      "last_connected",
      "last_connected_at"
    ];

    for (
      const key
      of keys
    ) {
      const parsed =
        this.parseTimestamp(
          attrs[key]
        );

      if (
        Number.isFinite(
          parsed
        )
      ) {
        return {
          timestamp:
            parsed,

          source:
            key
        };
      }
    }

    return {
      timestamp:
        null,

      source:
        null
    };
  }

  getDeviceState(
    entities
  ) {
    let usable =
      false;

    let tracker =
      false;

    let trackerOnline =
      false;

    const lastSeenCandidates =
      [];

    const explicitCandidates =
      [];

    const trackerOfflineSince =
      [];

    const genericOfflineSince =
      [];

    for (
      const entity
      of entities
    ) {
      const state =
        this.hass.states[
          entity.entity_id
        ];

      if (!state) {
        continue;
      }

      const explicit =
        this.getExplicitLastSeen(
          state
        );

      if (
        Number.isFinite(
          explicit.timestamp
        )
      ) {
        explicitCandidates.push({
          timestamp:
            explicit.timestamp,

          source:
            explicit.source
        });

        lastSeenCandidates.push(
          explicit.timestamp
        );
      }

      const stateUpdated =
        this.parseTimestamp(
          state.last_updated
        );

      const stateChanged =
        this.parseTimestamp(
          state.last_changed
        );

      if (
        Number.isFinite(
          stateUpdated
        )
      ) {
        lastSeenCandidates.push(
          stateUpdated
        );

      } else if (
        Number.isFinite(
          stateChanged
        )
      ) {
        lastSeenCandidates.push(
          stateChanged
        );
      }

      const unavailable =
        [
          "unavailable",
          "unknown"
        ].includes(
          state.state
        );

      if (
        entity.entity_id.startsWith(
          "device_tracker."
        )
      ) {
        tracker =
          true;

        const trackerIsOnline =
          ![
            "not_home",
            "unavailable",
            "unknown"
          ].includes(
            state.state
          );

        if (
          trackerIsOnline
        ) {
          trackerOnline =
            true;

        } else if (
          Number.isFinite(
            stateChanged
          )
        ) {
          trackerOfflineSince.push(
            stateChanged
          );
        }

        continue;
      }

      if (!unavailable) {
        usable =
          true;

      } else if (
        Number.isFinite(
          stateChanged
        )
      ) {
        genericOfflineSince.push(
          stateChanged
        );
      }
    }

    const online =
      tracker
        ? trackerOnline
        : usable;

    let offlineSinceTs =
      null;

    if (!online) {
      offlineSinceTs =
        tracker
          ? this.maxTimestamp(
              trackerOfflineSince
            )
          : this.maxTimestamp(
              genericOfflineSince
            );
    }

    const explicitLatest =
      explicitCandidates
        .sort(
          (
            a,
            b
          ) =>
            b.timestamp -
            a.timestamp
        )[0] ||
      null;

    return {
      online,

      lastSeenTs:
        explicitLatest
          ? explicitLatest.timestamp
          : this.maxTimestamp(
              lastSeenCandidates
            ),

      offlineSinceTs,

      lastSeenSource:
        explicitLatest
          ? `reported:${explicitLatest.source}`
          : "ha_state"
    };
  }

  extractNetworkInfo(
    device,
    entities
  ) {
    let mac =
      null;

    let ip =
      null;

    let hostname =
      null;

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
            mac =
              value;
          }
        }
      }
    }

    for (
      const entity
      of entities
    ) {
      const state =
        this.hass.states[
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

  groupInventory(
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
        this.getEffectiveClassification(
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
        .push(
          item
        );
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

  getSnapshot() {
    const raw =
      this.buildRawInventory();

    const dedupe =
      this.deduplicateInventory(
        raw
      );

    const groups =
      this.groupInventory(
        dedupe.inventory
      );

    return {
      rawInventory:
        raw,

      inventory:
        dedupe.inventory,

      mergedAwayCount:
        dedupe.mergedAwayCount,

      groups
    };
  }
}
