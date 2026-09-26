import {
  HaIotMapCore
} from "./ha-iot-map-core.js?v=4";


class HaIotFloorplan extends HTMLElement {

  constructor() {
    super();

    this._config = {};
    this._core = new HaIotMapCore();

    this._loaded = false;
    this._loading = false;
    this._editMode = false;

    this._dragState = null;
    this._resizeState = null;
    this._pinDragState = null;

    this._activeGroup = null;
    this._activeDeviceKey = null;
    this._areaManagerOpen = false;
    this._colorManagerOpen = false;

    this._lastRender = 0;

    this._stateKey =
      "ha_iot_floorplan_state_v04";

    this._legacyLayoutKey =
      "ha_iot_floorplan_layout_v02";

    this._state =
      this._loadState();

    this._backgroundUrls = {};
    this._backgroundBlobs = {};

    this._currentData = null;

    this._boundWindowResize =
      () => this._applyPlanSize();
  }


  connectedCallback() {

    window.addEventListener(
      "resize",
      this._boundWindowResize
    );
  }


  disconnectedCallback() {

    window.removeEventListener(
      "resize",
      this._boundWindowResize
    );
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
      this._editMode ||
      this._activeGroup ||
      this._activeDeviceKey ||
      this._areaManagerOpen ||
      this._colorManagerOpen
    ) {
      return;
    }


    const now =
      Date.now();


