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

    this._lastRender = 0;

    this._layoutStorageKey =
      "ha_iot_floorplan_layout_v02";

    this._layout =
      this._loadLayout();

    this._uploadedBackgroundUrl = null;
    this._uploadedBackgroundBlob = null;

    this._activeGroup = null;
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

    if (
      !this._loaded ||
      this._editMode ||
      this._activeGroup
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

      await this._core.reloadRegistries();

      await this._loadUploadedBackground();

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
   * -------------------------------------------------
   * BACKGROUND IMAGE STORAGE
   * -------------------------------------------------
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
              !db.objectStoreNames.contains(
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


  async _loadUploadedBackground() {

    try {

      const db =
        await this._openBackgroundDb();


      const blob =
        await new Promise(
          (
            resolve,
            reject
          ) => {

            const tx =
              db.transaction(
                "settings",
                "readonly"
              );

            const store =
              tx.objectStore(
                "settings"
              );

            const request =
              store.get(
                "background"
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


      db.close();


      if (blob) {

        this._uploadedBackgroundBlob =
          blob;

        if (
          this._uploadedBackgroundUrl
        ) {
          URL.revokeObjectURL(
            this._uploadedBackgroundUrl
          );
        }


        this._uploadedBackgroundUrl =
          URL.createObjectURL(
            blob
          );
      }

    } catch (err) {

      console.warn(
        "HA IoT Floorplan: background load failed",
        err
      );
    }
  }


  async _saveUploadedBackground(
    file
  ) {

    const db =
      await this._openBackgroundDb();


    await new Promise(
      (
        resolve,
        reject
      ) => {

        const tx =
          db.transaction(
            "settings",
            "readwrite"
          );

        const store =
          tx.objectStore(
            "settings"
          );


        store.put(
          file,
          "background"
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


    db.close();


    this._uploadedBackgroundBlob =
      file;


    if (
      this._uploadedBackgroundUrl
    ) {
      URL.revokeObjectURL(
        this._uploadedBackgroundUrl
      );
    }


    this._uploadedBackgroundUrl =
      URL.createObjectURL(
        file
      );


    this._render();
  }


  async _removeUploadedBackground() {

    try {

      const db =
        await this._openBackgroundDb();


      await new Promise(
        (
          resolve,
          reject
        ) => {

          const tx =
            db.transaction(
              "settings",
              "readwrite"
            );

          tx.objectStore(
            "settings"
          ).delete(
            "background"
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


      db.close();


      if (
        this._uploadedBackgroundUrl
      ) {
        URL.revokeObjectURL(
          this._uploadedBackgroundUrl
        );
      }


      this._uploadedBackgroundUrl =
        null;

      this._uploadedBackgroundBlob =
        null;


      this._render();

    } catch (err) {

      console.error(
        "Could not remove uploaded floorplan",
        err
      );
    }
  }


  _getBackground() {

    return (
      this._uploadedBackgroundUrl ||
      this._config.background ||
      null
    );
  }


  /*
   * -------------------------------------------------
   * LAYOUT STORAGE
   * -------------------------------------------------
   */


  _loadLayout() {

    try {

      const raw =
        localStorage.getItem(
          this._layoutStorageKey
        );

      if (!raw) {
        return {};
      }

      const parsed =
        JSON.parse(
          raw
        );

      if (
        parsed &&
        typeof parsed ===
        "object"
      ) {
        return parsed;
      }

    } catch (err) {

      console.warn(
        "HA IoT Floorplan: layout load failed",
        err
      );
    }

    return {};
  }


  _saveLayout() {

    try {

      localStorage.setItem(
        this._layoutStorageKey,
        JSON.stringify(
          this._layout
        )
      );

    } catch (err) {

      console.warn(
        "HA IoT Floorplan: layout save failed",
        err
      );
    }
  }


  /*
   * -------------------------------------------------
   * DATA
   * -------------------------------------------------
   */


  _getFloorplanData() {

    const snapshot =
      this._core.getSnapshot();


    const byArea =
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
        !device.areaName
      ) {
        continue;
      }


      if (
        !byArea.has(
          device.areaId
        )
      ) {

        byArea.set(
          device.areaId,
          {
            areaId:
              device.areaId,

            areaName:
              device.areaName,

            devices:
              []
          }
        );
      }


      byArea
        .get(
          device.areaId
        )
        .devices
        .push(
          device
        );
    }


    const areas =
      [
        ...byArea.values()
      ];


    areas.sort(
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
      areas,

      floating:
        snapshot.groups
          .floating,

      snapshot
    };
  }


  /*
   * -------------------------------------------------
   * HYBRID DEVICE GROUPING
   * -------------------------------------------------
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

      /*
       * HYBRID:
       *
       * one item = show actual device
       *
       * multiple items = show category group
       */

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


    /*
     * Bigger groups first, then
     * single devices.
     */

    result.sort(
      (
        a,
        b
      ) => {

        const aCount =
          a.type === "group"
            ? a.devices.length
            : 1;

        const bCount =
          b.type === "group"
            ? b.devices.length
            : 1;


        if (
          bCount !==
          aCount
        ) {
          return (
            bCount -
            aCount
          );
        }


        return (
          this._core
            .categoryTitle(
              a.category
            )
            .localeCompare(
              this._core
                .categoryTitle(
                  b.category
                )
            )
        );
      }
    );


    return result;
  }


  /*
   * -------------------------------------------------
   * DEFAULT ROOM POSITIONS
   * -------------------------------------------------
   */


  _ensureLayout(
    areas
  ) {

    const missing =
      areas.filter(
        area =>
          !this._layout[
            area.areaId
          ]
      );


    if (
      !missing.length
    ) {
      return;
    }


    const count =
      areas.length;


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
      Math.ceil(
        count /
        cols
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
          this._layout[
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


        this._layout[
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


    this._saveLayout();
  }


  /*
   * -------------------------------------------------
   * MAIN RENDER
   * -------------------------------------------------
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


    const noBackgroundStyle =
      background
        ? ""
        : `
          aspect-ratio:
            ${
              this._config
                .aspect_ratio ||
              "16 / 9"
            };
        `;


    this.innerHTML = `
      <ha-card>

        <style>

          .wrap {
            padding:
              18px;
          }


          .header {
            display:flex;

            justify-content:
              space-between;

            align-items:
              center;

            gap:
              14px;

            margin-bottom:
              14px;
          }


          .title {
            font-size:
              24px;

            font-weight:
              500;
          }


          .subtitle {
            font-size:
              12px;

            opacity:
              .6;

            margin-top:
              2px;
          }


          .controls {
            display:flex;

            gap:
              8px;

            flex-wrap:
              wrap;
          }


          .button {
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
              8px 12px;

            border-radius:
              8px;

            cursor:
              pointer;
          }


          .button.active {
            border-color:
              var(
                --primary-color
              );

            color:
              var(
                --primary-color
              );
          }


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

            ${noBackgroundStyle}
          }


          .floorplan-image {
            display:block;

            width:
              100%;

            height:
              auto;

            user-select:
              none;

            pointer-events:
              none;
          }


          .blank-floorplan {

            background-image:

              linear-gradient(
                to right,
                rgba(
                  127,
                  127,
                  127,
                  .08
                )
                1px,
                transparent
                1px
              ),

              linear-gradient(
                to bottom,
                rgba(
                  127,
                  127,
                  127,
                  .08
                )
                1px,
                transparent
                1px
              );

            background-size:
              40px 40px;
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
              10px;

            border:
              1px solid
              rgba(
                255,
                255,
                255,
                .16
              );

            background:
              rgba(
                10,
                17,
                27,
                .52
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
                140,
                255,
                .10
              );
          }


          .area-header {

            height:
              30px;

            box-sizing:
              border-box;

            display:flex;

            align-items:center;

            justify-content:
              space-between;

            gap:
              6px;

            padding:
              5px 8px;

            font-size:
              12px;

            font-weight:
              600;

            background:
              rgba(
                4,
                10,
                18,
                .74
              );

            white-space:
              nowrap;

            overflow:
              hidden;
          }


          .edit-mode
          .area-header {
            cursor:move;
            touch-action:none;
          }


          .area-count {
            font-size:
              10px;

            opacity:
              .55;

            font-weight:
              400;
          }


          .devices {

            display:grid;

            grid-template-columns:
              repeat(
                auto-fill,
                minmax(
                  76px,
                  1fr
                )
              );

            gap:
              5px;

            padding:
              6px;

            overflow:auto;

            max-height:
              calc(
                100% -
                30px
              );

            box-sizing:
              border-box;
          }


          /*
           * DEVICE TILE + GROUP TILE
           */

          .room-item {

            position:
              relative;

            min-height:
              64px;

            border-radius:
              8px;

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
                8,
                14,
                22,
                .82
              );

            display:flex;

            flex-direction:
              column;

            align-items:
              center;

            justify-content:
              center;

            gap:
              3px;

            padding:
              5px;

            box-sizing:
              border-box;

            text-align:
              center;
          }


          .group-item {
            cursor:pointer;

            border-color:
              rgba(
                0,
                168,
                255,
                .32
              );
          }


          .group-item:hover {

            background:
              rgba(
                0,
                120,
                210,
                .20
              );

            border-color:
              #00a8ff;
          }


          .room-item
          ha-icon {

            --mdc-icon-size:
              21px;
          }


          .item-name {

            width:
              100%;

            font-size:
              10px;

            line-height:
              1.15;

            font-weight:
              600;

            overflow:hidden;

            text-overflow:
              ellipsis;

            display:
              -webkit-box;

            -webkit-line-clamp:
              2;

            -webkit-box-orient:
              vertical;
          }


          .item-category {

            font-size:
              8px;

            opacity:
              .5;
          }


          .group-count {

            position:absolute;

            top:
              4px;

            right:
              5px;

            min-width:
              17px;

            height:
              17px;

            padding:
              0 4px;

            box-sizing:
              border-box;

            display:flex;

            align-items:center;

            justify-content:center;

            border-radius:
              999px;

            background:
              #00a8ff;

            color:
              #fff;

            font-size:
              9px;

            font-weight:
              700;
          }


          .status {

            position:absolute;

            top:
              5px;

            right:
              5px;

            width:
              7px;

            height:
              7px;

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


          /*
           * Resize
           */

          .resize-handle {

            display:none;

            position:absolute;

            width:18px;
            height:18px;

            right:0;
            bottom:0;

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
           * Floating devices
           */

          .floating {
            margin-top:18px;
          }


          .floating-title {

            font-size:15px;
            font-weight:600;
            margin-bottom:8px;
          }


          .floating-strip {

            display:flex;
            flex-wrap:wrap;
            gap:7px;
          }


          .floating-device {

            display:flex;

            align-items:center;

            gap:7px;

            padding:
              7px 10px;

            border-radius:
              999px;

            border:
              1px solid
              var(
                --divider-color
              );

            background:
              var(
                --secondary-background-color
              );

            font-size:
              11px;
          }


          .floating-device
          ha-icon {
            --mdc-icon-size:17px;
          }


          .floating-dot {

            width:7px;
            height:7px;

            border-radius:50%;
          }


          /*
           * CATEGORY POPUP
           */

          .modal-backdrop {

            position:fixed;

            inset:0;

            z-index:9999;

            display:flex;

            align-items:center;

            justify-content:center;

            background:
              rgba(
                0,
                0,
                0,
                .70
              );

            padding:20px;
          }


          .modal {

            width:
              min(
                520px,
                92vw
              );

            max-height:
              80vh;

            overflow:auto;

            border-radius:
              14px;

            border:
              1px solid
              rgba(
                0,
                168,
                255,
                .45
              );

            background:
              var(
                --card-background-color
              );

            box-shadow:
              0 12px 40px
              rgba(
                0,
                0,
                0,
                .55
              );
          }


          .modal-header {

            position:sticky;

            top:0;

            z-index:1;

            display:flex;

            justify-content:
              space-between;

            align-items:center;

            gap:10px;

            padding:
              14px 16px;

            background:
              var(
                --card-background-color
              );

            border-bottom:
              1px solid
              var(
                --divider-color
              );
          }


          .modal-title {

            display:flex;

            align-items:center;

            gap:9px;

            font-size:
              17px;

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
              34px
              1fr
              auto;

            gap:
              10px;

            align-items:center;

            padding:
              11px 16px;

            border-bottom:
              1px solid
              var(
                --divider-color
              );
          }


          .modal-device
          ha-icon {

            --mdc-icon-size:
              22px;
          }


          .modal-device-name {
            font-size:
              13px;

            font-weight:
              600;
          }


          .modal-device-details {
            font-size:
              11px;

            opacity:
              .55;

            margin-top:
              2px;
          }


          .modal-status {

            width:
              9px;

            height:
              9px;

            border-radius:
              50%;
          }


          .footer {

            margin-top:
              14px;

            font-size:
              10px;

            opacity:
              .4;
          }


          @media (
            max-width:
              900px
          ) {

            .header {

              flex-direction:
                column;

              align-items:
                flex-start;
            }


            .devices {

              grid-template-columns:
                repeat(
                  auto-fill,
                  minmax(
                    58px,
                    1fr
                  )
                );
            }
          }

        </style>


        <div class="wrap">


          <div class="header">

            <div>

              <div class="title">
                HA IoT Floorplan
              </div>

              <div class="subtitle">

                Hybrid grouping
                • duplicate categories collapse automatically

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
                this._uploadedBackgroundUrl
                  ? `
                    <button
                      id="remove-background"
                      class="button"
                    >
                      Remove uploaded image
                    </button>
                  `
                  : ""
              }


              <input
                id="background-file"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
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


              ${
                this._editMode
                  ? `
                    <button
                      id="reset-layout"
                      class="button"
                    >
                      Reset layout
                    </button>
                  `
                  : ""
              }

            </div>

          </div>


          ${
            this._editMode
              ? `
                <div class="edit-note">

                  Drag rooms by their title bar.
                  Resize from the lower-right corner.

                </div>
              `
              : ""
          }


          <div
            id="floorplan"
            class="
              floorplan
              ${
                background
                  ? ""
                  : "blank-floorplan"
              }
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


          <div class="floating">

            <div class="floating-title">
              Floating / Mobile
            </div>


            ${
              data.floating.length
                ? `
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
                `
                : `
                  <div
                    style="
                      opacity:.5;
                      font-size:11px;
                    "
                  >
                    No floating devices.
                  </div>
                `
            }

          </div>


          <div class="footer">

            HA IoT Floorplan v0.3
            • Hybrid grouping
            • Browser-stored background

          </div>

        </div>


        ${
          this._renderGroupModal()
        }

      </ha-card>
    `;


    this._attachHandlers();
  }


  /*
   * -------------------------------------------------
   * AREA
   * -------------------------------------------------
   */


  _renderArea(
    area
  ) {

    const layout =
      this._layout[
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
            ${this._escapeHtml(
              area.areaName
            )}
          </span>


          <span class="area-count">

            ${area.devices.length}
            devices

          </span>

        </div>


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


    const onlineCount =
      item.devices.filter(
        device =>
          device.online
      ).length;


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

          ${onlineCount}
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
   * -------------------------------------------------
   * GROUP POPUP
   * -------------------------------------------------
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


    const devices =
      area.devices.filter(
        device =>
          this._core
            .getResolvedCategory(
              device
            ) ===
          this._activeGroup
            .category
      );


    const category =
      this._activeGroup
        .category;


    const title =
      this._core
        .categoryTitle(
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

        <div
          class="modal"
          id="group-modal"
        >


          <div class="modal-header">


            <div class="modal-title">

              <ha-icon
                icon="${
                  this._escapeHtml(
                    icon
                  )
                }"
              ></ha-icon>


              <span>

                ${
                  this._escapeHtml(
                    area.areaName
                  )
                }

                •

                ${
                  this._escapeHtml(
                    title
                  )
                }

                (${devices.length})

              </span>

            </div>


            <button
              class="modal-close"
              id="close-group-modal"
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
   * -------------------------------------------------
   * FLOATING
   * -------------------------------------------------
   */


  _renderFloating(
    device
  ) {

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


    return `
      <div
        class="floating-device"
        title="${
          this._escapeHtml(
            device.name
          )
        }"
      >

        <ha-icon
          icon="${
            this._escapeHtml(
              icon
            )
          }"
        ></ha-icon>


        <span>

          ${
            this._escapeHtml(
              device.name
            )
          }

        </span>


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
   * -------------------------------------------------
   * HANDLERS
   * -------------------------------------------------
   */


  _attachHandlers() {


    /*
     * Background upload
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


          if (
            !file.type.startsWith(
              "image/"
            )
          ) {

            alert(
              "Please select an image file."
            );

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
     * Layout editor
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
     * Category group popup
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
            this._editMode
          ) {
            return;
          }


          this._openGroup(

            tile.dataset
              .groupArea,

            tile.dataset
              .groupCategory
          );
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


    this.querySelector(
      "#group-modal-backdrop"
    )?.addEventListener(
      "click",
      event => {

        if (
          event.target.id ===
          "group-modal-backdrop"
        ) {
          this._closeGroup();
        }
      }
    );


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
   * -------------------------------------------------
   * EDIT MODE
   * -------------------------------------------------
   */


  _toggleEditMode() {

    this._editMode =
      !this._editMode;


    this._render();
  }


  _resetLayout() {

    const confirmed =
      confirm(
        "Reset all room positions and sizes?"
      );


    if (!confirmed) {
      return;
    }


    this._layout = {};


    this._saveLayout();

    this._render();
  }


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


    const layout =
      this._layout[
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


        this._saveLayout();
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


    const layout =
      this._layout[
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


  _startResize(
    event,
    areaId
  ) {

    const canvas =
      this._getCanvas();


    const layout =
      this._layout[
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


        this._saveLayout();
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


    const layout =
      this._layout[
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


    const layout =
      this._layout[
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


  _renderLoading() {

    this.innerHTML = `
      <ha-card header="HA IoT Floorplan">

        <div
          style="
            padding:16px;
          "
        >
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
      "Visual IoT floorplan using Home Assistant Areas"

  });
}


console.info(
  "%c HA IoT Floorplan %c v0.3 ",
  "background:#00a8ff;color:white;font-weight:bold;",
  "background:#333;color:white;"
);
