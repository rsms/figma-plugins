import {
  Msg,
  MapUpdateMsg,
  SetViewportMsg,
  UpdateViewportMsg,
  FocusNodesMsg,

  NodeInfo,
  CanvasBounds,
  Viewport,
  Point,
  Size,
  Rect,
  Matrix2D,
} from "./structs"

const hasPointerEvents = typeof PointerEvent != "undefined"
const captureEvent = {passive:false,capture:true}
const ZeroPoint :Point = {x:0,y:0}

// Viewport size approximation based on window size and known Figma UI elements
const figmaSidebarWidth = 240      // not perfect; left sidebar is resizeable
const figmaToolbarHeight = 40      // height of toolbar
const figmaDesktopAppYChrome = 40  // height of figma desktop app vertical chrome
const browserYChrome = 48    // guesstimate of vertical browser chrome
const chromeWidth = figmaSidebarWidth * 2
const chromeHeight = (
  figmaToolbarHeight +
  (navigator.userAgent.indexOf("Figma") == -1 ? browserYChrome : figmaDesktopAppYChrome)
)

// moveThreshold
// When the user's pointer has moved at least this far since pointerdown
// (measured in euclidean distance) the pointer session is considered to be a move
// and the viewport will start to move along with the pointer.
const moveThreshold = 2.5 //dp

// doubleClickTimeThreshold
// When the time between two pointerdown events is smaller or equal to this duration,
// and there was no pointer movement according to moveThreshold, then the pointerdown
// event is considered a "double click".
const doubleClickTimeThreshold = 200 //ms

// const $ = (q :string, el? :HTMLElement) :HTMLElement|null =>
//   (el || document).querySelector(q)

// const $$ = (q :string, el? :HTMLElement) :HTMLElement[] => {
//   let o = (el || document).querySelectorAll(q)
//   ;(o as any).__proto__ = Array.prototype
//   return o as any as HTMLElement[]
// }


