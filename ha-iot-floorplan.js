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
     * While editing the layout we do NOT
     * continuously rebuild the DOM.
     */
    if (
      !this._loaded ||
      this._editMode
    ) {
      return;
    }

    const now =
      Date.now();

    /*
     * HA can call the hass setter extremely
     * frequently. 1.5 s is plenty for this
     * visual overview.
     */
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

    this._loading =
      true;

    this._renderLoading();

    try {

      /*
       * Floorplan is intentionally read-only.
       *
       * We only load registries here.
       * Label creation / setup belongs to
       * HA IoT Map Manager.
       */
      await this._core.reloadRegistries();

      this._loaded =
        true;

      this._loading =
        false;

      this._lastRender =
        Date.now();

      this._render();

    } catch (err) {

      console.error(
        "HA IoT Floorplan initialization failed",
        err
      );

      this._loading =
        false;

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
        JSON.parse(raw);

      if (
        parsed &&
        typeof parsed === "object"
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


    /*
     * Generate a sensible initial arrangement.
     * It is only a starting point for the editor.
     */

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


    this._layout =
      {};


    this._saveLayout();

    this._render();
  }


  _render() {

    if (
      !this._loaded
    ) {
      return;
    }


    const data =
      this._getFloorplanData();


    this._ensureLayout(
      data.areas
    );


    const background =
      this._config
        .background ||
      null;


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


          /*
           * Main floorplan.
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
              var(
                --secondary-background-color
              );

            ${noBackgroundStyle}
          }


          .floorplan-image {
            display:
              block;

            width:
              100%;

            height:
              auto;

            user-select:
              none;

            pointer-events:
              none;
          }


          /*
           * When no image is configured we
           * give the blank canvas a subtle grid.
           */
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
            position:
              absolute;

            inset:
              0;
          }


          .area {
            position:
              absolute;

            box-sizing:
              border-box;

            overflow:
              hidden;

            border-radius:
              10px;

            border:
              1px solid
              color-mix(
                in srgb,
                var(
                  --primary-text-color
                )
                22%,
                transparent
              );

            background:
              color-mix(
                in srgb,
                var(
                  --card-background-color
                )
                68%,
                transparent
              );

            backdrop-filter:
              blur(
                1px
              );
          }


          .edit-mode .area {
            border:
              2px dashed
              var(
                --primary-color
              );

            background:
              color-mix(
                in srgb,
                var(
                  --primary-color
                )
                12%,
                var(
                  --card-background-color
                )
              );
          }


          .area-header {
            height:
              30px;

            box-sizing:
              border-box;

            display:flex;

            align-items:
              center;

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
              color-mix(
                in srgb,
                var(
                  --card-background-color
                )
                82%,
                transparent
              );

            white-space:
              nowrap;

            overflow:
              hidden;
          }


          .edit-mode
          .area-header {

            cursor:
              move;

            touch-action:
              none;
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
                  74px,
                  1fr
                )
              );

            gap:
              5px;

            padding:
              6px;

            overflow:
              auto;

            max-height:
              calc(
                100% -
                30px
              );

            box-sizing:
              border-box;
          }


          .device {
            position:
              relative;

            min-height:
              63px;

            border-radius:
              8px;

            background:
              color-mix(
                in srgb,
                var(
                  --card-background-color
                )
                88%,
                transparent
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


          .device ha-icon {
            --mdc-icon-size:
              20px;
          }


          .device-name {
            width:
              100%;

            font-size:
              10px;

            line-height:
              1.15;

            font-weight:
              600;

            overflow:
              hidden;

            text-overflow:
              ellipsis;

            display:
              -webkit-box;

            -webkit-line-clamp:
              2;

            -webkit-box-orient:
              vertical;
          }


          .device-category {
            font-size:
              8px;

            opacity:
              .5;
          }


          .status {
            position:
              absolute;

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
           * Resize handle only appears in
           * layout editing mode.
           */
          .resize-handle {
            display:
              none;

            position:
              absolute;

            width:
              18px;

            height:
              18px;

            right:
              0;

            bottom:
              0;

            cursor:
              nwse-resize;

            touch-action:
              none;
          }


          .edit-mode
          .resize-handle {
            display:
              block;
          }


          .resize-handle::after {

            content:
              "";

            position:
              absolute;

            right:
              4px;

            bottom:
              4px;

            width:
              8px;

            height:
              8px;

            border-right:
              2px solid
              var(
                --primary-color
              );

            border-bottom:
              2px solid
              var(
                --primary-color
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
              color-mix(
                in srgb,
                var(
                  --primary-color
                )
                10%,
                transparent
              );

            font-size:
              11px;

            opacity:
              .85;
          }


          .floating {
            margin-top:
              18px;
          }


          .floating-title {
            font-size:
              15px;

            font-weight:
              600;

            margin-bottom:
              8px;
          }


          .floating-strip {
            display:flex;

            flex-wrap:
              wrap;

            gap:
              7px;
          }


          .floating-device {
            display:flex;

            align-items:
              center;

            gap:
              7px;

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
            --mdc-icon-size:
              17px;
          }


          .floating-dot {
            width:
              7px;

            height:
              7px;

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


            .device-name {
              font-size:
                9px;
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
                ${
                  background
                    ? "Floorplan background + Home Assistant Areas"
                    : "Automatic layout • add a background image when ready"
                }
              </div>

            </div>


            <div class="controls">

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

                  Drag a room by its title bar.
                  Resize from the lower-right corner.
                  Positions are stored as percentages,
                  so the layout scales with the screen.

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

            HA IoT Floorplan v0.2
            • Shared Core v0.9
            • Layout storage:
            browser local

          </div>

        </div>

      </ha-card>
    `;


    this._attachHandlers();
  }


  _renderArea(area) {

    const layout =
      this._layout[
        area.areaId
      ];


    if (!layout) {
      return "";
    }


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

            ${
              area.devices.length
            }

          </span>

        </div>


        <div class="devices">

          ${
            area.devices
              .map(
                device =>
                  this._renderDevice(
                    device
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


  _renderDevice(device) {

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


    const titleParts =
      [
        device.name,

        this._core
          .categoryTitle(
            category
          )
      ];


    if (device.ip) {
      titleParts.push(
        `IP: ${device.ip}`
      );
    }


    if (device.mac) {
      titleParts.push(
        `MAC: ${device.mac}`
      );
    }


    return `
      <div
        class="device"
        title="${
          this._escapeHtml(
            titleParts.join(
              "\n"
            )
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


        <div class="device-name">

          ${
            this._escapeHtml(
              device.name
            )
          }

        </div>


        <div class="device-category">

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


  _attachHandlers() {

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


    if (
      !this._editMode
    ) {
      return;
    }


    /*
     * ROOM DRAGGING
     */
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


    /*
     * ROOM RESIZING
     */
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

      original:
        {
          ...layout
        }

    };


    const move =
      e =>
        this._dragMove(
          e
        );


    const end =
      e => {

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


  _dragMove(event) {

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

      original:
        {
          ...layout
        }

    };


    const move =
      e =>
        this._resizeMove(
          e
        );


    const end =
      e => {

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


  _resizeMove(event) {

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


    const minW =
      7;


    const minH =
      8;


    layout.w =
      this._clamp(
        state.original.w +
        dx,
        minW,
        100 -
        layout.x
      );


    layout.h =
      this._clamp(
        state.original.h +
        dy,
        minH,
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
    return 10;
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
  "%c HA IoT Floorplan %c v0.2 ",
  "background:#673ab7;color:white;font-weight:bold;",
  "background:#333;color:white;"
);
