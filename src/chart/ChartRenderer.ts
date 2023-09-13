import {
  Container,
  DisplayObject,
  FederatedMouseEvent,
  Point,
  Rectangle,
} from "pixi.js"
import { ContextMenuPopup } from "../gui/element/ContextMenu"
import { Options } from "../util/Options"
import { bsearch, isRightClick } from "../util/Util"
import { ChartManager, EditMode, EditTimingMode } from "./ChartManager"
import { BarlineContainer } from "./component/BarlineContainer"
import { ComboNumber } from "./component/ComboNumber"
import { JudgmentSprite } from "./component/JudgmentSprite"
import { PreviewAreaContainer } from "./component/PreviewAreaContainer"
import { SelectionAreaContainer } from "./component/SelectionAreaContainer"
import { SelectionBoundary } from "./component/SelectionSprite"
import { SelectionTimingEventContainer } from "./component/SelectionTimingEventContainer"
import { SnapContainer } from "./component/SnapContainer"
import { TimingAreaContainer } from "./component/TimingAreaContainer"
import { TimingBarContainer } from "./component/TimingBarContainer"
import { TimingTrackContainer } from "./component/TimingTrackContainer"
import { Waveform } from "./component/Waveform"
import { Notefield } from "./gameTypes/base/Notefield"
import { TimingWindow } from "./play/TimingWindow"
import { Chart } from "./sm/Chart"
import { NotedataEntry } from "./sm/NoteTypes"

interface SelectionBounds {
  start: Point
  end: Point
}

export interface ChartRendererComponent {
  update: (fromBeat: number, toBeat: number) => void
}

export class ChartRenderer extends Container<
  DisplayObject & ChartRendererComponent