const map = new class {
  el         :HTMLDivElement
  rectsEl    :HTMLDivElement
  viewportEl :HTMLDivElement
  infoEl     :HTMLDivElement
  zoomInfoEl :HTMLDivElement

  // map
  width      :int  // current map width in dps (map space)
  height     :int  // current map height in dps (map space)
  maxWidth   :int  // max map width in dps (map space)
  maxHeight  :int  // max map height in dps (map space)
  mapOffsetX :int = 0  // dp offset in DOM document
  mapOffsetY :int = 0  // dp offset in DOM document
  paddingX   :int = 8 // horizontal map padding (in map space)
  paddingY   :int = 8 // vertical map padding (in map space)
  viewport   :Rect = {x:0,y:0,width:0,height:0} // current viewport in map space
  nodes      :NodeInfo[] = []  // current nodes displayed in map

  // canvas
  minX       :int = 0  // min X value of canvas
  minY       :int = 0  // min Y value of canvas
  scaleX     :int = 0  // scale of canvas
  scaleY     :int = 0  // scale of canvas

  // pointer tracking
  pdownTime  :number = 0  // timestamp of last pointerdown event
  pdownPos   = ZeroPoint  // position of last pointerdown event
  isMoving   = false      // true after viewport has been moved beyond move-vs-click threshold

  // etc
  pxRatio    :int = 1 // copy of window.devicePixelRatio

  constructor() {
    this.el = document.getElementById("map") as HTMLDivElement
    this.rectsEl = this.el.querySelector(".rects") as HTMLDivElement
    this.viewportEl = this.el.querySelector(".viewport") as HTMLDivElement
    this.infoEl = document.getElementById("info") as HTMLDivElement
    this.zoomInfoEl = this.infoEl.querySelector(".zoom") as HTMLDivElement
    this.width  = this.maxWidth = this.el.clientWidth - this.paddingX * 2
    this.height = this.maxHeight = this.el.clientHeight - this.paddingY * 2
    this.el.classList.remove("init")

    if (hasPointerEvents) {
      document.addEventListener("pointerdown", this.onPointerDown, captureEvent)
      document.addEventListener("pointerup", this.onPointerUp, captureEvent)
    } else {
      // Note: Safari <=12 (ships with macOS 10.14) does not have pointer events.
      // Pointer events arrived in Safari 13 (macOS 10.15).
      document.addEventListener("mousedown", this.onPointerDown, captureEvent)
      document.addEventListener("mouseup", this.onPointerUp, captureEvent)
    }
  }

  // rectToMapSpace converts a rect that is in canvas space to map space
  //
  rectToMapSpace(r :Rect) :Rect {
    const m = this
    return {
      x:      m.px(m.width  * ((r.x - m.minX) / m.scaleX)),
      y:      m.px(m.height * ((r.y - m.minY) / m.scaleY)),
      width:  m.px(m.width  * (r.width / m.scaleX)),
      height: m.px(m.height * (r.height / m.scaleY)),
    }
  }

  // pointToMapSpace converts a point that is in canvas space to map space
  //
  pointToMapSpace(p :Point) :Point {
    const m = this
    return {
      x: m.px(m.width  * ((p.x - m.minX) / m.scaleX)),
      y: m.px(m.height * ((p.y - m.minY) / m.scaleY)),
    }
  }

  // sizeToMapSpace converts two lengths in canvas space to map space
  sizeToMapSpace(s :Size) :Size {
    const m = this
    return {
      width:  m.px(m.width  * (s.width / m.scaleX)),
      height: m.px(m.height * (s.height / m.scaleY)),
    }
  }

  // pointToCanvasSpace converts a point that is in map space to canvas space
  //
  pointToCanvasSpace(p :Point) :Point {
    const m = this
    return {
      x: ((p.x / m.width) * m.scaleX) + m.minX,
      y: ((p.y / m.height) * m.scaleY) + m.minY,
    }
  }

  // moves the viewport visualization (but does not send messages to plugin)
  // returns the center point in map space
  //
  moveViewportFromPointerEvent(ev :PointerEvent) :Point {
    const m = this
    // convert document coordinates to map space
    let p = {
      x: Math.min(m.width, Math.max(0, ev.clientX - m.mapOffsetX)),
      y: Math.min(m.height, Math.max(0, ev.clientY - m.mapOffsetY)),
    }
    m.moveViewport(
      p.x - m.viewport.width / 2,
      p.y - m.viewport.height / 2,
    )
    return p
  }

  timeLastSetFigmaViewport :int = 0

  onPointerDown = (ev :PointerEvent) => {
    // dlog("onPointerDown", ev)
    const m = this
    ev.preventDefault()
    ev.stopPropagation()

    let wasMoving = m.isMoving
    m.isMoving = false

    // is double-click?
    if (!wasMoving && ev.timeStamp - m.pdownTime <= doubleClickTimeThreshold) {
      // treat as double-click
      m.onDoubleClick(ev)
      return
    }

    m.pdownTime = ev.timeStamp
    m.pdownPos = { x: ev.clientX, y: ev.clientY }

    if (hasPointerEvents) {
      document.body.onpointermove = m.onPointerMove
      document.body.setPointerCapture(ev.pointerId)
    } else {
      document.body.onmousemove = m.onPointerMove
      document.body.onmouseup = m.onPointerUp
    }
    let p = m.moveViewportFromPointerEvent(ev)
    m.setFigmaViewport(p, ev.timeStamp)
  }

  onPointerMove = (ev :PointerEvent) => {
    // dlog("onPointerMove", ev)
    const m = this
    if (!m.isMoving) {
      let d = Math.abs(distance(m.pdownPos, { x: ev.clientX, y: ev.clientY }))
      if (d < moveThreshold) {
        return
      }
      m.isMoving = true
    }
    let p = m.moveViewportFromPointerEvent(ev)
    m.setFigmaViewport(p, ev.timeStamp)
  }

  onPointerUp = (ev :PointerEvent) => {
    // dlog("onPointerUp", ev)
    const m = this
    if (hasPointerEvents) {
      document.body.onpointermove = null
      document.body.releasePointerCapture(ev.pointerId)
    } else {
      document.body.onmousemove = null
      document.body.onmouseup = null
    }
    if (m.isMoving) {
      let p = m.moveViewportFromPointerEvent(ev)
      m.setFigmaViewport(p, ev.timeStamp)
    }
  }

  onDoubleClick = (ev :PointerEvent) => {
    let el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement
    let nodeId = el && el.dataset ? el.dataset.nodeId : ""
    dlog("onDoubleClick", el, { nodeId })
    sendToPlugin<FocusNodesMsg>({ type: "focus-nodes", nodeIds: nodeId ? [ nodeId ] : [] })
  }


  // setFigmaViewport sends a message to the plugin to set the viewport in Figma.
  // p is in map space
  //
  setFigmaViewport(p :Point, timestamp? :int) {
    const m = this
    // send message to plugin to change viewport
    sendToPlugin<SetViewportMsg>({
      type: "set-viewport",
      position: m.pointToCanvasSpace(p),
    })
    if (timestamp) {
      m.timeLastSetFigmaViewport = timestamp
    }
  }


  px(n :number) :number {
    return Math.round(n * this.pxRatio) / this.pxRatio
  }

  updateMapSize(aspectRatio :number) {
    const m = this
    if (aspectRatio > 1) { // landscape
      m.width  = m.px(m.maxWidth)
      m.height = m.px(m.width / aspectRatio)
    } else { // portrait or square
      m.width  = m.px(m.height * aspectRatio)
      m.height = m.px(m.maxHeight)
    }
    m.el.style.width = m.width + "px"
    m.el.style.height = m.height + "px"
    let r = m.el.getBoundingClientRect()
    m.mapOffsetX = r.left
    m.mapOffsetY = r.top
  }

  // x and y should be in map space
  moveViewport(x :int, y :int) {
    const m = this
    m.viewportEl.style.transform = `translate(${x}px, ${y}px)`
    m.viewport.x = x
    m.viewport.y = y
  }

  updateViewport(vp :Viewport) {
    const m = this

    let z = vp.zoom
    let ww = (window.outerWidth - chromeWidth) / z
    let wh = (window.outerHeight - chromeHeight) / z

    let r = m.rectToMapSpace({
      x: vp.x - ww/2,
      y: vp.y - wh/2,
      width: ww,
      height: wh,
    })

    let s = m.viewportEl.style
    s.width = r.width + "px"
    s.height = r.height + "px"
    m.viewport.width = r.width
    m.viewport.height = r.height

    // clamp viewport to map
    // TODO: do something more fun here when the viewport is outside the canvas bounds,
    // like draw a line at the edge or something.
    let halfViewportWidth = r.width / 2
    let halfViewportHeight = r.height / 2
    let x = Math.min(m.width - halfViewportWidth, Math.max(-halfViewportWidth, r.x))
    let y = Math.min(m.height - halfViewportHeight, Math.max(-halfViewportHeight, r.y))

    m.moveViewport(x, y)

    this.zoomInfoEl.innerText = `${(vp.zoom*100).toFixed(0)}%`
  }


  updateCanvasBounds(canvas :CanvasBounds) {
    const m = this

    // update pxRatio (if window moved to a different display or display scale changed)
    m.pxRatio = window.devicePixelRatio || 1

    // note: canvas.width and .height represent maxX and maxY (not width and height)
    m.minX = canvas.minX
    m.minY = canvas.minY
    m.scaleX = canvas.maxX - m.minX
    m.scaleY = canvas.maxY - m.minY

    let aspectRatio = m.scaleX / m.scaleY
    // dlog({ aspectRatio, scaleX: m.scaleX, scaleY: m.scaleY })
    m.updateMapSize(aspectRatio)
  }


  update(msg :MapUpdateMsg) {
    const m = this

    m.updateCanvasBounds(msg.canvas)
    m.updateViewport(msg.viewport)
    m.nodes = msg.nodes

    // let intervals :[number,NodeInfo[]][] = []
    // for (let n of m.nodes) {
    // }

    m.el.style.visibility = "hidden"
    try {
      m.rectsEl.innerText = ""

      for (let n of m.nodes) {
        let nel = document.createElement("div")
        nel.className = "node"
        nel.dataset.nodeId = n.nodeId

        if (n.selected) {
          nel.classList.add("selected")
          nel.classList.add(n.selected)
        }

        let s = nel.style
        let size = m.sizeToMapSpace(n)
        s.width = `${size.width}px`
        s.height = `${size.height}px`

        let t = n.transform
        // t here is a flat version of Figma.Transform which is ordered like this:
        //   [ a, b, c, d, tx, ty ]
        // ID is:
        //   [ 1, 0, 0, 1, 0, 0 ]
        // Rotation matrix:
        //   [cos(a) sin(a) -sin(a) cos(a) 0 0]  // a = angle
        // This format matches the CSS matrix() function.
        //

        // scale x and y to map space
        let tr = m.pointToMapSpace({ x: t[4], y: t[5] })
        let [ a, b, c, d ] = t
        s.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${tr.x}, ${tr.y})`

        if (n.name &&
            size.width > 16 &&
            size.height > 10 &&
            ((a == 1 && d == 1) || !maybeMirrored(t))
        ) {
          let label = document.createElement("div")
          label.className = "label"
          label.innerText = n.name
          nel.appendChild(label)
        }

        m.rectsEl.appendChild(nel)
      }

    } finally {
      m.el.style.visibility = null
    }
  }

}



// maybeMirrored returns false if transformation t is _definitely_ not rotated.
// However, it returns true if t _might_ be mirrored.
//
// Note: I'm not sure how to decompose a matrix perfectly, but for the purpose of what we need
// this for (labeling), it is enough.
//
function maybeMirrored(t :Matrix2D) :bool {
  const skewX = -Math.atan2(-t[2], t[3])
  const skewY = Math.atan2(t[1], t[0])
  const delta = Math.abs(skewX + skewY)
  return !(delta < 0.00001 || Math.abs(Math.PI * 2 - delta) < 0.00001)
}


function distance(p1 :Point, p2 :Point) :number {
  let x = p1.x - p2.x
  let y = p1.y - p2.y
  return Math.sqrt(x*x + y*y)
}


function sendToPlugin<M extends Msg>(msg :M) {
  parent.postMessage({ pluginMessage: msg }, '*')
}


// measureFPS uses requestAnimationFrame to measure frame times and reports
// the average frames per second.
//
function measureFPS(report :(fps:number)=>void) {
  const samplesSize = 120       // total number of frame times look at (window size)
  const samples :number[] = []  // ring buffer; sliding window
  const reportAt = Math.round(samplesSize / 4)

  let samplesIndex = 0  // next index in samples
  let prevTime = 0      // last time value; frameTime = prevTime - time

  const maxMissedReports = 2
  const reportTimeMissThreshold = (reportAt/60) * maxMissedReports * 1000
  let lastReportTime = 0
  // When a tab goes idle, this function is not called for a while.
  // Then when the tab goes active, it's called with a huge time delta, pulling down the
  // FPS considerably. To counter for this, we record the real time when we report.
  // Before we make a report, we look to see if we missed more than maxMissedReports reports,
  // and if so, we reset and start over.

  const sample = (time :number) => {
    samples[samplesIndex++] = time - prevTime
    prevTime = time
    if (samples.length == samplesSize) {
      if (samplesIndex == samplesSize) {
        samplesIndex = 0
      }
      if (samplesIndex % reportAt == 0) {
        // report
        let now = Date.now()
        if (lastReportTime != 0 && now - lastReportTime > reportTimeMissThreshold) {
          // tab went idle for a while and missed some reports. Reset.
          samples.length = 0
          lastReportTime = 0
          samplesIndex = 0
        } else {
          lastReportTime = now
          let avgFrameTime = samples.reduce((v, a) => a + v) / samplesSize
          report(1000/avgFrameTime)
        }
      }
    }
    requestAnimationFrame(sample)
  }
  requestAnimationFrame(time => {
    prevTime = time
    requestAnimationFrame(sample)
  })
}


function main() {
  if (DEBUG) {
    // Note: Even though this could be nice in production, it burns CPU at a steady rate
    // which is not great. So, for now, just enable the FPS meter in debug builds.
    let fpsEl = document.createElement("div")
    fpsEl.className = "fps"
    map.infoEl.insertBefore(fpsEl, map.infoEl.firstChild)
    fpsEl.innerText = "∞ FPS"
    measureFPS(fps => {
      fpsEl.innerText = (fps > 0 ? fps.toFixed(0) : parseFloat(fps.toFixed(2))) + " FPS"
    })
  }

  window.onmessage = ev => {
    let msg = ev.data.pluginMessage as Msg
    assert(typeof msg.type == "string")
    switch (msg.type as string) {

    case "map/update":
      map.update(msg as MapUpdateMsg)
      break

    case "update-viewport":
      map.updateViewport((msg as UpdateViewportMsg).viewport)
      break

    default:
      print(`[ui] got unexpected message`, msg)
    }
  }
}


main()