    if (
      now -
      this._lastRender >
      1500
    ) {

      this._lastRender =
        now;

      this._render();
    }
  }


  async _initialize() {

    this._loading = true;

    this._renderLoading();


    try {

      await this._core
        .reloadRegistries();

      this._ensureFloorState();

      await this
        ._loadAllBackgrounds();

      this._loaded = true;
      this._loading = false;

      this._lastRender =
        Date.now();

      this._render();

    } catch (err) {

      console.error(
        "HA IoT Floorplan initialization failed",
        err
      );

      this._loading = false;

      this.innerHTML = `
        <ha-card header="HA IoT Floorplan">
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


  /*
   * =================================================
   * STATE
   * =================================================
   */


  _defaultState() {

    let legacyLayout = {};


    try {

      legacyLayout =
        JSON.parse(
          localStorage.getItem(
            this._legacyLayoutKey
          ) || "{}"
        );

    } catch {

      legacyLayout = {};
    }


    return {

      version: 5,

      initialized: false,

      activeFloorId:
        "ground",

      colors: {

        areaEnabled:
          false,

        categoryEnabled:
          false,

        areas:
          {},

        categories:
          {}
      },

      floors: [

        {
          id:
            "ground",

          name:
            "Ground floor",

          areaIds:
            [],

          layout:
            legacyLayout || {},

          sizePercent:
            100,

          pins:
            {}
        }

      ]
    };
  }


  _loadState() {

    try {

      const raw =
        localStorage.getItem(
          this._stateKey
        );


      if (raw) {

        const state =
          JSON.parse(
            raw
          );


        if (
          state &&
          Array.isArray(
            state.floors
          ) &&
          state.floors.length
        ) {

          this._repairState(
            state
          );

          return state;
        }
      }

    } catch (err) {

      console.warn(
        "HA IoT Floorplan state load failed",
        err
      );
    }


    return this._defaultState();
  }


  _repairState(
    state
  ) {

    state.version =
      5;


    state.colors =
      state.colors ||
      {};


    state.colors.areaEnabled =
      state.colors.areaEnabled ===
      true;


    state.colors.categoryEnabled =
      state.colors.categoryEnabled ===
      true;


    state.colors.areas =
      state.colors.areas &&
      typeof state.colors.areas ===
      "object"
        ? state.colors.areas
        : {};


    state.colors.categories =
      state.colors.categories &&
      typeof state.colors.categories ===
      "object"
        ? state.colors.categories
        : {};


    for (
      const floor
      of state.floors
    ) {

      floor.areaIds =
        Array.isArray(
          floor.areaIds
        )
          ? floor.areaIds
          : [];


      floor.layout =
        floor.layout &&
        typeof floor.layout ===
        "object"
          ? floor.layout
          : {};


      floor.pins =
        floor.pins &&
        typeof floor.pins ===
        "object"
          ? floor.pins
          : {};


      /*
       * v0.4.x migration
       */

      if (
        !Number.isFinite(
          floor.sizePercent
        )
      ) {

        if (
          Number.isFinite(
            floor.maxHeight
          )
        ) {

          floor.sizePercent =
            floor.maxHeight;

        } else {

          floor.sizePercent =
            100;
        }
      }


      floor.sizePercent =
        Math.min(
          150,
          Math.max(
            40,
            floor.sizePercent
          )
        );
    }
  }


  _saveState() {

    localStorage.setItem(
      this._stateKey,
      JSON.stringify(
        this._state
      )
    );
  }


  _ensureFloorState() {

    if (
      !this._state.floors?.length
    ) {

      this._state =
        this._defaultState();
    }


    this._repairState(
      this._state
    );


    if (
      !this._state.floors.some(
        floor =>
          floor.id ===
          this._state.activeFloorId
      )
    ) {

      this._state.activeFloorId =
        this._state
          .floors[0]
          .id;
    }


    if (
      !this._state.initialized
    ) {

      const ground =
        this._state.floors.find(
          floor =>
            floor.id ===
            "ground"
        ) ||
        this._state.floors[0];


      ground.areaIds =
        [
          ...new Set(
            this._core.areas.map(
              area =>
                area.area_id
            )
          )
        ];


      this._state.initialized =
        true;
    }


    this._saveState();
  }


  _activeFloor() {

    return (
      this._state.floors.find(
        floor =>
          floor.id ===
          this._state.activeFloorId
      ) ||
      this._state.floors[0]
    );
  }


  _floorForArea(
    areaId
  ) {

    return (
      this._state.floors.find(
        floor =>
          floor.areaIds.includes(
            areaId
          )
      ) ||
      null
    );
  }


  /*
   * =================================================
   * DEVICE ID HELPERS
   * =================================================
   */


  _deviceKey(
    device
  ) {

    return String(

      device.deviceId
      ??
      device.device_id
      ??
      device.id
      ??
      device.entityId
      ??
      device.entity_id
      ??
      device.mac
      ??
      device.name

    );
  }


  _findDeviceByKey(
    key
  ) {

    if (
      !this._currentData
    ) {
      return null;
    }


    return (
      this._currentData
        .snapshot
        .inventory
        .find(
          device =>
            this._deviceKey(
              device
            ) ===
            key
        )
      ||
      null
    );
  }


  /*
   * =================================================
   * FLOOR MANAGEMENT
   * =================================================
   */


  _switchFloor(
    floorId
  ) {

    if (
      !this._state.floors.some(
        floor =>
          floor.id ===
          floorId
      )
    ) {
      return;
    }


    this._state.activeFloorId =
      floorId;

    this._activeGroup =
      null;

    this._areaManagerOpen =
      false;

    this._colorManagerOpen =
      false;


    this._saveState();

    this._render();
  }


  _addFloor() {

    const name =
      prompt(
        "Name for the new floor:",
        "Basement"
      );


    if (
      !name?.trim()
    ) {
      return;
    }


    const id =
      "floor_" +
      Date.now()
        .toString(36);


    this._state.floors.push({

      id,

      name:
        name.trim(),

      areaIds:
        [],

      layout:
        {},

      pins:
        {},

      sizePercent:
        100
    });


    this._state.activeFloorId =
      id;


    this._saveState();

    this._render();
  }


  _renameFloor() {

    const floor =
      this._activeFloor();


    if (!floor) {
      return;
    }


    const name =
      prompt(
        "Floor name:",
        floor.name
      );


    if (
      !name?.trim()
    ) {
      return;
    }


    floor.name =
      name.trim();


    this._saveState();

    this._render();
  }


  async _deleteFloor() {

    if (
      this._state.floors.length <=
      1
    ) {

      alert(
        "At least one floor must remain."
      );

      return;
    }


    const floor =
      this._activeFloor();


    if (!floor) {
      return;
    }


    if (
      !confirm(
        `Delete floor "${floor.name}"?\n\nIts Areas will become Unassigned.`
      )
    ) {
      return;
    }


    await this
      ._deleteBackgroundForFloor(
        floor.id
      );


    this._state.floors =
      this._state.floors.filter(
        item =>
          item.id !==
          floor.id
      );


    this._state.activeFloorId =
      this._state
        .floors[0]
        .id;


    this._saveState();

    this._render();
  }


  _assignAreaToFloor(
    areaId,
    floorId
  ) {

    for (
      const floor
      of this._state.floors
    ) {

      floor.areaIds =
        floor.areaIds.filter(
          id =>
            id !==
            areaId
        );
    }


    if (floorId) {

      const floor =
        this._state.floors.find(
          item =>
            item.id ===
            floorId
        );


      if (floor) {

        floor.areaIds.push(
          areaId
        );
      }
    }


    this._saveState();

    this._render();
  }


  /*
   * =================================================
   * PINS
   * =================================================
   */


  _isDevicePinned(
    device
  ) {

    const floor =
      this._activeFloor();


    if (!floor) {
      return false;
    }


    return !!floor.pins[
      this._deviceKey(
        device
      )
    ];
  }


  _pinDevice(
    device,
    areaId
  ) {

    const floor =
      this._activeFloor();


    if (!floor) {
      return;
    }


    const key =
      this._deviceKey(
        device
      );


    if (
      floor.pins[
        key
      ]
    ) {
      return;
    }


    /*
     * Start the pin in the centre
     * of its Area box when possible.
     */

    const areaLayout =
      floor.layout[
        areaId
      ];


    let x =
      50;

    let y =
      50;


    if (areaLayout) {

      x =
        areaLayout.x +
        areaLayout.w /
        2;


      y =
        areaLayout.y +
        areaLayout.h /
        2;
    }


    floor.pins[
      key
    ] = {

      x:
        this._clamp(
          x,
          2,
          98
        ),

      y:
        this._clamp(
          y,
          2,
          98
        ),

      areaId:
        areaId ||
        device.areaId ||
        null
    };


    this._saveState();

    this._activeGroup =
      null;

    this._render();
  }


  _unpinDevice(
    key
  ) {

    const floor =
      this._activeFloor();


    if (
      !floor ||
      !floor.pins[
        key
      ]
    ) {
      return;
    }


    delete floor.pins[
      key
    ];


    this._saveState();

    this._render();
  }


  _renderPins() {

    const floor =
      this._activeFloor();


    if (!floor) {
      return "";
    }


    return Object.entries(
      floor.pins
    )
      .map(
        (
          [
            key,
            pin
          ]
        ) => {

          const device =
            this._findDeviceByKey(
              key
            );


          if (!device) {
            return "";
          }


          /*
           * Only show pins whose HA Area
           * still belongs to this floor.
           */

          if (
            device.areaId &&
            !floor.areaIds.includes(
              device.areaId
            )
          ) {
            return "";
          }


          const category =
            this._core
              .getResolvedCategory(
                device
              );


          const icon =
            this._core
              .categoryIcon(
                category
              );


          const categoryColor =
            this._categoryColor(
              category
            );


          const areaColor =
            this._areaColor(
              device.areaId
            );


          const areaEnabled =
            this._state
              .colors
              .areaEnabled;


          const categoryEnabled =
            this._state
              .colors
              .categoryEnabled;


          return `
            <div
              class="
                device-pin
                ${
                  this._editMode
                    ? "device-pin-edit"
                    : ""
                }
              "
              data-pin-key="${
                this._escapeHtml(
                  key
                )
              }"
              data-device-detail="${
                this._escapeHtml(
                  key
                )
              }"
              style="
                left:${pin.x}%;
                top:${pin.y}%;
                ${
                  areaEnabled
                    ? `--pin-ring:${areaColor};`
                    : ""
                }
              "
              title="${
                this._escapeHtml(
                  device.name
                )
              }"
            >

              ${
                this._editMode
                  ? `
                    <button
                      class="pin-remove"
                      data-unpin-key="${
                        this._escapeHtml(
                          key
                        )
                      }"
                      title="Return to group"
                    >
                      ×
                    </button>
                  `
                  : ""
              }


              <div class="pin-circle">

                <ha-icon
                  icon="${
                    this._escapeHtml(
                      icon
                    )
                  }"
                  ${
                    categoryEnabled
                      ? `style="color:${categoryColor}"`
                      : ""
                  }
                ></ha-icon>

                <span
                  class="
                    pin-status
                    ${
                      device.online
                        ? "online"
                        : "offline"
                    }
                  "
                ></span>

              </div>


              <div class="pin-label">

                ${
                  this._escapeHtml(
                    device.name
                  )
                }

              </div>

            </div>
          `;
        }
      )
      .join("");
  }


  _startPinDrag(
    event,
    key
  ) {

    if (
      !this._editMode
    ) {
      return;
    }


    const floor =
      this._activeFloor();


    const canvas =
      this._getCanvas();


    const pin =
      floor?.pins[
        key
      ];


    if (
      !floor ||
      !canvas ||
      !pin
    ) {
      return;
    }


    event.preventDefault();

    event.stopPropagation();


    const rect =
      canvas
        .getBoundingClientRect();


    this._pinDragState = {

      key,

      startX:
        event.clientX,

      startY:
        event.clientY,

      canvasW:
        rect.width,

      canvasH:
        rect.height,

      originalX:
        pin.x,

      originalY:
        pin.y
    };


    const move =
      e =>
        this._pinDragMove(
          e
        );


    const end =
      () => {

        window.removeEventListener(
          "pointermove",
          move
        );


        window.removeEventListener(
          "pointerup",
          end
        );


        this._pinDragState =
          null;


        this._saveState();
      };


    window.addEventListener(
      "pointermove",
      move
    );


    window.addEventListener(
      "pointerup",
      end
    );
  }


  _pinDragMove(
    event
  ) {

    if (
      !this._pinDragState
    ) {
      return;
    }


    const state =
      this._pinDragState;


    const floor =
      this._activeFloor();


    const pin =
      floor.pins[
        state.key
      ];


    const dx =
      (
        event.clientX -
        state.startX
      ) /
      state.canvasW *
      100;


    const dy =
      (
        event.clientY -
        state.startY
      ) /
      state.canvasH *
      100;


    pin.x =
      this._clamp(
        state.originalX +
        dx,
        1,
        99
      );


    pin.y =
      this._clamp(
        state.originalY +
        dy,
        1,
        99
      );


    const element =
      this.querySelector(
        `.device-pin[data-pin-key="${CSS.escape(
          state.key
        )}"]`
      );


    if (element) {

      element.style.left =
        `${pin.x}%`;

      element.style.top =
        `${pin.y}%`;
    }
  }


  /*
   * =================================================
   * COLORS
   * =================================================
   */


  _areaPalette() {

    return [
      "#4caf50",
      "#00bcd4",
      "#ff9800",
      "#ab47bc",
      "#ef5350",
      "#26a69a",
      "#ffee58",
      "#5c6bc0",
      "#ec407a",
      "#8d6e63",
      "#42a5f5",
      "#9ccc65"
    ];
  }


  _categoryDefaults() {

    return {

      camera:
        "#42a5f5",

      sensor:
        "#ffee58",

      lighting:
        "#ffca28",

      switch:
        "#26a69a",

      server:
        "#ab47bc",

      nas:
        "#7e57c2",

      network:
        "#29b6f6",

      mobile:
        "#ec407a",

      tablet:
        "#ef5350",

      computer:
        "#66bb6a",

      media:
        "#ffa726",

      printer:
        "#8d6e63",

      vacuum:
        "#78909c",

      appliance:
        "#26c6da",

      other:
        "#bdbdbd"
    };
  }


  _knownCategories() {

    return [
      "camera",
      "sensor",
      "lighting",
      "switch",
      "server",
      "nas",
      "network",
      "mobile",
      "tablet",
      "computer",
      "media",
      "printer",
      "vacuum",
      "appliance",
      "other"
    ];
  }


  _areaColor(
    areaId
  ) {

    if (!areaId) {
      return "#00a8ff";
    }


    const custom =
      this._state
        .colors
        .areas[
          areaId
        ];


    if (custom) {
      return custom;
    }


    const areas =
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


    const index =
      Math.max(
        0,
        areas.findIndex(
          area =>
            area.area_id ===
            areaId
        )
      );


    const palette =
      this._areaPalette();


    return palette[
      index %
      palette.length
    ];
  }


  _categoryColor(
    category
  ) {

    const custom =
      this._state
        .colors
        .categories[
          category
        ];


    if (custom) {
      return custom;
    }


    const defaults =
      this._categoryDefaults();


    return (
      defaults[
        category
      ] ||
      "#bdbdbd"
    );
  }


  _setAreaColor(
    areaId,
    color
  ) {

    this._state
      .colors
      .areas[
        areaId
      ] =
      color;


    this._saveState();

    this._render();
  }


  _resetAreaColor(
    areaId
  ) {

    delete this._state
      .colors
      .areas[
        areaId
      ];


    this._saveState();

    this._render();
  }


  _setCategoryColor(
    category,
    color
  ) {

    this._state
      .colors
      .categories[
        category
      ] =
      color;


    this._saveState();

    this._render();
  }


  _resetCategoryColor(
    category
  ) {

    delete this._state
      .colors
      .categories[
        category
      ];


    this._saveState();

    this._render();
  }


  _renderColorManagerModal() {

    if (
      !this._colorManagerOpen
    ) {
      return "";
    }


    const areas =
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
      <div
        class="modal-backdrop"
        id="color-modal-backdrop"
      >

        <div
          class="
            modal
            color-modal
          "
        >

          <div class="modal-header">

            <div class="modal-title">

              <ha-icon
                icon="mdi:palette"
              ></ha-icon>

              Colors

            </div>


            <button
              class="modal-close"
              id="close-colors"
            >
              ×
            </button>

          </div>


          <div class="color-switches">

            <label class="color-switch">

              <input
                id="area-color-enabled"
                type="checkbox"
                ${
                  this._state
                    .colors
                    .areaEnabled
                    ? "checked"
                    : ""
                }
              >

              Area colors

            </label>


            <label class="color-switch">

              <input
                id="category-color-enabled"
                type="checkbox"
                ${
                  this._state
                    .colors
                    .categoryEnabled
                    ? "checked"
                    : ""
                }
              >

              Category colors

            </label>

          </div>


          <div class="color-section-title">
            Areas
          </div>


          ${
            areas
              .map(
                area => `

                  <div class="color-row">

                    <div class="color-name">
                      ${
                        this._escapeHtml(
                          area.name
                        )
                      }
                    </div>


                    <input
                      type="color"
                      class="color-picker"
                      data-area-color="${
                        this._escapeHtml(
                          area.area_id
                        )
                      }"
                      value="${
                        this._areaColor(
                          area.area_id
                        )
                      }"
                    >


                    <button
                      class="color-reset"
                      data-reset-area="${
                        this._escapeHtml(
                          area.area_id
                        )
                      }"
                    >
                      Reset
                    </button>

                  </div>

                `
              )
              .join("")
          }


          <div class="color-section-title">
            Categories
          </div>


          ${
            this._knownCategories()
              .map(
                category => `

                  <div class="color-row">

                    <div class="color-name">

                      ${
                        this._escapeHtml(
                          this._core
                            .categoryTitle(
                              category
                            )
                        )
                      }

                    </div>


                    <input
                      type="color"
                      class="color-picker"
                      data-category-color="${
                        this._escapeHtml(
                          category
                        )
                      }"
                      value="${
                        this._categoryColor(
                          category
                        )
                      }"
                    >


                    <button
                      class="color-reset"
                      data-reset-category="${
                        this._escapeHtml(
                          category
                        )
                      }"
                    >
                      Reset
                    </button>

                  </div>

                `
              )
              .join("")
          }

        </div>

      </div>
    `;
  }


  /*
   * =================================================
   * SIZE CONTROL
   * =================================================
   */


  _setFloorSize(
    value,
    save = true
  ) {

    const floor =
      this._activeFloor();


    if (!floor) {
      return;
    }


    const numeric =
      Math.min(
        150,
        Math.max(
          40,
          Number(value) ||
          100
        )
      );


    floor.sizePercent =
      numeric;


    const label =
      this.querySelector(
        "#size-value"
      );


    if (label) {

      label.textContent =
        `${numeric}%`;
    }


    this._applyPlanSize();


    if (save) {

      this._saveState();
    }
  }


  _applyPlanSize() {

    const floor =
      this._activeFloor();


    const holder =
      this.querySelector(
        "#floorplan"
      );


    const stage =
      this.querySelector(
        "#plan-stage"
      );


    if (
      !floor ||
      !holder ||
      !stage
    ) {
      return;
    }


    const sizePercent =
      floor.sizePercent ||
      100;


    const image =
      this.querySelector(
        ".floorplan-image"
      );


    let naturalWidth =
      1600;

    let naturalHeight =
      900;


    if (image) {

      if (
        !image.complete ||
        !image.naturalWidth ||
        !image.naturalHeight
      ) {
        return;
      }


      naturalWidth =
        image.naturalWidth;


      naturalHeight =
        image.naturalHeight;
    }


    const availableWidth =
      holder.clientWidth;


    if (
      !availableWidth
    ) {
      return;
    }


    const viewportHeight =
      Math.max(
        1,
        window.innerHeight ||
        document.documentElement
          .clientHeight ||
        900
      );


    const widthFitScale =
      availableWidth /
      naturalWidth;


    const viewportFitScale =
      viewportHeight /
      naturalHeight;


    const baseScale =
      Math.min(
        widthFitScale,
        viewportFitScale
      );


    const requestedScale =
      baseScale *
      (
        sizePercent /
        100
      );


    const finalScale =
      Math.min(
        requestedScale,
        widthFitScale
      );


    const renderWidth =
      naturalWidth *
      finalScale;


    const renderHeight =
      naturalHeight *
      finalScale;


    stage.style.width =
      `${renderWidth}px`;


    stage.style.height =
      `${renderHeight}px`;


    if (image) {

      image.style.width =
        "100%";


      image.style.height =
        "100%";
    }


    const widthLimited =
      requestedScale >=
      widthFitScale -
      0.0001;


    const status =
      this.querySelector(
        "#size-status"
      );


    if (status) {

      status.textContent =
        widthLimited

          ? "Width limit reached"

          : `${Math.round(
              renderWidth
            )} × ${Math.round(
              renderHeight
            )} px`;
    }
  }


  /*
   * =================================================
   * BACKGROUND DATABASE
   * =================================================
   */


  _openBackgroundDb() {

    return new Promise(
      (
        resolve,
        reject
      ) => {

        const request =
          indexedDB.open(
            "ha_iot_floorplan",
            1
          );


        request.onupgradeneeded =
          event => {

            const db =
              event.target.result;


            if (
              !db.objectStoreNames
                .contains(
                  "settings"
                )
            ) {

              db.createObjectStore(
                "settings"
              );
            }
          };


        request.onsuccess =
          () =>
            resolve(
              request.result
            );


        request.onerror =
          () =>
            reject(
              request.error
            );
      }
    );
  }


  _backgroundKey(
    floorId
  ) {

    return (
      `background:${floorId}`
    );
  }


  _dbGet(
    db,
    key
  ) {

    return new Promise(
      (
        resolve,
        reject
      ) => {

        const tx =
          db.transaction(
            "settings",
            "readonly"
          );


        const request =
          tx
            .objectStore(
              "settings"
            )
            .get(
              key
            );


        request.onsuccess =
          () =>
            resolve(
              request.result ||
              null
            );


        request.onerror =
          () =>
            reject(
              request.error
            );
      }
    );
  }


  _dbPut(
    db,
    key,
    value
  ) {

    return new Promise(
      (
        resolve,
        reject
      ) => {

        const tx =
          db.transaction(
            "settings",
            "readwrite"
          );


        tx
          .objectStore(
            "settings"
          )
          .put(
            value,
            key
          );


        tx.oncomplete =
          () =>
            resolve();


        tx.onerror =
          () =>
            reject(
              tx.error
            );
      }
    );
  }


  _dbDelete(
    db,
    key
  ) {

    return new Promise(
      (
        resolve,
        reject
      ) => {

        const tx =
          db.transaction(
            "settings",
            "readwrite"
          );


        tx
          .objectStore(
            "settings"
          )
          .delete(
            key
          );


        tx.oncomplete =
          () =>
            resolve();


        tx.onerror =
          () =>
            reject(
              tx.error
            );
      }
    );
  }


  _setBackgroundObjectUrl(
    floorId,
    blob
  ) {

    if (
      this._backgroundUrls[
        floorId
      ]
    ) {

      URL.revokeObjectURL(
        this._backgroundUrls[
          floorId
        ]
      );
    }


    this._backgroundBlobs[
      floorId
    ] =
      blob;


    this._backgroundUrls[
      floorId
    ] =
      URL.createObjectURL(
        blob
      );
  }


  async _loadAllBackgrounds() {

    const db =
      await this
        ._openBackgroundDb();


    const groundKey =
      this._backgroundKey(
        "ground"
      );


    const groundImage =
      await this._dbGet(
        db,
        groundKey
      );


    if (!groundImage) {

      const legacy =
        await this._dbGet(
          db,
          "background"
        );


      if (legacy) {

        await this._dbPut(
          db,
          groundKey,
          legacy
        );


        await this._dbDelete(
          db,
          "background"
        );
      }
    }


    for (
      const floor
      of this._state.floors
    ) {

      const blob =
        await this._dbGet(
          db,
          this._backgroundKey(
            floor.id
          )
        );


      if (blob) {

        this._setBackgroundObjectUrl(
          floor.id,
          blob
        );
      }
    }


    db.close();
  }


  async _saveUploadedBackground(
    file
  ) {

    const floor =
      this._activeFloor();


    if (!floor) {
      return;
    }


    const db =
      await this
        ._openBackgroundDb();


    await this._dbPut(
      db,
      this._backgroundKey(
        floor.id
      ),
      file
    );


    db.close();


    this._setBackgroundObjectUrl(
      floor.id,
      file
    );


    this._render();
  }


  async _deleteBackgroundForFloor(
    floorId
  ) {

    try {

      const db =
        await this
          ._openBackgroundDb();


      await this._dbDelete(
        db,
        this._backgroundKey(
          floorId
        )
      );


      db.close();

    } catch (err) {

      console.warn(
        "Background delete failed",
        err
      );
    }


    if (
      this._backgroundUrls[
        floorId
      ]
    ) {

      URL.revokeObjectURL(
        this._backgroundUrls[
          floorId
        ]
      );
    }


    delete this._backgroundUrls[
      floorId
    ];

    delete this._backgroundBlobs[
      floorId
    ];
  }


  async _removeUploadedBackground() {

    const floor =
      this._activeFloor();


    if (!floor) {
      return;
    }


    await this
      ._deleteBackgroundForFloor(
        floor.id
      );


    this._render();
  }


  _getBackground() {

    const floor =
      this._activeFloor();


    if (!floor) {
      return null;
    }


    return (

      this._backgroundUrls[
        floor.id
      ]

      ||

      (
        floor.id ===
        "ground"
          ? this._config.background
          : null
      )

      ||

      null
    );
  }


  /*
   * =================================================
   * INVENTORY
   * =================================================
   */


  _getFloorplanData() {

    const snapshot =
      this._core.getSnapshot();


    const floor =
      this._activeFloor();


    const floorAreaIds =
      new Set(
        floor?.areaIds ||
        []
      );


    const devicesByArea =
      new Map();


    for (
      const device
      of snapshot.inventory
    ) {

      const classification =
        this._core
          .getEffectiveClassification(
            device
          );


      if (
        classification !==
        "fixed"
      ) {
        continue;
      }


      if (
        !device.areaId ||
        !floorAreaIds.has(
          device.areaId
        )
      ) {
        continue;
      }


      if (
        !devicesByArea.has(
          device.areaId
        )
      ) {

        devicesByArea.set(
          device.areaId,
          []
        );
      }


      devicesByArea
        .get(
          device.areaId
        )
        .push(
          device
        );
    }


    const areas =
      this._core.areas

        .filter(
          area =>
            floorAreaIds.has(
              area.area_id
            )
        )

        .map(
          area => ({

            areaId:
              area.area_id,

            areaName:
              area.name,

            devices:
              devicesByArea.get(
                area.area_id
              ) || []

          })
        )

        .sort(
          (
            a,
            b
          ) =>
            a.areaName.localeCompare(
              b.areaName
            )
        );


    for (
      const area
      of areas
    ) {

      area.devices.sort(
        (
          a,
          b
        ) =>
          a.name.localeCompare(
            b.name
          )
      );
    }


    return {

      floor,

      areas,

      floating:
        snapshot.groups
          .floating,

      snapshot
    };
  }


  /*
   * =================================================
   * HYBRID GROUPING
   * =================================================
   */


  _buildRoomItems(
    area
  ) {

    const groups =
      new Map();


    /*
     * Pinned devices are deliberately
     * removed from normal grouping.
     */

    const visibleDevices =
      area.devices.filter(
        device =>
          !this._isDevicePinned(
            device
          )
      );


    for (
      const device
      of visibleDevices
    ) {

      const category =
        this._core
          .getResolvedCategory(
            device
          );


      if (
        !groups.has(
          category
        )
      ) {

        groups.set(
          category,
          []
        );
      }


      groups
        .get(
          category
        )
        .push(
          device
        );
    }


    const result =
      [];


    for (
      const [
        category,
        devices
      ]
      of groups.entries()
    ) {

      if (
        devices.length ===
        1
      ) {

        result.push({

          type:
            "device",

          category,

          device:
            devices[0]

        });

      } else {

        result.push({

          type:
            "group",

          category,

          devices

        });
      }
    }


    result.sort(
      (
        a,
        b
      ) => {

        const ac =
          a.type ===
          "group"
            ? a.devices.length
            : 1;


        const bc =
          b.type ===
          "group"
            ? b.devices.length
            : 1;


        return (
          bc -
          ac
        );
      }
    );


    return result;
  }


  /*
   * =================================================
   * ROOM GEOMETRY
   * =================================================
   */


  _ensureLayout(
    areas
  ) {

    const floor =
      this._activeFloor();


    if (!floor) {
      return;
    }


    floor.layout =
      floor.layout ||
      {};


    const missing =
      areas.filter(
        area =>
          !floor.layout[
            area.areaId
          ]
      );


    if (
      !missing.length
    ) {
      return;
    }


    const count =
      Math.max(
        areas.length,
        1
      );


    const cols =
      Math.max(
        1,
        Math.ceil(
          Math.sqrt(
            count *
            1.6
          )
        )
      );


    const rows =
      Math.max(
        1,
        Math.ceil(
          count /
          cols
        )
      );


    const gapX =
      1.2;

    const gapY =
      1.8;


    const cellW =
      (
        100 -
        gapX *
        (
          cols +
          1
        )
      ) /
      cols;


    const cellH =
      (
        100 -
        gapY *
        (
          rows +
          1
        )
      ) /
      rows;


    areas.forEach(
      (
        area,
        index
      ) => {

        if (
          floor.layout[
            area.areaId
          ]
        ) {
          return;
        }


        const col =
          index %
          cols;


        const row =
          Math.floor(
            index /
            cols
          );


        floor.layout[
          area.areaId
        ] = {

          x:
            gapX +
            col *
            (
              cellW +
              gapX
            ),

          y:
            gapY +
            row *
            (
              cellH +
              gapY
            ),

          w:
            cellW,

          h:
            cellH
        };
      }
    );


    this._saveState();
  }


  _toggleEditMode() {

    this._editMode =
      !this._editMode;


    this._activeGroup =
      null;


    this._render();
  }


  _resetLayout() {

    const floor =
      this._activeFloor();


    if (!floor) {
      return;
    }


    if (
      !confirm(
        `Reset room positions for "${floor.name}"?`
      )
    ) {
      return;
    }


    floor.layout =
      {};


    this._saveState();

    this._render();
  }


  /*
   * =================================================
   * MAIN UI
   * =================================================
   */


  _render() {

    if (
      !this._loaded
    ) {
      return;
    }


    const data =
      this._getFloorplanData();


    this._currentData =
      data;


    this._ensureLayout(
      data.areas
    );


    const background =
      this._getBackground();


    const sizePercent =
      data.floor.sizePercent ||
      100;


    const unassignedCount =
      this._core.areas.filter(
        area =>
          !this._floorForArea(
            area.area_id
          )
      ).length;


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
            gap:14px;
            margin-bottom:12px;
          }


          .title {
            font-size:24px;
            font-weight:500;
          }


          .subtitle {
            font-size:12px;
            opacity:.6;
          }


          .controls,
          .floor-tabs,
          .floor-tools {
            display:flex;
            gap:7px;
            flex-wrap:wrap;
            align-items:center;
          }


          .button,
          .floor-tab {
            border:
              1px solid
              var(--divider-color);
            background:
              var(--secondary-background-color);
            color:
              var(--primary-text-color);
            padding:7px 11px;
            border-radius:8px;
            cursor:pointer;
          }


          .floor-tabs {
            margin-bottom:12px;
          }


          .floor-tab {
            border-radius:999px;
            font-size:12px;
          }


          .floor-tab.active {
            border-color:#00a8ff;
            color:#00a8ff;
            background:
              rgba(0,168,255,.13);
          }


          .add-floor {
            width:31px;
            height:31px;
            border-radius:50%;
            border:
              1px solid
              var(--divider-color);
            background:
              var(--secondary-background-color);
            color:
              var(--primary-text-color);
            cursor:pointer;
            font-size:18px;
          }


          .floor-tools {
            margin-left:auto;
          }


          .button.active {
            border-color:#00a8ff;
            color:#00a8ff;
          }


          .danger {
            border-color:
              var(--error-color,#f44336);
          }


          .edit-note {
            margin:8px 0 12px;
            padding:8px 10px;
            border-radius:7px;
            background:
              rgba(0,168,255,.10);
            font-size:11px;
          }


          /*
           * SIZE
           */

          .size-control {
            display:flex;
            align-items:center;
            gap:10px;
            margin:8px 0 12px;
            padding:9px 11px;
            border-radius:8px;
            background:
              rgba(255,255,255,.035);
            border:
              1px solid
              var(--divider-color);
          }


          .size-label {
            min-width:105px;
            font-size:11px;
            font-weight:600;
          }


          .size-slider {
            flex:1;
            max-width:520px;
            accent-color:#00a8ff;
          }


          .size-value {
            min-width:45px;
            font-size:11px;
            color:#00a8ff;
            text-align:right;
          }


          .size-status {
            min-width:120px;
            font-size:10px;
            opacity:.45;
          }


          /*
           * FLOORPLAN
           */

          .floorplan {
            position:relative;
            width:100%;
            overflow:hidden;
            display:flex;
            justify-content:center;
            align-items:flex-start;
            border:
              1px solid
              var(--divider-color);
            border-radius:12px;
            background:#05090f;
          }


          .plan-stage {
            position:relative;
            flex:0 0 auto;
            line-height:0;
          }


          .floorplan-image {
            display:block;
            width:100%;
            height:100%;
            object-fit:fill;
            pointer-events:none;
            user-select:none;
          }


          .blank-stage {
            background-image:
              linear-gradient(
                to right,
                rgba(127,127,127,.07) 1px,
                transparent 1px
              ),
              linear-gradient(
                to bottom,
                rgba(127,127,127,.07) 1px,
                transparent 1px
              );
            background-size:
              40px 40px;
          }


          .area-layer,
          .pin-layer {
            position:absolute;
            inset:0;
            line-height:normal;
          }


          .pin-layer {
            pointer-events:none;
            z-index:20;
          }


          /*
           * AREAS
           */

          .area {
            position:absolute;
            box-sizing:border-box;
            overflow:hidden;
            border-radius:9px;
            border:
              1px solid
              rgba(255,255,255,.15);
            background:
              rgba(5,12,22,.48);
          }


          .area.area-colored {
            border-color:
              var(--area-accent);
            box-shadow:
              inset 0 0 0 1px
              color-mix(
                in srgb,
                var(--area-accent) 35%,
                transparent
              );
          }


          .edit-mode .area {
            border:
              2px dashed
              #00a8ff;
            background:
              rgba(0,168,255,.09);
          }


          .edit-mode
          .area.area-colored {
            border-color:
              var(--area-accent);
          }


          .area-header {
            height:29px;
            box-sizing:border-box;
            display:flex;
            align-items:center;
            justify-content:space-between;
            padding:5px 8px;
            background:
              rgba(2,8,16,.78);
            font-size:11px;
            font-weight:600;
          }


          .area.area-colored
          .area-header {
            border-left:
              3px solid
              var(--area-accent);
          }


          .edit-mode
          .area-header {
            cursor:move;
            touch-action:none;
          }


          .area-count {
            font-size:9px;
            opacity:.5;
          }


          .devices {
            display:grid;
            grid-template-columns:
              repeat(
                auto-fill,
                minmax(70px,1fr)
              );
            gap:5px;
            padding:6px;
            max-height:
              calc(100% - 29px);
            overflow:auto;
            box-sizing:border-box;
          }


          /*
           * ROOM ITEMS
           */

          .room-item {
            position:relative;
            min-height:61px;
            border-radius:7px;
            border:
              1px solid
              rgba(255,255,255,.08);
            background:
              rgba(6,13,22,.84);
            display:flex;
            flex-direction:column;
            align-items:center;
            justify-content:center;
            gap:3px;
            padding:5px;
            text-align:center;
            box-sizing:border-box;
          }


          .group-item {
            cursor:pointer;
            border-color:
              rgba(0,168,255,.35);
          }


          .group-item:hover {
            border-color:#00a8ff;
            background:
              rgba(0,100,180,.20);
          }


          .room-item ha-icon {
            --mdc-icon-size:20px;
          }


          .item-name {
            width:100%;
            font-size:9px;
            font-weight:600;
            overflow:hidden;
            text-overflow:ellipsis;
            white-space:nowrap;
          }


          .item-category {
            font-size:8px;
            opacity:.5;
          }


          .group-count {
            position:absolute;
            top:4px;
            right:4px;
            min-width:17px;
            height:17px;
            border-radius:999px;
            padding:0 4px;
            background:#00a8ff;
            color:white;
            font-size:9px;
            display:flex;
            align-items:center;
            justify-content:center;
          }


          .single-pin-button {
            display:none;
            position:absolute;
            left:3px;
            top:3px;
            width:20px;
            height:20px;
            padding:0;
            border:
              1px solid
              rgba(0,168,255,.5);
            border-radius:50%;
            background:#07131f;
            color:#00a8ff;
            cursor:pointer;
            align-items:center;
            justify-content:center;
          }


          .edit-mode
          .single-pin-button {
            display:flex;
          }


          .single-pin-button
          ha-icon {
            --mdc-icon-size:13px;
          }


          .status {
            position:absolute;
            top:5px;
            right:5px;
            width:7px;
            height:7px;
            border-radius:50%;
          }


          .online {
            background:#4caf50;
          }


          .offline {
            background:#777;
          }


          .empty-room {
            padding:10px;
            font-size:10px;
            opacity:.4;
          }


          .resize-handle {
            display:none;
            position:absolute;
            right:0;
            bottom:0;
            width:18px;
            height:18px;
            cursor:nwse-resize;
            touch-action:none;
          }


          .edit-mode
          .resize-handle {
            display:block;
          }


          .resize-handle::after {
            content:"";
            position:absolute;
            right:4px;
            bottom:4px;
            width:8px;
            height:8px;
            border-right:
              2px solid #00a8ff;
            border-bottom:
              2px solid #00a8ff;
          }


          /*
           * INDIVIDUAL MAP PINS
           */

          .device-pin {
            --pin-ring:#00a8ff;
            position:absolute;
            transform:
              translate(-50%,-50%);
            pointer-events:auto;
            display:flex;
            flex-direction:column;
            align-items:center;
            z-index:30;
          }


          .device-pin-edit {
            cursor:move;
            touch-action:none;
          }


          .pin-circle {
            position:relative;
            width:42px;
            height:42px;
            border-radius:50%;
            display:flex;
            align-items:center;
            justify-content:center;
            background:
              rgba(4,13,23,.96);
            border:
              2px solid
              var(--pin-ring);
            box-shadow:
              0 0 7px
              color-mix(
                in srgb,
                var(--pin-ring) 45%,
                transparent
              );
          }


          .pin-circle ha-icon {
            --mdc-icon-size:23px;
          }


          .pin-status {
            position:absolute;
            right:1px;
            top:1px;
            width:8px;
            height:8px;
            border-radius:50%;
            border:
              1px solid #07131f;
          }


          .pin-label {
            margin-top:3px;
            max-width:100px;
            padding:2px 5px;
            border-radius:999px;
            background:
              rgba(0,0,0,.82);
            color:
              var(--primary-text-color);
            font-size:8px;
            line-height:12px;
            white-space:nowrap;
            overflow:hidden;
            text-overflow:ellipsis;
          }


          .pin-remove {
            display:none;
            position:absolute;
            z-index:4;
            right:-8px;
            top:-8px;
            width:20px;
            height:20px;
            padding:0;
            border-radius:50%;
            border:
              1px solid
              var(--error-color,#f44336);
            background:#161616;
            color:
              var(--error-color,#f44336);
            cursor:pointer;
            align-items:center;
            justify-content:center;
          }


          .device-pin-edit
          .pin-remove {
            display:flex;
          }


          /*
           * FLOATING
           */

          .floating {
            margin-top:16px;
          }


          .floating-title {
            font-size:14px;
            font-weight:600;
            margin-bottom:7px;
          }


          .floating-strip {
            display:flex;
            flex-wrap:wrap;
            gap:6px;
          }


          .floating-device {
            display:flex;
            align-items:center;
            gap:6px;
            border:
              1px solid
              var(--divider-color);
            border-radius:999px;
            padding:6px 9px;
            font-size:10px;
          }


          .floating-device
          ha-icon {
            --mdc-icon-size:16px;
          }


          .floating-dot {
            width:7px;
            height:7px;
            border-radius:50%;
          }


          /*
           * MODALS
           */

          .modal-backdrop {
            position:fixed;
            inset:0;
            z-index:9999;
            display:flex;
            justify-content:center;
            align-items:center;
            background:
              rgba(0,0,0,.72);
            padding:20px;
          }


          .modal {
            width:
              min(650px,94vw);
            max-height:82vh;
            overflow:auto;
            border:
              1px solid
              rgba(0,168,255,.45);
            border-radius:14px;
            background:
              var(--card-background-color);
          }


          .color-modal {
            width:
              min(700px,94vw);
          }


          .modal-header {
            position:sticky;
            top:0;
            z-index:2;
            display:flex;
            justify-content:space-between;
            align-items:center;
            padding:13px 16px;
            border-bottom:
              1px solid
              var(--divider-color);
            background:
              var(--card-background-color);
          }


          .modal-title {
            display:flex;
            align-items:center;
            gap:8px;
            font-size:16px;
            font-weight:600;
          }


          .modal-close {
            border:0;
            background:transparent;
            color:
              var(--primary-text-color);
            font-size:24px;
            cursor:pointer;
          }


          .modal-device {
            display:grid;
            grid-template-columns:
              30px 1fr auto;
            gap:10px;
            align-items:center;
            padding:10px 16px;
            border-bottom:
              1px solid
              var(--divider-color);
          }


          .modal-device-name {
            font-size:12px;
            font-weight:600;
          }


          .modal-device-details {
            font-size:10px;
            opacity:.5;
          }


          .modal-status {
            width:8px;
            height:8px;
            border-radius:50%;
          }


          .pin-action {
            border:
              1px solid #00a8ff;
            border-radius:7px;
            background:
              rgba(0,168,255,.10);
            color:#00a8ff;
            padding:5px 8px;
            cursor:pointer;
            font-size:10px;
          }


          /*
           * DEVICE DETAILS
           */

          .device-detail-trigger {
            cursor:pointer;
          }


          .device-detail-trigger:hover {
            filter:brightness(1.10);
          }


          .device-detail-backdrop {
            z-index:10001;
          }


          .device-detail-modal {
            width:min(780px,94vw);
          }


          .detail-hero {
            display:grid;
            grid-template-columns:46px 1fr auto;
            gap:12px;
            align-items:center;
            padding:16px;
            border-bottom:1px solid var(--divider-color);
          }


          .detail-icon {
            width:42px;
            height:42px;
            border-radius:50%;
            display:flex;
            align-items:center;
            justify-content:center;
            background:rgba(0,168,255,.12);
            border:1px solid rgba(0,168,255,.28);
          }


          .detail-icon ha-icon {
            --mdc-icon-size:24px;
          }


          .detail-name {
            font-size:18px;
            font-weight:650;
          }


          .detail-subtitle {
            margin-top:3px;
            font-size:11px;
            opacity:.58;
          }


          .detail-status {
            display:flex;
            align-items:center;
            gap:7px;
            padding:6px 9px;
            border:1px solid var(--divider-color);
            border-radius:999px;
            font-size:11px;
          }


          .detail-status-dot {
            width:8px;
            height:8px;
            border-radius:50%;
          }


          .detail-body {
            padding:14px 16px 18px;
          }


          .detail-section {
            margin-top:14px;
          }


          .detail-section:first-child {
            margin-top:0;
          }


          .detail-section-title {
            margin-bottom:7px;
            font-size:11px;
            font-weight:700;
            letter-spacing:.05em;
            text-transform:uppercase;
            opacity:.58;
          }


          .detail-grid {
            display:grid;
            grid-template-columns:minmax(120px,170px) minmax(0,1fr);
            border:1px solid var(--divider-color);
            border-radius:9px;
            overflow:hidden;
          }


          .detail-label,
          .detail-value {
            padding:7px 9px;
            border-bottom:1px solid var(--divider-color);
            font-size:11px;
            line-height:1.4;
          }


          .detail-label {
            background:rgba(255,255,255,.03);
            opacity:.6;
          }


          .detail-value {
            overflow-wrap:anywhere;
          }


          .detail-grid > :nth-last-child(-n+2) {
            border-bottom:0;
          }


          .detail-entities {
            border:1px solid var(--divider-color);
            border-radius:9px;
            overflow:hidden;
          }


          .detail-entities summary {
            padding:8px 10px;
            cursor:pointer;
            font-size:11px;
            font-weight:600;
            background:rgba(255,255,255,.03);
          }


          .entity-list {
            padding:8px 10px;
            display:flex;
            flex-direction:column;
            gap:5px;
          }


          .entity-id {
            font-family:monospace;
            font-size:10px;
            overflow-wrap:anywhere;
            opacity:.78;
          }


          .merged-source {
            padding:9px 10px;
            border-bottom:1px solid var(--divider-color);
          }


          .merged-source:last-child {
            border-bottom:0;
          }


          .merged-source-name {
            font-size:11px;
            font-weight:600;
          }


          .merged-source-detail {
            margin-top:3px;
            font-size:10px;
            opacity:.55;
            overflow-wrap:anywhere;
          }


          @media (max-width:600px) {
            .detail-grid {
              grid-template-columns:110px minmax(0,1fr);
            }

            .detail-hero {
              grid-template-columns:40px 1fr;
            }

            .detail-status {
              grid-column:1 / -1;
              justify-self:start;
            }
          }


          /*
           * AREA ASSIGNMENT
           */

          .area-assignment {
            display:grid;
            grid-template-columns:
              1fr 210px;
            gap:12px;
            align-items:center;
            padding:10px 16px;
            border-bottom:
              1px solid
              var(--divider-color);
          }


          .area-name {
            font-size:12px;
            font-weight:600;
          }


          .floor-select {
            width:100%;
            padding:7px 9px;
            border-radius:7px;
            border:
              1px solid
              var(--divider-color);
            background:
              var(--card-background-color);
            color:
              var(--primary-text-color);
          }


          /*
           * COLORS
           */

          .color-switches {
            display:flex;
            gap:22px;
            padding:14px 16px;
            border-bottom:
              1px solid
              var(--divider-color);
          }


          .color-switch {
            display:flex;
            align-items:center;
            gap:7px;
            font-size:12px;
            cursor:pointer;
          }


          .color-section-title {
            padding:14px 16px 7px;
            font-size:13px;
            font-weight:700;
            color:#00a8ff;
          }


          .color-row {
            display:grid;
            grid-template-columns:
              1fr 60px 70px;
            gap:10px;
            align-items:center;
            padding:7px 16px;
            border-bottom:
              1px solid
              rgba(127,127,127,.10);
          }


          .color-name {
            font-size:11px;
          }


          .color-picker {
            width:48px;
            height:28px;
            padding:0;
            border:0;
            background:transparent;
            cursor:pointer;
          }


          .color-reset {
            border:
              1px solid
              var(--divider-color);
            border-radius:6px;
            background:
              var(--secondary-background-color);
            color:
              var(--primary-text-color);
            padding:5px;
            cursor:pointer;
            font-size:10px;
          }


          .footer {
            margin-top:14px;
            font-size:10px;
            opacity:.4;
          }

        </style>


        <div class="wrap">


          <div class="header">

            <div>

              <div class="title">
                HA IoT Floorplan
              </div>

              <div class="subtitle">
                Multi-floor • Hybrid grouping • Map pins
              </div>

            </div>


            <div class="controls">

              <button
                id="upload-background"
                class="button"
              >
                Upload floorplan
              </button>


              ${
                this._backgroundUrls[
                  data.floor.id
                ]
                  ? `
                    <button
                      id="remove-background"
                      class="button"
                    >
                      Remove image
                    </button>
                  `
                  : ""
              }


              <input
                id="background-file"
                type="file"
                accept="image/*"
                style="display:none"
              >


              <button
                id="edit-layout"
                class="
                  button
                  ${
                    this._editMode
                      ? "active"
                      : ""
                  }
                "
              >

                ${
                  this._editMode
                    ? "Finish editing"
                    : "Edit layout"
                }

              </button>

            </div>

          </div>


          <div class="floor-tabs">

            ${
              this._state.floors
                .map(
                  floor => `

                    <button
                      class="
                        floor-tab
                        ${
                          floor.id ===
                          data.floor.id
                            ? "active"
                            : ""
                        }
                      "
                      data-floor-id="${
                        this._escapeHtml(
                          floor.id
                        )
                      }"
                    >

                      ${
                        this._escapeHtml(
                          floor.name
                        )
                      }

                    </button>

                  `
                )
                .join("")
            }


            <button
              id="add-floor"
              class="add-floor"
              title="Add floor"
            >
              +
            </button>


            <div class="floor-tools">

              <button
                id="assign-areas"
                class="button"
              >

                Assign areas

                ${
                  unassignedCount
                    ? ` (${unassignedCount})`
                    : ""
                }

              </button>


              ${
                this._editMode
                  ? `

                    <button
                      id="colors-button"
                      class="button"
                    >
                      Colors
                    </button>


                    <button
                      id="rename-floor"
                      class="button"
                    >
                      Rename
                    </button>


                    <button
                      id="reset-layout"
                      class="button"
                    >
                      Reset layout
                    </button>


                    ${
                      this._state.floors.length >
                      1
                        ? `
                          <button
                            id="delete-floor"
                            class="
                              button
                              danger
                            "
                          >
                            Delete floor
                          </button>
                        `
                        : ""
                    }

                  `
                  : ""
              }

            </div>

          </div>


          ${
            this._editMode
              ? `

                <div class="edit-note">

                  Editing
                  <b>
                    ${
                      this._escapeHtml(
                        data.floor.name
                      )
                    }
                  </b>.

                  Drag Areas and pins.
                  Use the pin button on a single device,
                  or open a category group and choose
                  Place on map.

                </div>


                <div class="size-control">

                  <div class="size-label">
                    Floorplan size
                  </div>


                  <span
                    style="
                      font-size:10px;
                      opacity:.45;
                    "
                  >
                    40
                  </span>


                  <input
                    id="size-slider"
                    class="size-slider"
                    type="range"
                    min="40"
                    max="150"
                    step="5"
                    value="${sizePercent}"
                  >


                  <span
                    style="
                      font-size:10px;
                      opacity:.45;
                    "
                  >
                    150
                  </span>


                  <div
                    id="size-value"
                    class="size-value"
                  >
                    ${sizePercent}%
                  </div>


                  <div
                    id="size-status"
                    class="size-status"
                  ></div>

                </div>

              `
              : ""
          }


          <div
            id="floorplan"
            class="
              floorplan
              ${
                this._editMode
                  ? "edit-mode"
                  : ""
              }
            "
          >


            <div
              id="plan-stage"
              class="
                plan-stage
                ${
                  background
                    ? ""
                    : "blank-stage"
                }
              "
            >


              ${
                background
                  ? `
                    <img
                      class="floorplan-image"
                      src="${
                        this._escapeHtml(
                          background
                        )
                      }"
                      draggable="false"
                    >
                  `
                  : ""
              }


              <div class="area-layer">

                ${
                  data.areas
                    .map(
                      area =>
                        this._renderArea(
                          area
                        )
                    )
                    .join("")
                }

              </div>


              <div class="pin-layer">

                ${
                  this._renderPins()
                }

              </div>

            </div>

          </div>


          <div class="floating">

            <div class="floating-title">
              Floating / Mobile
            </div>


            <div class="floating-strip">

              ${
                data.floating
                  .map(
                    device =>
                      this._renderFloating(
                        device
                      )
                  )
                  .join("")
              }

            </div>

          </div>


          <div class="footer">

            HA IoT Floorplan v0.6
            •
            ${
              this._escapeHtml(
                data.floor.name
              )
            }
            •
            ${data.areas.length}
            Areas
            •
            ${
              Object.keys(
                data.floor.pins
              ).length
            }
            Pins
            •
            ${sizePercent}%

          </div>

        </div>


        ${
          this._renderGroupModal()
        }


        ${
          this._renderDeviceDetailModal()
        }


        ${
          this._renderAreaManagerModal()
        }


        ${
          this._renderColorManagerModal()
        }

      </ha-card>
    `;


    this._attachHandlers();


    requestAnimationFrame(
      () =>
        this._applyPlanSize()
    );
  }


  /*
   * =================================================
   * AREA DISPLAY
   * =================================================
   */


  _renderArea(
    area
  ) {

    const floor =
      this._activeFloor();


    const layout =
      floor.layout[
        area.areaId
      ];


    if (!layout) {
      return "";
    }


    const items =
      this._buildRoomItems(
        area
      );


    const pinnedCount =
      area.devices.filter(
        device =>
          this._isDevicePinned(
            device
          )
      ).length;


    const areaEnabled =
      this._state
        .colors
        .areaEnabled;


    const areaColor =
      this._areaColor(
        area.areaId
      );


    return `
      <div
        class="
          area
          ${
            areaEnabled
              ? "area-colored"
              : ""
          }
        "
        data-area-id="${
          this._escapeHtml(
            area.areaId
          )
        }"
        style="
          left:${layout.x}%;
          top:${layout.y}%;
          width:${layout.w}%;
          height:${layout.h}%;
          ${
            areaEnabled
              ? `--area-accent:${areaColor};`
              : ""
          }
        "
      >


        <div
          class="area-header"
          data-drag-area="${
            this._escapeHtml(
              area.areaId
            )
          }"
        >

          <span>

            ${
              this._escapeHtml(
                area.areaName
              )
            }

          </span>


          <span class="area-count">

            ${area.devices.length}

            ${
              pinnedCount
                ? ` • ${pinnedCount} pinned`
                : ""
            }

          </span>

        </div>


        ${
          items.length

            ? `
              <div class="devices">

                ${
                  items
                    .map(
                      item =>
                        item.type ===
                        "group"

                          ? this._renderGroupTile(
                              area,
                              item
                            )

                          : this._renderDeviceTile(
                              area,
                              item.device,
                              item.category
                            )
                    )
                    .join("")
                }

              </div>
            `

            : `
              <div class="empty-room">

                ${
                  pinnedCount
                    ? "Devices placed on map"
                    : "No fixed IoT devices"
                }

              </div>
            `
        }


        <div
          class="resize-handle"
          data-resize-area="${
            this._escapeHtml(
              area.areaId
            )
          }"
        ></div>

      </div>
    `;
  }


  _renderGroupTile(
    area,
    item
  ) {

    const icon =
      this._core
        .categoryIcon(
          item.category
        );


    const title =
      this._core
        .categoryTitle(
          item.category
        );


    const categoryEnabled =
      this._state
        .colors
        .categoryEnabled;


    const categoryColor =
      this._categoryColor(
        item.category
      );


    return `
      <div
        class="
          room-item
          group-item
        "
        data-group-area="${
          this._escapeHtml(
            area.areaId
          )
        }"
        data-group-category="${
          this._escapeHtml(
            item.category
          )
        }"
      >

        <div class="group-count">
          ${item.devices.length}
        </div>


        <ha-icon
          icon="${
            this._escapeHtml(
              icon
            )
          }"
          ${
            categoryEnabled
              ? `style="color:${categoryColor}"`
              : ""
          }
        ></ha-icon>


        <div class="item-name">

          ${
            this._escapeHtml(
              title
            )
          }

        </div>


        <div class="item-category">

          ${
            item.devices
              .filter(
                device =>
                  device.online
              )
              .length
          }

          online

        </div>

      </div>
    `;
  }


  _renderDeviceTile(
    area,
    device,
    category
  ) {

    const icon =
      this._core
        .categoryIcon(
          category
        );


    const categoryEnabled =
      this._state
        .colors
        .categoryEnabled;


    const categoryColor =
      this._categoryColor(
        category
      );


    const key =
      this._deviceKey(
        device
      );


    return `
      <div
        class="room-item device-detail-trigger"
        data-device-detail="${
          this._escapeHtml(
            key
          )
        }"
        title="${
          this._escapeHtml(
            device.name
          )
        }"
      >

        ${
          this._editMode
            ? `
              <button
                class="single-pin-button"
                data-pin-single="${
                  this._escapeHtml(
                    key
                  )
                }"
                data-pin-area="${
                  this._escapeHtml(
                    area.areaId
                  )
                }"
                title="Place on map"
              >
                <ha-icon
                  icon="mdi:map-marker-plus"
                ></ha-icon>
              </button>
            `
            : ""
        }


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


        <ha-icon
          icon="${
            this._escapeHtml(
              icon
            )
          }"
          ${
            categoryEnabled
              ? `style="color:${categoryColor}"`
              : ""
          }
        ></ha-icon>


        <div class="item-name">

          ${
            this._escapeHtml(
              device.name
            )
          }

        </div>


        <div class="item-category">

          ${
            this._escapeHtml(
              this._core
                .categoryTitle(
                  category
                )
            )
          }

        </div>

      </div>
    `;
  }


  /*
   * =================================================
   * AREA MANAGER
   * =================================================
   */


  _renderAreaManagerModal() {

    if (
      !this._areaManagerOpen
    ) {
      return "";
    }


    const areas =
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
      <div class="modal-backdrop">

        <div class="modal">

          <div class="modal-header">

            <div class="modal-title">

              <ha-icon
                icon="mdi:layers-triple"
              ></ha-icon>

              Assign Areas to floors

            </div>


            <button
              class="modal-close"
              id="close-area-manager"
            >
              ×
            </button>

          </div>


          ${
            areas
              .map(
                area => {

                  const floor =
                    this._floorForArea(
                      area.area_id
                    );


                  return `

                    <div class="area-assignment">

                      <div class="area-name">

                        ${
                          this._escapeHtml(
                            area.name
                          )
                        }

                      </div>


                      <select
                        class="floor-select"
                        data-area-floor="${
                          this._escapeHtml(
                            area.area_id
                          )
                        }"
                      >

                        <option
                          value=""
                          ${
                            !floor
                              ? "selected"
                              : ""
                          }
                        >
                          Unassigned
                        </option>


                        ${
                          this._state.floors
                            .map(
                              item => `

                                <option
                                  value="${
                                    this._escapeHtml(
                                      item.id
                                    )
                                  }"
                                  ${
                                    floor?.id ===
                                    item.id
                                      ? "selected"
                                      : ""
                                  }
                                >

                                  ${
                                    this._escapeHtml(
                                      item.name
                                    )
                                  }

                                </option>

                              `
                            )
                            .join("")
                        }

                      </select>

                    </div>

                  `;
                }
              )
              .join("")
          }

        </div>

      </div>
    `;
  }


  /*
   * =================================================
   * DEVICE DETAILS
   * =================================================
   */


  _openDeviceDetail(
    key
  ) {

    const device =
      this._findDeviceByKey(
        key
      );


    if (!device) {
      return;
    }


    this._activeDeviceKey =
      key;


    this._render();
  }


  _closeDeviceDetail() {

    this._activeDeviceKey =
      null;


    this._render();
  }


  _formatDetailTimestamp(
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
          year:"numeric",
          month:"2-digit",
          day:"2-digit",
          hour:"2-digit",
          minute:"2-digit"
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


  _formatDetailAge(
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
        delta / 60000
      );


    if (minutes < 60) {
      return `${minutes} min ago`;
    }


    const hours =
      Math.floor(
        minutes / 60
      );


    if (hours < 24) {
      return `${hours} h ago`;
    }


    const days =
      Math.floor(
        hours / 24
      );


    if (days < 60) {
      return `${days} d ago`;
    }


    const months =
      Math.floor(
        days / 30.44
      );


    if (months < 24) {
      return `${months} mo ago`;
    }


    const years =
      Math.floor(
        days / 365.25
      );


    return `${years} y ago`;
  }


  _detailRow(
    label,
    value
  ) {

    const display =
      value === null ||
      value === undefined ||
      value === ""
        ? "—"
        : value;


    return `
      <div class="detail-label">
        ${this._escapeHtml(label)}
      </div>

      <div class="detail-value">
        ${this._escapeHtml(String(display))}
      </div>
    `;
  }


  _renderDeviceDetailModal() {

    if (
      !this._activeDeviceKey
    ) {
      return "";
    }


    const device =
      this._findDeviceByKey(
        this._activeDeviceKey
      );


    if (!device) {
      return "";
    }


    const category =
      this._core
        .getResolvedCategory(
          device
        );


    const icon =
      this._core
        .categoryIcon(
          category
        );


    const categoryTitle =
      this._core
        .categoryTitle(
          category
        );


    const storedClass =
      this._core
        .getStoredClassification(
          device
        );


    const effectiveClass =
      this._core
        .getEffectiveClassification(
          device
        );


    const classText =
      storedClass === "auto"
        ? `Auto (${effectiveClass})`
        : storedClass;


    const storedCategory =
      this._core
        .getStoredCategory(
          device
        );


    const categoryText =
      storedCategory === "auto"
        ? `Auto (${categoryTitle})`
        : categoryTitle;


    const lastSeenText =
      this._formatDetailTimestamp(
        device.lastSeenTs
      );


    const lastSeenAge =
      this._formatDetailAge(
        device.lastSeenTs
      );


    const offlineText =
      this._formatDetailTimestamp(
        device.offlineSinceTs
      );


    const offlineAge =
      this._formatDetailAge(
        device.offlineSinceTs
      );


    const sourceText =
      device.lastSeenSource
        ?.startsWith(
          "reported:"
        )
          ? "Device reported"
          : (
              device.lastSeenSource
                ? "HA state activity"
                : "Unavailable"
            );


    const entityIds =
      Array.isArray(
        device.entityIds
      )
        ? device.entityIds
        : [];


    const mergedItems =
      Array.isArray(
        device.mergedItems
      )
        ? device.mergedItems
        : [];


    const categoryEnabled =
      this._state
        .colors
        .categoryEnabled;


    const categoryColor =
      this._categoryColor(
        category
      );


    return `
      <div
        class="modal-backdrop device-detail-backdrop"
        id="device-detail-backdrop"
      >

        <div class="modal device-detail-modal">

          <div class="modal-header">

            <div class="modal-title">
              <ha-icon icon="mdi:information-outline"></ha-icon>
              Device details
            </div>

            <button
              id="close-device-detail"
              class="modal-close"
              title="Close"
            >
              ×
            </button>

          </div>


          <div class="detail-hero">

            <div class="detail-icon">
              <ha-icon
                icon="${this._escapeHtml(icon)}"
                ${
                  categoryEnabled
                    ? `style="color:${categoryColor}"`
                    : ""
                }
              ></ha-icon>
            </div>

            <div>
              <div class="detail-name">
                ${this._escapeHtml(device.name)}
              </div>

              <div class="detail-subtitle">
                ${this._escapeHtml(categoryTitle)}
                ${
                  device.areaName
                    ? ` • ${this._escapeHtml(device.areaName)}`
                    : ""
                }
              </div>
            </div>

            <div class="detail-status">
              <span
                class="detail-status-dot ${
                  device.online
                    ? "online"
                    : "offline"
                }"
              ></span>
              ${device.online ? "Online" : "Offline"}
            </div>

          </div>


          <div class="detail-body">

            <div class="detail-section">
              <div class="detail-section-title">Device</div>
              <div class="detail-grid">
                ${this._detailRow("Friendly name", device.name)}
                ${this._detailRow("Original name", device.originalName)}
                ${this._detailRow("Area", device.areaName || "Unassigned")}
                ${this._detailRow("Category", categoryText)}
                ${this._detailRow("Classification", classText)}
                ${this._detailRow("Manufacturer", device.manufacturer)}
                ${this._detailRow("Model", device.model)}
                ${this._detailRow("Software version", device.swVersion)}
              </div>
            </div>


            <div class="detail-section">
              <div class="detail-section-title">Network</div>
              <div class="detail-grid">
                ${this._detailRow("IP address", device.ip)}
                ${this._detailRow("MAC address", device.mac)}
                ${this._detailRow("Hostname", device.hostname)}
                ${this._detailRow("Platforms", (device.platforms || []).join(", "))}
              </div>
            </div>


            <div class="detail-section">
              <div class="detail-section-title">Activity</div>
              <div class="detail-grid">
                ${this._detailRow("Status", device.online ? "Online" : "Offline")}
                ${this._detailRow(
                  "Last seen",
                  Number.isFinite(device.lastSeenTs)
                    ? `${lastSeenText}${lastSeenAge ? ` (${lastSeenAge})` : ""}`
                    : "Unavailable"
                )}
                ${this._detailRow(
                  "Offline since",
                  Number.isFinite(device.offlineSinceTs)
                    ? `${offlineText}${offlineAge ? ` (${offlineAge})` : ""}`
                    : "Unavailable"
                )}
                ${this._detailRow("Timestamp source", sourceText)}
              </div>
            </div>


            <div class="detail-section">
              <div class="detail-section-title">Home Assistant</div>
              <div class="detail-grid">
                ${this._detailRow("Source type", device.sourceType)}
                ${this._detailRow("Device registry ID", device.registryDeviceId)}
                ${this._detailRow("Entity registry ID", device.registryEntityId)}
                ${this._detailRow("Entity count", device.entityCount)}
                ${this._detailRow("Tracker count", device.trackerCount)}
              </div>
            </div>


            ${
              entityIds.length
                ? `
                  <div class="detail-section">
                    <div class="detail-section-title">Entities</div>
                    <details
                      class="detail-entities"
                      ${entityIds.length <= 4 ? "open" : ""}
                    >
                      <summary>
                        ${entityIds.length}
                        entit${entityIds.length === 1 ? "y" : "ies"}
                      </summary>
                      <div class="entity-list">
                        ${
                          entityIds
                            .map(
                              entityId => `
                                <div class="entity-id">
                                  ${this._escapeHtml(entityId)}
                                </div>
                              `
                            )
                            .join("")
                        }
                      </div>
                    </details>
                  </div>
                `
                : ""
            }


            ${
              mergedItems.length > 1
                ? `
                  <div class="detail-section">
                    <div class="detail-section-title">Merged sources</div>
                    <div class="detail-entities">
                      ${
                        mergedItems
                          .map(
                            source => `
                              <div class="merged-source">
                                <div class="merged-source-name">
                                  ${this._escapeHtml(source.name || source.id || "Source")}
                                </div>
                                <div class="merged-source-detail">
                                  ${this._escapeHtml(
                                    [
                                      source.sourceType,
                                      (source.platforms || []).join(", "),
                                      source.registryDeviceId
                                        ? `device:${source.registryDeviceId}`
                                        : null,
                                      source.registryEntityId
                                        ? `entity:${source.registryEntityId}`
                                        : null
                                    ]
                                      .filter(Boolean)
                                      .join(" • ")
                                  )}
                                </div>
                              </div>
                            `
                          )
                          .join("")
                      }
                    </div>
                  </div>
                `
                : ""
            }

          </div>

        </div>

      </div>
    `;
  }


  /*
   * =================================================
   * GROUP MODAL
   * =================================================
   */


  _openGroup(
    areaId,
    category
  ) {

    this._activeGroup = {
      areaId,
      category
    };


    this._render();
  }


  _closeGroup() {

    this._activeGroup =
      null;


    this._render();
  }


  _renderGroupModal() {

    if (
      !this._activeGroup ||
      !this._currentData
    ) {
      return "";
    }


    const area =
      this._currentData
        .areas
        .find(
          item =>
            item.areaId ===
            this._activeGroup
              .areaId
        );


    if (!area) {
      return "";
    }


    const category =
      this._activeGroup
        .category;


    const devices =
      area.devices.filter(
        device =>
          this._core
            .getResolvedCategory(
              device
            ) ===
          category
          &&
          !this._isDevicePinned(
            device
          )
      );


    const icon =
      this._core
        .categoryIcon(
          category
        );


    const categoryEnabled =
      this._state
        .colors
        .categoryEnabled;


    const categoryColor =
      this._categoryColor(
        category
      );


    return `
      <div class="modal-backdrop">

        <div class="modal">

          <div class="modal-header">

            <div class="modal-title">

              <ha-icon
                icon="${
                  this._escapeHtml(
                    icon
                  )
                }"
                ${
                  categoryEnabled
                    ? `style="color:${categoryColor}"`
                    : ""
                }
              ></ha-icon>


              ${
                this._escapeHtml(
                  area.areaName
                )
              }

              •

              ${
                this._escapeHtml(
                  this._core
                    .categoryTitle(
                      category
                    )
                )
              }

              (${devices.length})

            </div>


            <button
              id="close-group-modal"
              class="modal-close"
            >
              ×
            </button>

          </div>


          ${
            devices
              .map(
                device => {

                  const key =
                    this._deviceKey(
                      device
                    );


                  return `

                    <div
                      class="modal-device device-detail-trigger"
                      data-device-detail="${
                        this._escapeHtml(
                          key
                        )
                      }"
                    >

                      <ha-icon
                        icon="${
                          this._escapeHtml(
                            icon
                          )
                        }"
                        ${
                          categoryEnabled
                            ? `style="color:${categoryColor}"`
                            : ""
                        }
                      ></ha-icon>


                      <div>

                        <div class="modal-device-name">

                          ${
                            this._escapeHtml(
                              device.name
                            )
                          }

                        </div>


                        <div class="modal-device-details">

                          ${
                            device.ip
                              ? this._escapeHtml(
                                  device.ip
                                )
                              : ""
                          }

                          ${
                            device.ip &&
                            device.mac
                              ? " • "
                              : ""
                          }

                          ${
                            device.mac
                              ? this._escapeHtml(
                                  device.mac
                                )
                              : ""
                          }

                        </div>

                      </div>


                      ${
                        this._editMode

                          ? `
                            <button
                              class="pin-action"
                              data-pin-group="${
                                this._escapeHtml(
                                  key
                                )
                              }"
                              data-pin-area="${
                                this._escapeHtml(
                                  area.areaId
                                )
                              }"
                            >
                              Place on map
                            </button>
                          `

                          : `
                            <div
                              class="
                                modal-status
                                ${
                                  device.online
                                    ? "online"
                                    : "offline"
                                }
                              "
                            ></div>
                          `
                      }

                    </div>

                  `;
                }
              )
              .join("")
          }

        </div>

      </div>
    `;
  }


  /*
   * =================================================
   * FLOATING
   * =================================================
   */


  _renderFloating(
    device
  ) {

    const category =
      this._core
        .getResolvedCategory(
          device
        );


    const categoryEnabled =
      this._state
        .colors
        .categoryEnabled;


    const key =
      this._deviceKey(
        device
      );


    return `
      <div
        class="floating-device device-detail-trigger"
        data-device-detail="${
          this._escapeHtml(
            key
          )
        }"
      >

        <ha-icon
          icon="${
            this._escapeHtml(
              this._core
                .categoryIcon(
                  category
                )
            )
          }"
          ${
            categoryEnabled
              ? `style="color:${this._categoryColor(
                  category
                )}"`
              : ""
          }
        ></ha-icon>


        ${
          this._escapeHtml(
            device.name
          )
        }


        <span
          class="
            floating-dot
            ${
              device.online
                ? "online"
                : "offline"
            }
          "
        ></span>

      </div>
    `;
  }


  /*
   * =================================================
   * EVENTS
   * =================================================
   */


  _attachHandlers() {

    /*
     * FLOORS
     */

    for (
      const tab
      of this.querySelectorAll(
        "[data-floor-id]"
      )
    ) {

      tab.addEventListener(
        "click",
        () =>
          this._switchFloor(
            tab.dataset.floorId
          )
      );
    }


    this.querySelector(
      "#add-floor"
    )?.addEventListener(
      "click",
      () =>
        this._addFloor()
    );


    this.querySelector(
      "#rename-floor"
    )?.addEventListener(
      "click",
      () =>
        this._renameFloor()
    );


    this.querySelector(
      "#delete-floor"
    )?.addEventListener(
      "click",
      () =>
        this._deleteFloor()
    );


    /*
     * SIZE
     */

    const sizeSlider =
      this.querySelector(
        "#size-slider"
      );


    sizeSlider
      ?.addEventListener(
        "input",
        event =>
          this._setFloorSize(
            event.target.value,
            false
          )
      );


    sizeSlider
      ?.addEventListener(
        "change",
        event =>
          this._setFloorSize(
            event.target.value,
            true
          )
      );


    /*
     * AREA FLOOR ASSIGNMENT
     */

    this.querySelector(
      "#assign-areas"
    )?.addEventListener(
      "click",
      () => {

        this._areaManagerOpen =
          true;

        this._render();
      }
    );


    this.querySelector(
      "#close-area-manager"
    )?.addEventListener(
      "click",
      () => {

        this._areaManagerOpen =
          false;

        this._render();
      }
    );


    for (
      const select
      of this.querySelectorAll(
        "[data-area-floor]"
      )
    ) {

      select.addEventListener(
        "change",
        event =>
          this._assignAreaToFloor(
            event.target.dataset
              .areaFloor,
            event.target.value
          )
      );
    }


    /*
     * COLOR MANAGER
     */

    this.querySelector(
      "#colors-button"
    )?.addEventListener(
      "click",
      () => {

        this._colorManagerOpen =
          true;

        this._render();
      }
    );


    this.querySelector(
      "#close-colors"
    )?.addEventListener(
      "click",
      () => {

        this._colorManagerOpen =
          false;

        this._render();
      }
    );


    this.querySelector(
      "#area-color-enabled"
    )?.addEventListener(
      "change",
      event => {

        this._state
          .colors
          .areaEnabled =
          event.target.checked;

        this._saveState();

        this._render();
      }
    );


    this.querySelector(
      "#category-color-enabled"
    )?.addEventListener(
      "change",
      event => {

        this._state
          .colors
          .categoryEnabled =
          event.target.checked;

        this._saveState();

        this._render();
      }
    );


    for (
      const input
      of this.querySelectorAll(
        "[data-area-color]"
      )
    ) {

      input.addEventListener(
        "change",
        event =>
          this._setAreaColor(
            event.target.dataset
              .areaColor,
            event.target.value
          )
      );
    }


    for (
      const button
      of this.querySelectorAll(
        "[data-reset-area]"
      )
    ) {

      button.addEventListener(
        "click",
        () =>
          this._resetAreaColor(
            button.dataset
              .resetArea
          )
      );
    }


    for (
      const input
      of this.querySelectorAll(
        "[data-category-color]"
      )
    ) {

      input.addEventListener(
        "change",
        event =>
          this._setCategoryColor(
            event.target.dataset
              .categoryColor,
            event.target.value
          )
      );
    }


    for (
      const button
      of this.querySelectorAll(
        "[data-reset-category]"
      )
    ) {

      button.addEventListener(
        "click",
        () =>
          this._resetCategoryColor(
            button.dataset
              .resetCategory
          )
      );
    }


    /*
     * BACKGROUND
     */

    const fileInput =
      this.querySelector(
        "#background-file"
      );


    this.querySelector(
      "#upload-background"
    )?.addEventListener(
      "click",
      () =>
        fileInput?.click()
    );


    fileInput
      ?.addEventListener(
        "change",
        async event => {

          const file =
            event.target
              .files?.[0];


          if (!file) {
            return;
          }


          await this
            ._saveUploadedBackground(
              file
            );
        }
      );


    const image =
      this.querySelector(
        ".floorplan-image"
      );


    if (image) {

      if (image.complete) {

        requestAnimationFrame(
          () =>
            this._applyPlanSize()
        );

      } else {

        image.addEventListener(
          "load",
          () =>
            this._applyPlanSize(),
          {
            once:true
          }
        );
      }
    }


    this.querySelector(
      "#remove-background"
    )?.addEventListener(
      "click",
      () =>
        this._removeUploadedBackground()
    );


    /*
     * EDIT MODE
     */

    this.querySelector(
      "#edit-layout"
    )?.addEventListener(
      "click",
      () =>
        this._toggleEditMode()
    );


    this.querySelector(
      "#reset-layout"
    )?.addEventListener(
      "click",
      () =>
        this._resetLayout()
    );


    /*
     * GROUP OPENING
     */

    for (
      const tile
      of this.querySelectorAll(
        "[data-group-area]"
      )
    ) {

      tile.addEventListener(
        "click",
        () =>
          this._openGroup(
            tile.dataset
              .groupArea,
            tile.dataset
              .groupCategory
          )
      );
    }


    this.querySelector(
      "#close-group-modal"
    )?.addEventListener(
      "click",
      () =>
        this._closeGroup()
    );


    /*
     * DEVICE DETAILS
     */

    for (
      const trigger
      of this.querySelectorAll(
        "[data-device-detail]"
      )
    ) {

      trigger.addEventListener(
        "click",
        event => {

          if (
            event.target.closest(
              "[data-pin-single], [data-pin-group], [data-unpin-key]"
            )
          ) {
            return;
          }


          if (
            this._editMode &&
            trigger.classList.contains(
              "device-pin"
            )
          ) {
            return;
          }


          event.stopPropagation();


          this._openDeviceDetail(
            trigger.dataset
              .deviceDetail
          );
        }
      );
    }


    this.querySelector(
      "#close-device-detail"
    )?.addEventListener(
      "click",
      event => {

        event.stopPropagation();

        this._closeDeviceDetail();
      }
    );


    this.querySelector(
      "#device-detail-backdrop"
    )?.addEventListener(
      "click",
      event => {

        if (
          event.target ===
          event.currentTarget
        ) {
          this._closeDeviceDetail();
        }
      }
    );


    /*
     * SINGLE DEVICE → PIN
     */

    for (
      const button
      of this.querySelectorAll(
        "[data-pin-single]"
      )
    ) {

      button.addEventListener(
        "click",
        event => {

          event.stopPropagation();


          const device =
            this._findDeviceByKey(
              button.dataset
                .pinSingle
            );


          if (device) {

            this._pinDevice(
              device,
              button.dataset
                .pinArea
            );
          }
        }
      );
    }


    /*
     * GROUP DEVICE → PIN
     */

    for (
      const button
      of this.querySelectorAll(
        "[data-pin-group]"
      )
    ) {

      button.addEventListener(
        "click",
        event => {

          event.stopPropagation();


          const device =
            this._findDeviceByKey(
              button.dataset
                .pinGroup
            );


          if (device) {

            this._pinDevice(
              device,
              button.dataset
                .pinArea
            );
          }
        }
      );
    }


    /*
     * REMOVE PIN
     */

    for (
      const button
      of this.querySelectorAll(
        "[data-unpin-key]"
      )
    ) {

      button.addEventListener(
        "pointerdown",
        event =>
          event.stopPropagation()
      );


      button.addEventListener(
        "click",
        event => {

          event.stopPropagation();

          this._unpinDevice(
            button.dataset
              .unpinKey
          );
        }
      );
    }


    /*
     * PIN DRAG
     */

    if (
      this._editMode
    ) {

      for (
        const pin
        of this.querySelectorAll(
          "[data-pin-key]"
        )
      ) {

        pin.addEventListener(
          "pointerdown",
          event => {

            if (
              event.target
                .closest(
                  "[data-unpin-key]"
                )
            ) {
              return;
            }


            this._startPinDrag(
              event,
              pin.dataset
                .pinKey
            );
          }
        );
      }
    }


    /*
     * AREA DRAG / RESIZE
     */

    if (
      !this._editMode
    ) {
      return;
    }


    for (
      const header
      of this.querySelectorAll(
        "[data-drag-area]"
      )
    ) {

      header.addEventListener(
        "pointerdown",
        event =>
          this._startDrag(
            event,
            header.dataset
              .dragArea
          )
      );
    }


    for (
      const handle
      of this.querySelectorAll(
        "[data-resize-area]"
      )
    ) {

      handle.addEventListener(
        "pointerdown",
        event =>
          this._startResize(
            event,
            handle.dataset
              .resizeArea
          )
      );
    }
  }


  /*
   * =================================================
   * AREA DRAGGING
   * =================================================
   */


  _getCanvas() {

    return this.querySelector(
      "#plan-stage"
    );
  }


  _startDrag(
    event,
    areaId
  ) {

    const canvas =
      this._getCanvas();


    const floor =
      this._activeFloor();


    const layout =
      floor.layout[
        areaId
      ];


    if (
      !canvas ||
      !layout
    ) {
      return;
    }


    event.preventDefault();


    const rect =
      canvas
        .getBoundingClientRect();


    this._dragState = {

      areaId,

      startX:
        event.clientX,

      startY:
        event.clientY,

      canvasW:
        rect.width,

      canvasH:
        rect.height,

      original: {
        ...layout
      }
    };


    const move =
      e =>
        this._dragMove(
          e
        );


    const end =
      () => {

        window.removeEventListener(
          "pointermove",
          move
        );

        window.removeEventListener(
          "pointerup",
          end
        );

        this._dragState =
          null;

        this._saveState();
      };


    window.addEventListener(
      "pointermove",
      move
    );

    window.addEventListener(
      "pointerup",
      end
    );
  }


  _dragMove(
    event
  ) {

    if (
      !this._dragState
    ) {
      return;
    }


    const state =
      this._dragState;


    const floor =
      this._activeFloor();


    const layout =
      floor.layout[
        state.areaId
      ];


    const dx =
      (
        event.clientX -
        state.startX
      ) /
      state.canvasW *
      100;


    const dy =
      (
        event.clientY -
        state.startY
      ) /
      state.canvasH *
      100;


    layout.x =
      this._clamp(
        state.original.x +
        dx,
        0,
        100 -
        layout.w
      );


    layout.y =
      this._clamp(
        state.original.y +
        dy,
        0,
        100 -
        layout.h
      );


    this._applyAreaStyle(
      state.areaId
    );
  }


  /*
   * =================================================
   * AREA RESIZE
   * =================================================
   */


  _startResize(
    event,
    areaId
  ) {

    const canvas =
      this._getCanvas();


    const floor =
      this._activeFloor();


    const layout =
      floor.layout[
        areaId
      ];


    if (
      !canvas ||
      !layout
    ) {
      return;
    }


    event.preventDefault();

    event.stopPropagation();


    const rect =
      canvas
        .getBoundingClientRect();


    this._resizeState = {

      areaId,

      startX:
        event.clientX,

      startY:
        event.clientY,

      canvasW:
        rect.width,

      canvasH:
        rect.height,

      original: {
        ...layout
      }
    };


    const move =
      e =>
        this._resizeMove(
          e
        );


    const end =
      () => {

        window.removeEventListener(
          "pointermove",
          move
        );

        window.removeEventListener(
          "pointerup",
          end
        );

        this._resizeState =
          null;

        this._saveState();
      };


    window.addEventListener(
      "pointermove",
      move
    );

    window.addEventListener(
      "pointerup",
      end
    );
  }


  _resizeMove(
    event
  ) {

    if (
      !this._resizeState
    ) {
      return;
    }


    const state =
      this._resizeState;


    const floor =
      this._activeFloor();


    const layout =
      floor.layout[
        state.areaId
      ];


    const dx =
      (
        event.clientX -
        state.startX
      ) /
      state.canvasW *
      100;


    const dy =
      (
        event.clientY -
        state.startY
      ) /
      state.canvasH *
      100;


    layout.w =
      this._clamp(
        state.original.w +
        dx,
        7,
        100 -
        layout.x
      );


    layout.h =
      this._clamp(
        state.original.h +
        dy,
        8,
        100 -
        layout.y
      );


    this._applyAreaStyle(
      state.areaId
    );
  }


  _applyAreaStyle(
    areaId
  ) {

    const element =
      this.querySelector(
        `.area[data-area-id="${CSS.escape(
          areaId
        )}"]`
      );


    const floor =
      this._activeFloor();


    const layout =
      floor.layout[
        areaId
      ];


    if (
      !element ||
      !layout
    ) {
      return;
    }


    element.style.left =
      `${layout.x}%`;

    element.style.top =
      `${layout.y}%`;

    element.style.width =
      `${layout.w}%`;

    element.style.height =
      `${layout.h}%`;
  }


  _clamp(
    value,
    min,
    max
  ) {

    return Math.min(
      max,
      Math.max(
        min,
        value
      )
    );
  }


  /*
   * =================================================
   * HELPERS
   * =================================================
   */


  _renderLoading() {

    this.innerHTML = `
      <ha-card header="HA IoT Floorplan">
        <div style="padding:16px">
          Loading IoT floorplan...
        </div>
      </ha-card>
    `;
  }


  _escapeHtml(
    value
  ) {

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
    return 10;
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
      "Multi-floor visual IoT floorplan with draggable device pins"

  });
}


console.info(
  "%c HA IoT Floorplan %c v0.6 ",
  "background:#00a8ff;color:white;font-weight:bold;",
  "background:#333;color:white;"
);
