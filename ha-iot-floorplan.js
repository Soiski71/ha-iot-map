import {
  HaIotMapCore
} from "./ha-iot-map-core.js?v=3";


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

    this._activeGroup = null;
    this._areaManagerOpen = false;

    this._lastRender = 0;

    /*
     * v0.4 state:
     *
     * floors
     * area -> floor assignments
     * separate room geometry per floor
     */
    this._stateKey =
      "ha_iot_floorplan_state_v04";

    this._legacyLayoutKey =
      "ha_iot_floorplan_layout_v02";

    this._state =
      this._loadState();

    /*
     * Images are stored in IndexedDB.
     * One image per floor.
     */
    this._backgroundUrls = {};
    this._backgroundBlobs = {};

    this._currentData = null;
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

    /*
     * Don't rebuild while user is editing
     * or has a popup open.
     */
    if (
      !this._loaded ||
      this._editMode ||
      this._activeGroup ||
      this._areaManagerOpen
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
   * FLOOR STATE
   * =================================================
   */


  _defaultState() {

    /*
     * Migrate old v0.2/v0.3 room geometry
     * to the new Ground floor.
     */

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

      version: 4,

      initialized: false,

      activeFloorId:
        "ground",

      floors: [

        {
          id:
            "ground",

          name:
            "Ground floor",

          areaIds:
            [],

          layout:
            legacyLayout || {}
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

          /*
           * Repair missing optional fields.
           */

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
          }

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


    /*
     * If selected floor disappeared,
     * select first remaining one.
     */

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


    /*
     * First v0.4 run:
     *
     * preserve current result by assigning
     * every existing HA Area to Ground floor.
     *
     * After this migration NEW Areas won't
     * be assigned automatically.
     */

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


      this._saveState();
    }
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
        {}

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

    /*
     * Remove Area from every floor first.
     */

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


    /*
     * Empty floorId = unassigned.
     */

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

    /*
     * Keep area manager open.
     */

    this._render();
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


    /*
     * v0.3 migration:
     *
     * old key "background"
     * becomes Ground floor image.
     */

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

      /*
       * Legacy YAML background only applies
       * to Ground floor.
       */

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


    /*
     * We intentionally include HA Areas
     * with ZERO devices as well.
     *
     * They still represent rooms.
     */

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


    for (
      const device
      of area.devices
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
              var(
                --divider-color
              );

            background:
              var(
                --secondary-background-color
              );

            color:
              var(
                --primary-text-color
              );

            padding:
              7px 11px;

            border-radius:
              8px;

            cursor:pointer;
          }


          .floor-tabs {
            margin-bottom:
              12px;
          }


          .floor-tab {
            border-radius:
              999px;

            font-size:
              12px;
          }


          .floor-tab.active {
            border-color:
              #00a8ff;

            color:
              #00a8ff;

            background:
              rgba(
                0,
                168,
                255,
                .13
              );
          }


          .add-floor {

            width:
              31px;

            height:
              31px;

            border-radius:
              50%;

            border:
              1px solid
              var(
                --divider-color
              );

            background:
              var(
                --secondary-background-color
              );

            color:
              var(
                --primary-text-color
              );

            cursor:pointer;

            font-size:
              18px;
          }


          .floor-tools {
            margin-left:auto;
          }


          .button.active {
            border-color:
              #00a8ff;

            color:
              #00a8ff;
          }


          .danger {
            border-color:
              var(
                --error-color,
                #f44336
              );
          }


          .edit-note {

            margin:
              8px 0 12px;

            padding:
              8px 10px;

            border-radius:
              7px;

            background:
              rgba(
                0,
                168,
                255,
                .10
              );

            font-size:
              11px;
          }


          /*
           * PLAN
           */

          .floorplan {

            position:
              relative;

            width:
              100%;

            overflow:
              hidden;

            border:
              1px solid
              var(
                --divider-color
              );

            border-radius:
              12px;

            background:
              #05090f;

            ${
              background
                ? ""
                : `
                  aspect-ratio:
                    ${
                      this._config
                        .aspect_ratio ||
                      "16 / 9"
                    };
                `
            }
          }


          .floorplan-image {

            display:block;

            width:100%;

            height:auto;

            pointer-events:none;

            user-select:none;
          }


          .area-layer {
            position:absolute;
            inset:0;
          }


          .area {

            position:absolute;

            box-sizing:
              border-box;

            overflow:hidden;

            border-radius:
              9px;

            border:
              1px solid
              rgba(
                255,
                255,
                255,
                .15
              );

            background:
              rgba(
                5,
                12,
                22,
                .48
              );
          }


          .edit-mode
          .area {

            border:
              2px dashed
              #00a8ff;

            background:
              rgba(
                0,
                168,
                255,
                .09
              );
          }


          .area-header {

            height:
              29px;

            box-sizing:
              border-box;

            display:flex;

            align-items:center;

            justify-content:
              space-between;

            padding:
              5px 8px;

            background:
              rgba(
                2,
                8,
                16,
                .78
              );

            font-size:
              11px;

            font-weight:
              600;
          }


          .edit-mode
          .area-header {

            cursor:move;

            touch-action:none;
          }


          .area-count {

            font-size:
              9px;

            opacity:
              .5;
          }


          .devices {

            display:grid;

            grid-template-columns:
              repeat(
                auto-fill,
                minmax(
                  70px,
                  1fr
                )
              );

            gap:5px;

            padding:6px;

            max-height:
              calc(
                100% -
                29px
              );

            overflow:auto;

            box-sizing:
              border-box;
          }


          .room-item {

            position:relative;

            min-height:
              61px;

            border-radius:
              7px;

            border:
              1px solid
              rgba(
                255,
                255,
                255,
                .08
              );

            background:
              rgba(
                6,
                13,
                22,
                .84
              );

            display:flex;

            flex-direction:
              column;

            align-items:center;

            justify-content:center;

            gap:3px;

            padding:5px;

            text-align:center;

            box-sizing:
              border-box;
          }


          .group-item {

            cursor:pointer;

            border-color:
              rgba(
                0,
                168,
                255,
                .35
              );
          }


          .group-item:hover {

            border-color:
              #00a8ff;

            background:
              rgba(
                0,
                100,
                180,
                .20
              );
          }


          .room-item
          ha-icon {

            --mdc-icon-size:
              20px;
          }


          .item-name {

            width:100%;

            font-size:
              9px;

            font-weight:
              600;

            overflow:hidden;

            text-overflow:
              ellipsis;

            white-space:
              nowrap;
          }


          .item-category {

            font-size:
              8px;

            opacity:
              .5;
          }


          .group-count {

            position:absolute;

            top:4px;
            right:4px;

            min-width:
              17px;

            height:
              17px;

            border-radius:
              999px;

            padding:
              0 4px;

            background:
              #00a8ff;

            color:white;

            font-size:
              9px;

            display:flex;

            align-items:center;

            justify-content:center;
          }


          .status {

            position:absolute;

            top:5px;
            right:5px;

            width:
              7px;

            height:
              7px;

            border-radius:
              50%;
          }


          .online {
            background:
              #4caf50;
          }


          .offline {
            background:
              #777;
          }


          .empty-room {

            padding:
              10px;

            font-size:
              10px;

            opacity:
              .4;
          }


          .resize-handle {

            display:none;

            position:absolute;

            right:0;
            bottom:0;

            width:
              18px;

            height:
              18px;

            cursor:
              nwse-resize;

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
              2px solid
              #00a8ff;

            border-bottom:
              2px solid
              #00a8ff;
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
              var(
                --divider-color
              );

            border-radius:
              999px;

            padding:
              6px 9px;

            font-size:
              10px;
          }


          .floating-device
          ha-icon {
            --mdc-icon-size:
              16px;
          }


          .floating-dot {

            width:
              7px;

            height:
              7px;

            border-radius:
              50%;
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
              rgba(
                0,
                0,
                0,
                .72
              );

            padding:20px;
          }


          .modal {

            width:
              min(
                600px,
                94vw
              );

            max-height:
              82vh;

            overflow:auto;

            border:
              1px solid
              rgba(
                0,
                168,
                255,
                .45
              );

            border-radius:
              14px;

            background:
              var(
                --card-background-color
              );
          }


          .modal-header {

            position:sticky;

            top:0;

            z-index:2;

            display:flex;

            justify-content:
              space-between;

            align-items:center;

            padding:
              13px 16px;

            border-bottom:
              1px solid
              var(
                --divider-color
              );

            background:
              var(
                --card-background-color
              );
          }


          .modal-title {

            display:flex;

            align-items:center;

            gap:8px;

            font-size:
              16px;

            font-weight:
              600;
          }


          .modal-close {

            border:0;

            background:
              transparent;

            color:
              var(
                --primary-text-color
              );

            font-size:
              24px;

            cursor:pointer;
          }


          .modal-device {

            display:grid;

            grid-template-columns:
              30px
              1fr
              auto;

            gap:
              10px;

            align-items:center;

            padding:
              10px 16px;

            border-bottom:
              1px solid
              var(
                --divider-color
              );
          }


          .modal-device-name {

            font-size:
              12px;

            font-weight:
              600;
          }


          .modal-device-details {

            font-size:
              10px;

            opacity:
              .5;
          }


          .modal-status {

            width:
              8px;

            height:
              8px;

            border-radius:
              50%;
          }


          /*
           * AREA ASSIGNMENT
           */

          .area-assignment {

            display:grid;

            grid-template-columns:
              1fr
              210px;

            gap:
              12px;

            align-items:center;

            padding:
              10px 16px;

            border-bottom:
              1px solid
              var(
                --divider-color
              );
          }


          .area-name {

            font-size:
              12px;

            font-weight:
              600;
          }


          .floor-select {

            width:100%;

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


          .footer {

            margin-top:
              14px;

            font-size:
              10px;

            opacity:
              .4;
          }

        </style>


        <div class="wrap">


          <div class="header">

            <div>

              <div class="title">
                HA IoT Floorplan
              </div>

              <div class="subtitle">
                Multi-floor • Hybrid grouping
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


          <!-- FLOOR TABS -->

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

                  Drag room headers,
                  resize from the bottom-right corner,
                  and use Assign areas to move rooms
                  between floors.

                </div>
              `
              : ""
          }


          <!-- FLOORPLAN -->

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

          </div>


          <!-- FLOATING -->

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

            HA IoT Floorplan v0.4
            •
            ${
              this._escapeHtml(
                data.floor.name
              )
            }
            •
            ${data.areas.length}
            Areas

          </div>

        </div>


        ${
          this._renderGroupModal()
        }


        ${
          this._renderAreaManagerModal()
        }

      </ha-card>
    `;


    this._attachHandlers();
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


    return `
      <div
        class="area"
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
                No fixed IoT devices
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
    device,
    category
  ) {

    const icon =
      this._core
        .categoryIcon(
          category
        );


    return `
      <div
        class="room-item"
        title="${
          this._escapeHtml(
            device.name
          )
        }"
      >

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
   * AREA FLOOR MANAGER
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
      <div
        class="modal-backdrop"
        id="area-manager-backdrop"
      >

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
   * CATEGORY GROUP POPUP
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
      );


    const icon =
      this._core
        .categoryIcon(
          category
        );


    return `
      <div
        class="modal-backdrop"
        id="group-modal-backdrop"
      >

        <div class="modal">

          <div class="modal-header">

            <div class="modal-title">

              <ha-icon
                icon="${
                  this._escapeHtml(
                    icon
                  )
                }"
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
                device => `

                  <div class="modal-device">

                    <ha-icon
                      icon="${
                        this._escapeHtml(
                          icon
                        )
                      }"
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


    return `
      <div class="floating-device">

        <ha-icon
          icon="${
            this._escapeHtml(
              this._core
                .categoryIcon(
                  category
                )
            )
          }"
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
     * FLOOR TABS
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
     * AREA ASSIGNMENT
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
     * BACKGROUND UPLOAD
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


    this.querySelector(
      "#remove-background"
    )?.addEventListener(
      "click",
      () =>
        this._removeUploadedBackground()
    );


    /*
     * EDITING
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
     * GROUPS
     */

    for (
      const tile
      of this.querySelectorAll(
        "[data-group-area]"
      )
    ) {

      tile.addEventListener(
        "click",
        () => {

          if (
            !this._editMode
          ) {

            this._openGroup(

              tile.dataset
                .groupArea,

              tile.dataset
                .groupCategory

            );
          }
        }
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
     * DRAG / RESIZE
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
   * DRAGGING
   * =================================================
   */


  _getCanvas() {

    return this.querySelector(
      "#floorplan"
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
   * RESIZING
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
      "Multi-floor visual IoT floorplan using Home Assistant Areas"

  });
}


console.info(
  "%c HA IoT Floorplan %c v0.4 ",
  "background:#00a8ff;color:white;font-weight:bold;",
  "background:#333;color:white;"
);