> {
  chartManager: ChartManager
  chart: Chart

  private speedMult = 1

  private lastMousePos?: Point
  private lastMouseBeat = -1
  private lastMouseCol = -1
  private lastNoteType = ""
  private editingCol = -1

  private waveform: Waveform
  private barlines: BarlineContainer
  private timingAreas: TimingAreaContainer
  private timingTracks: TimingTrackContainer
  private selectedEvents: SelectionTimingEventContainer
  private timingBar: TimingBarContainer
  private notefield: Notefield
  private snapDisplay: SnapContainer
  private judgment: JudgmentSprite
  private combo: ComboNumber
  private selectionBoundary: SelectionBoundary
  private selectionArea: SelectionAreaContainer
  private previewArea: PreviewAreaContainer

  private selectionBounds?: SelectionBounds

  constructor(chartManager: ChartManager) {
    super()
    this.chartManager = chartManager
    this.chart = chartManager.loadedChart!

    this.waveform = new Waveform(this)
    this.barlines = new BarlineContainer(this)
    this.timingAreas = new TimingAreaContainer(this)
    this.timingTracks = new TimingTrackContainer(this)
    this.selectedEvents = new SelectionTimingEventContainer(this)
    this.timingBar = new TimingBarContainer(this)
    this.notefield = new this.chart.gameType.notefield(this)
    this.snapDisplay = new SnapContainer(this)
    this.previewArea = new PreviewAreaContainer(this)
    this.selectionArea = new SelectionAreaContainer(this)
    this.judgment = new JudgmentSprite()
    this.combo = new ComboNumber(this)
    this.selectionBoundary = new SelectionBoundary(this)

    this.addChild(
      this.waveform,
      this.barlines,
      this.timingAreas,
      this.previewArea,
      this.selectionArea,
      this.timingTracks,
      this.selectedEvents,
      this.timingBar,
      this.combo,
      this.notefield,
      this.snapDisplay,
      this.judgment,
      this.selectionBoundary
    )

    this.chartManager.app.stage.addChild(this)

    this.x = this.chartManager.app.renderer.screen.width / 2
    this.y = this.chartManager.app.renderer.screen.height / 2

    this.eventMode = "static"
    this.hitArea = new Rectangle(-1e5, -1e5, 2e5, 2e5)

    const keyHandler = (event: KeyboardEvent) => {
      if (this.editingCol != -1) {
        const snap = Options.chart.snap == 0 ? 1 / 48 : Options.chart.snap
        const snapBeat =
          Math.round(this.getBeatFromYPos(this.lastMousePos!.y) / snap) * snap
        this.chartManager.editHoldBeat(
          this.editingCol,
          snapBeat,
          event.shiftKey
        )
      }
    }

    let selectionSpeed = 0
    const tickHandler = () => {
      if (
        (!this.chartManager.selection.shift && !this.selectionBounds) ||
        selectionSpeed == 0
      )
        return
      // Scroll the notefield if the cursor is near the edge of the screen
      const pos = this.getYPosFromBeat(
        Math.max(0, this.chartManager.getBeat() + selectionSpeed)
      )
      this.chartManager.setBeat(
        Math.max(0, this.chartManager.getBeat() + selectionSpeed)
      )
      if (this.selectionBounds)
        this.selectionBounds.start.y +=
          Options.chart.receptorYPos / Options.chart.zoom - pos
    }

    this.chartManager.app.ticker.add(tickHandler)

    window.addEventListener("keydown", keyHandler)
    this.on("destroyed", () => {
      window.removeEventListener("keydown", keyHandler)
      this.removeAllListeners()
      this.chartManager.app.ticker.remove(tickHandler)
    })

    this.on("pointerdown", event => {
      if (isRightClick(event)) return
      if (this.chartManager.getMode() == EditMode.Play) return
      if (
        this.chartManager.editTimingMode == EditTimingMode.Add &&
        this.lastMousePos
      ) {
        this.timingTracks.placeGhostEvent()
      } else if (
        this.chartManager.editTimingMode == EditTimingMode.Off &&
        Options.general.mousePlacement &&
        this.lastMouseBeat != -1 &&
        this.lastMouseCol != -1 &&
        !event.getModifierState("Shift")
      ) {
        // Place a note
        this.chartManager.clearSelections()
        this.editingCol = this.lastMouseCol
        this.chartManager.setNote(
          this.lastMouseCol,
          "mouse",
          this.lastMouseBeat
        )
      } else {
        // Start selecting
        if (
          !event.getModifierState("Control") &&
          !event.getModifierState("Meta") &&
          !event.getModifierState("Shift")
        ) {
          this.chartManager.clearSelections()
        }
        this.chartManager[
          this.chartManager.editTimingMode == EditTimingMode.Off
            ? "startDragSelection"
            : "startDragEventSelection"
        ]()
        this.selectionBounds = {
          start: this.toLocal(event.global),
          end: this.toLocal(event.global),
        }
      }
    })

    this.on("mousemove", event => {
      // Process selection
      this.lastMousePos = this.toLocal(event.global)
      if (this.editingCol != -1) {
        const snap = Options.chart.snap == 0 ? 1 / 48 : Options.chart.snap
        const snapBeat =
          Math.round(this.getBeatFromYPos(this.lastMousePos.y) / snap) * snap
        this.chartManager.editHoldBeat(
          this.editingCol,
          snapBeat,
          event.shiftKey
        )
      }
      if (this.selectionBounds) {
        this.selectionBounds.end = this.toLocal(event.global)
      }
      selectionSpeed =
        Math.max(0, this.lastMousePos.y - this.getLowerBound() + 100) / 600
      if (this.lastMousePos.y < 0) {
        selectionSpeed =
          Math.min(0, this.lastMousePos.y - this.getUpperBound() - 100) / 600
      }
    })

    this.on("pointerup", () => {
      // End selecting
      if (this.editingCol != -1) {
        this.chartManager.endEditing(this.editingCol)
        this.editingCol = -1
      }
      this.chartManager[
        this.chartManager.editTimingMode == EditTimingMode.Off
          ? "endDragSelection"
          : "endDragEventSelection"
      ]()
      this.selectionBounds = undefined
      selectionSpeed = 0
    })
  }

  isDragSelecting() {
    return !!this.selectionBounds
  }

  doJudgment(note: NotedataEntry, error: number, judgment: TimingWindow) {
    if (this.chartManager.getMode() == EditMode.Play) {
      this.judgment.doJudge(error, judgment)
      this.timingBar.addBar(error, judgment)
    }
    this.notefield.doJudge(note.col, judgment)
  }

  activateHold(col: number) {
    this.notefield.activateHold(col)
  }

  keyDown(col: number) {
    this.notefield.keyDown(col)
  }

  keyUp(col: number) {
    this.notefield.keyUp(col)
  }

  endPlay() {
    this.notefield.endPlay()
    this.timingBar.reset()
    this.judgment.reset()
  }

  update() {
    const beat = this.getVisualBeat()
    const time = this.getVisualTime()

    this.speedMult = Options.chart.doSpeedChanges
      ? this.chart.timingData.getSpeedMult(beat, time)
      : 1

    const fromBeat = this.getUpperBoundBeat()
    const toBeat = this.getLowerBoundBeat()

    this.scale.x = Options.chart.zoom
    this.scale.y = (Options.chart.reverse ? -1 : 1) * Options.chart.zoom

    this.children.forEach(child => child.update(fromBeat, toBeat))
    this.notefield.alpha =
      this.chartManager.editTimingMode == EditTimingMode.Off ||
      this.chartManager.getMode() == EditMode.Play
        ? 1
        : 0.3

    // Move the ghost note for mouse placement
    if (
      Options.general.mousePlacement &&
      this.lastMousePos &&
      this.chartManager.getMode() != EditMode.Play
    ) {
      const snap = Options.chart.snap == 0 ? 1 / 48 : Options.chart.snap
      const snapBeat =
        Math.round(this.getBeatFromYPos(this.lastMousePos.y) / snap) * snap
      const col = Math.round((this.lastMousePos.x + 96) / 64)
      if (
        snapBeat != this.lastMouseBeat ||
        col != this.lastMouseCol ||
        this.chartManager.getEditingNoteType() != this.lastNoteType
      ) {
        this.lastMouseBeat = snapBeat
        this.lastMouseCol = col
        this.lastNoteType = this.chartManager.getEditingNoteType()
        if (this.editingCol != -1) {
          this.chartManager.editHoldBeat(this.editingCol, snapBeat, false)
        }
        if (col > 3 || col < 0) {
          this.lastMouseBeat = -1
          this.lastMouseCol = -1
          this.notefield.setGhostNote()
        } else {
          this.notefield.setGhostNote({
            beat: snapBeat,
            col: this.lastMouseCol,
            type: this.chartManager.getEditingNoteType(),
          })
        }
      }
    }

    // Move the ghost event when adding events
    if (
      this.lastMousePos &&
      this.chartManager.editTimingMode == EditTimingMode.Add
    ) {
      this.timingTracks.updateGhostEvent(this.lastMousePos)
    }
  }

  /**
   * Gets the current time including play offset
   *
   * @return {*}  {number}
   * @memberof ChartRenderer
   */
  getTimeWithOffset(): number {
    let time = this.chartManager.getTime()
    if (
      this.chartManager.getMode() == EditMode.Play ||
      this.chartManager.getMode() == EditMode.Record
    ) {
      time += Options.play.offset
    }
    return time
  }

  /**
   * Gets the current beat including play offset
   *
   * @return {*}  {number}
   * @memberof ChartRenderer
   */
  getBeatWithOffset(): number {
    let beat = this.chartManager.getBeat()
    if (
      this.chartManager.getMode() == EditMode.Play ||
      this.chartManager.getMode() == EditMode.Record
    ) {
      beat = this.chart.getBeatFromSeconds(this.getTimeWithOffset())
    }
    return beat
  }

  /**
   * Gets the current time including play and visual offset
   *
   * @return {*}  {number}
   * @memberof ChartRenderer
   */
  getVisualTime(): number {
    let time = this.chartManager.getTime()
    if (
      this.chartManager.getMode() == EditMode.Play ||
      this.chartManager.getMode() == EditMode.Record
    ) {
      time += Options.play.offset + Options.play.visualOffset
    }
    return time
  }

  /**
   * Gets the current beat including play and visual offset
   *
   * @return {*}  {number}
   * @memberof ChartRenderer
   */
  getVisualBeat(): number {
    let beat = this.chartManager.getBeat()
    if (
      this.chartManager.getMode() == EditMode.Play ||
      this.chartManager.getMode() == EditMode.Record
    ) {
      beat = this.chart.getBeatFromSeconds(this.getVisualTime())
    }
    return beat
  }

  /**
   * Returns the y position for a note on the given beat.
   *
   * @param {number} beat
   * @return {*}  {number}
   * @memberof ChartRenderer
   */
  getYPosFromBeat(beat: number): number {
    const currentTime = this.getVisualTime()
    const currentBeat = this.getVisualBeat()
    if (Options.chart.CMod) {
      const deltaTime = this.chart.getSecondsFromBeat(beat) - currentTime
      const deltaY = deltaTime * this.getSecondsToPixelsRatio()
      return deltaY + this.getActualReceptorYPos()
    }
    if (currentBeat == beat) return this.getActualReceptorYPos()
    const deltaBeat = Options.chart.doSpeedChanges
      ? this.chart.timingData.getEffectiveBeat(beat) -
        this.chart.timingData.getEffectiveBeat(currentBeat)
      : beat - currentBeat
    const deltaY = deltaBeat * this.getEffectiveBeatsToPixelsRatio()
    return deltaY + this.getActualReceptorYPos()
  }

  /**
   * Returns the y position for a note at the given second.
   * Use this method to prevent calculating the current second (usually in CMod).
   *
   * @param {number} time
   * @return {*}  {number}
   * @memberof ChartRenderer
   */
  getYPosFromSecond(time: number): number {
    const currentTime = this.getVisualTime()
    if (Options.chart.CMod) {
      const deltaTime = time - currentTime
      const deltaY = deltaTime * this.getSecondsToPixelsRatio()
      return deltaY + this.getActualReceptorYPos()
    } else {
      return this.getYPosFromBeat(
        this.chart.timingData.getBeatFromSeconds(time)
      )
    }
  }

  /**
   * Returns the second for a note at the specified y position.
   * May return an incorrect value when negative scrolls are used.
   *
   * @param {number} yp
   * @return {*}  {number}
   * @memberof ChartRenderer
   */
  getSecondFromYPos(yp: number): number {
    if (Options.chart.CMod) {
      const pixelsToSeconds = this.getPixelsToSecondsRatio()
      const currentTime = this.getVisualTime()

      const deltaY = yp - Options.chart.receptorYPos / Options.chart.zoom
      const deltaTime = deltaY * pixelsToSeconds
      return currentTime + deltaTime
    }
    return this.chart.getSecondsFromBeat(this.getBeatFromYPos(yp))
  }

  /**
   * Returns the beat for a note at the specified y position.
   * May return an incorrect value when negative scrolls are used.
   *
   * @param {number} yp
   * @param {boolean} [ignoreScrolls] - Set to true to ignore scrolls
   * @return {*}  {number}
   * @memberof ChartRenderer
   */
  getBeatFromYPos(yp: number, ignoreScrolls?: boolean): number {
    const currentBeat = this.getVisualBeat()
    if (Options.chart.CMod) {
      return this.chart.getBeatFromSeconds(this.getSecondFromYPos(yp))
    }
    const deltaY = yp - this.getActualReceptorYPos()
    const deltaBeat = deltaY * this.getPixelsToEffectiveBeatsRatio()
    if (Options.chart.doSpeedChanges && !ignoreScrolls) {
      const effBeat =
        this.chart.timingData.getEffectiveBeat(currentBeat) + deltaBeat
      return this.chart.getBeatFromEffectiveBeat(effBeat)
    }
    return currentBeat + deltaBeat
  }

  /**
   * Returns the y position of the receptors after zooming.
   *
   * @return {*}  {number}
   * @memberof ChartRenderer
   */
  getActualReceptorYPos(): number {
    return Options.chart.receptorYPos / Options.chart.zoom
  }

  getEffectiveBeatsToPixelsRatio(): number {
    return (Options.chart.speed / 100) * 64 * this.speedMult
  }

  getPixelsToEffectiveBeatsRatio(): number {
    return 1 / this.getEffectiveBeatsToPixelsRatio()
  }

  getSecondsToPixelsRatio(): number {
    return (Options.chart.speed / 100) * 64 * 4
  }

  getPixelsToSecondsRatio(): number {
    return 1 / this.getSecondsToPixelsRatio()
  }

  /**
   * Returns true if the chart is current at a negative scroll.
   *
   * @param {number} beat
   * @return {*}
   * @memberof ChartRenderer
   */
  isNegScroll(beat: number) {
    return (
      Options.chart.doSpeedChanges &&
      (this.speedMult < 0 ||
        (this.chart.timingData.getTimingEventAtBeat("SCROLLS", beat)?.value ??
          1) < 0 ||
        this.chart.timingData.getBPM(beat) < 0)
    )
  }

  /**
   * Returns the maximum y position to render.
   *
   * @return {*}  {number}
   * @memberof ChartRenderer
   */
  getLowerBound(): number {
    return (
      (this.chartManager.app.renderer.screen.height - this.y) /
        Options.chart.zoom +
      32
    )
  }

  /**
   * Returns the minimum beat to render
   *
   * @return {*}  {number}
   * @memberof ChartRenderer
   */
  getUpperBoundBeat(): number {
    if (
      Options.chart.waveform.speedChanges &&
      !Options.chart.CMod &&
      Options.chart.doSpeedChanges
    ) {
      // XMod with speed changes

      const chartSpeed = Options.chart.speed
      const speedMult = this.chart.timingData.getSpeedMult(
        this.getVisualBeat(),
        this.getVisualTime()
      )
      const scrolls = this.chart.timingData.getTimingData("SCROLLS")
      const pixelsToEffectiveBeats =
        100 / chartSpeed / speedMult / 64 / Options.chart.zoom
      const upperBound = this.getUpperBound()
      const lowerBound = this.getLowerBound()

      // Find the latest scroll
      let scrollIndex = bsearch(
        scrolls,
        this.getVisualBeat() - Options.chart.maxDrawBeatsBack,
        a => a.beat
      )

      while (
        scrolls[scrollIndex]?.beat <
        this.getVisualBeat() + Options.chart.maxDrawBeats
      ) {
        const scroll = scrolls[scrollIndex]

        const scrollStartYPos =
          this.getYPosFromBeat(scroll.beat) * Options.chart.zoom

        const scrollEndBeat =
          scrolls[scrollIndex + 1]?.beat ??
          this.getVisualBeat() + Options.chart.maxDrawBeats
        const scrollEndYPos =
          this.getYPosFromBeat(scrollEndBeat) * Options.chart.zoom

        if (
          scroll.value > 0 &&
          scrollEndYPos > upperBound &&
          (scrollStartYPos < upperBound ||
            !scrolls[scrollIndex - 1] ||
            scrolls[scrollIndex - 1].beat <
              this.getVisualBeat() - Options.chart.maxDrawBeatsBack)
        )
          break
        if (
          scroll.value < 0 &&
          scrollEndYPos < lowerBound &&
          (scrollStartYPos > lowerBound ||
            !scrolls[scrollIndex - 1] ||
            scrolls[scrollIndex - 1].beat <
              this.getVisualBeat() - Options.chart.maxDrawBeatsBack)
        )
          break

        scrollIndex++
      }

      const scrollBeat = scrolls[scrollIndex]?.beat ?? 0
      const scrollStartY = this.getYPosFromBeat(scrollBeat) * Options.chart.zoom
      const scrollValue = scrolls[scrollIndex]?.value ?? 1
      const pixelsToBeats = pixelsToEffectiveBeats / Math.abs(scrollValue)

      if (scrollValue > 0) {
        return Math.max(
          this.getVisualBeat() - Options.chart.maxDrawBeatsBack,
          scrollBeat + pixelsToBeats * (upperBound - scrollStartY)
        )
      }
      return Math.max(
        this.getVisualBeat() - Options.chart.maxDrawBeatsBack,
        scrollBeat + pixelsToBeats * (scrollStartY - lowerBound)
      )
    }
    if (!Options.chart.CMod)
      return Math.max(
        this.getVisualBeat() - Options.chart.maxDrawBeatsBack,
        this.getBeatFromYPos(this.getUpperBound())
      )
    return this.getBeatFromYPos(this.getUpperBound())
  }

  /**
   * Returns the maximum beat to render.
   *
   * @return {*}  {number}
   * @memberof ChartRenderer
   */
  getLowerBoundBeat(): number {
    if (
      Options.chart.waveform.speedChanges &&
      !Options.chart.CMod &&
      Options.chart.doSpeedChanges
    ) {
      // XMod with speed changes

      const chartSpeed = Options.chart.speed
      const speedMult = this.chart.timingData.getSpeedMult(
        this.getVisualBeat(),
        this.getVisualTime()
      )
      const scrolls = this.chart.timingData.getTimingData("SCROLLS")
      const pixelsToEffectiveBeats =
        100 / chartSpeed / speedMult / 64 / Options.chart.zoom
      const upperBound = this.getUpperBound()
      const lowerBound = this.getLowerBound()

      // Find the latest scroll
      let scrollIndex = bsearch(
        scrolls,
        this.getVisualBeat() + Options.chart.maxDrawBeats,
        a => a.beat
      )

      while (
        scrolls[scrollIndex]?.beat >
        this.getVisualBeat() - Options.chart.maxDrawBeatsBack
      ) {
        const scroll = scrolls[scrollIndex]

        const scrollStartYPos =
          this.getYPosFromBeat(scroll.beat) * Options.chart.zoom

        const scrollEndBeat =
          scrolls[scrollIndex + 1]?.beat ??
          this.getVisualBeat() + Options.chart.maxDrawBeats
        const scrollEndYPos =
          this.getYPosFromBeat(scrollEndBeat) * Options.chart.zoom

        if (
          scroll.value > 0 &&
          scrollStartYPos < lowerBound &&
          (scrollEndYPos > lowerBound ||
            !scrolls[scrollIndex + 1] ||
            scrolls[scrollIndex + 1].beat >
              this.getVisualBeat() + Options.chart.maxDrawBeatsBack)
        )
          break
        if (
          scroll.value < 0 &&
          scrollStartYPos > upperBound &&
          (scrollEndYPos < upperBound ||
            !scrolls[scrollIndex + 1] ||
            scrolls[scrollIndex + 1].beat >
              this.getVisualBeat() + Options.chart.maxDrawBeatsBack)
        )
          break

        scrollIndex--
      }

      const scrollBeat = scrolls[scrollIndex]?.beat ?? 0
      const scrollStartY = this.getYPosFromBeat(scrollBeat) * Options.chart.zoom
      const scrollValue = scrolls[scrollIndex]?.value ?? 1
      const pixelsToBeats = pixelsToEffectiveBeats / Math.abs(scrollValue)

      if (scrollValue > 0) {
        return Math.min(
          this.getVisualBeat() + Options.chart.maxDrawBeats,
          scrollBeat + pixelsToBeats * (lowerBound - scrollStartY)
        )
      }
      return Math.min(
        this.getVisualBeat() + Options.chart.maxDrawBeats,
        scrollBeat + pixelsToBeats * (scrollStartY - upperBound)
      )
    }
    if (!Options.chart.CMod)
      return Math.min(
        this.getVisualBeat() + Options.chart.maxDrawBeats,
        this.getBeatFromYPos(this.getLowerBound())
      )
    return this.getBeatFromYPos(this.getLowerBound())
  }

  /**
   * Returns the minimum y position to render
   *
   * @return {*}  {number}
   * @memberof ChartRenderer
   */
  getUpperBound(): number {
    return -32 - this.y / Options.chart.zoom
  }

  /**
   * Tests if an object is in the selection sprite.
   *
   * @param {Container} object
   * @return {*}  {boolean}
   * @memberof ChartRenderer
   */
  selectionTest(object: Container): boolean {
    if (!this.selectionBounds) return false
    const ab = this.selectionBoundary.getBounds()
    const bb = object.getBounds()
    const margin = 16 * Options.chart.zoom
    return (
      ab.x + ab.width > bb.x + margin &&
      ab.x < bb.x + bb.width - margin &&
      ab.y + ab.height > bb.y + margin &&
      ab.y < bb.y + bb.height - margin
    )
  }

  /**
   * Adds the selection and drag handlers to this object. Call this function when creating a new note object.
   *
   * @param {DisplayObject} object
   * @param {NotedataEntry} notedata
   * @memberof ChartRenderer
   */
  registerDragNote(object: DisplayObject, notedata: NotedataEntry) {
    object.eventMode = "static"
    object.removeAllListeners()
    let lastTriedColumnShift = 0
    let initalPosX = 0
    let initalPosY = 0
    let dragYOffset = 0
    let movedNote: NotedataEntry | undefined

    const moveHandler = (event: FederatedMouseEvent) => {
      const note = movedNote!
      const position = this.toLocal(event.global)
      if (
        Math.abs(position.y - initalPosY) ** 2 +
          Math.abs(position.x - initalPosX) ** 2 <
        32 * 32
      ) {
        if (this.chartManager.selection.shift) {
          this.chartManager.selection.shift = {
            columnShift: 0,
            beatShift: 0,
          }
        }
        return
      }
      const newBeat = this.getBeatFromYPos(position.y - dragYOffset)
      const snap = Options.chart.snap == 0 ? 1 / 48 : Options.chart.snap
      let snapBeat = Math.round(newBeat / snap) * snap
      if (Math.abs(snapBeat - newBeat) > Math.abs(newBeat - note.beat)) {
        snapBeat = note.beat
      }
      const col = Math.round((position.x + 96) / 64)
      this.chartManager.selection.shift ||= {
        columnShift: 0,
        beatShift: 0,
      }
      if (lastTriedColumnShift != col - note.col) {
        lastTriedColumnShift = col - note.col
        if (
          this.chartManager.selection.notes.every(note => {
            const newCol = note.col + lastTriedColumnShift
            return (
              newCol >= 0 &&
              newCol < this.chartManager.loadedChart!.gameType.numCols
            )
          })
        ) {
          this.chartManager.selection.shift.columnShift = col - note.col
        }
      }
      this.chartManager.selection.shift.beatShift = Math.max(
        -Math.min(...this.chartManager.selection.notes.map(note => note.beat)),
        snapBeat - note.beat
      )
    }
    object.on("pointerdown", event => {
      if (isRightClick(event)) {
        if (!this.chartManager.selection.notes.includes(notedata)) {
          this.chartManager.clearSelections()
          this.chartManager.addNoteToSelection(notedata)
        }
        ContextMenuPopup.open(this.chartManager.app, event)
        event.preventDefault()
        return
      }
      if (
        Options.general.mousePlacement &&
        !event.getModifierState("Meta") &&
        !event.getModifierState("Control") &&
        !event.getModifierState("Shift") &&
        !this.chartManager.selection.notes.includes(notedata)
      )
        return
      event.stopImmediatePropagation()
      if (this.chartManager.selection.notes.includes(notedata)) {
        if (event.getModifierState("Control") || event.getModifierState("Meta"))
          this.chartManager.removeNoteFromSelection(notedata)
      } else {
        if (
          !event.getModifierState("Control") &&
          !event.getModifierState("Meta") &&
          !event.getModifierState("Shift")
        ) {
          this.chartManager.clearSelections()
        }
        this.chartManager.addNoteToSelection(notedata)
      }
      initalPosX = object.x!
      initalPosY = object.y!
      dragYOffset = this.toLocal(event.global).y - object.y
      movedNote = notedata
      this.on("pointermove", moveHandler)
      const mouseUp = () => {
        this.off("pointermove", moveHandler)
        this.off("pointerup", mouseUp)
        object.visible = true
        if (
          (this.chartManager.selection.shift?.beatShift ?? 0) != 0 ||
          (this.chartManager.selection.shift?.columnShift ?? 0) != 0
        )
          this.chartManager.modifySelection(note => {
            note.beat += this.chartManager.selection.shift!.beatShift
            note.col += this.chartManager.selection.shift!.columnShift
            return note
          })
        this.chartManager.selection.shift = undefined
      }
      this.on("pointerup", mouseUp)
    })
    object.on("destroyed", () => {
      object?.removeAllListeners()
    })
  }

  getNotefield() {
    return this.notefield
  }

  getSelectionBounds() {
    return this.selectionBounds
  }
}
