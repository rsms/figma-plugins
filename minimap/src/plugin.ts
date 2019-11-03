import { isSceneNode, visit } from "./figutil"
import {
  Msg,
  MapUpdateMsg,
  SetViewportMsg,
  UpdateViewportMsg,
  FocusNodesMsg,

  CanvasBounds,
  NodeInfo,
  Viewport,
  Rect,
  Matrix2D,
} from "./structs"


let isUpdatingMap = false
let updateMapTimer :any = null

// cache of figma.currentPage.selection. Maps to absolute rect (canvas space)
let selectedNodes = new Map<SceneNode,NodeInfo>()

// timestamp (Date.now) of last update
let updateSelectedNodesTimestamp = 0

// max age of selectedNodes data to consider fresh
let maxSelectedNodesAge = 1000

// viewport info last sent to UI
let viewport :Viewport = {
  x: Infinity,
  y: Infinity,
  zoom: 0,
}

// length of longest "bounding edge" of canvas
let canvasSize = 0


let viewportSetSignal = false  // set to true when viewport was updated by us


function checkViewportChanged() :bool {
  let vp = figma.viewport
  let x = vp.center.x
  let y = vp.center.y
  if (x == viewport.x && y == viewport.y && vp.zoom == viewport.zoom) {
    return false
  }
  viewport.x = x
  viewport.y = y
  viewport.zoom = vp.zoom
  return true
}


const idleViewportPollTime = 500
let viewportPollTime = 0


function sendViewportIfChanged() :bool {
  return (
    checkViewportChanged() &&
    (sendToUI<UpdateViewportMsg>({
      type: "update-viewport",
      viewport,
    }),
    true)
  )
}


function pollViewport() {
  if (sendViewportIfChanged()) {
    if (viewportPollTime == 0) {
      // initial check
      viewportPollTime = idleViewportPollTime
    } else if (viewportSetSignal) {
      // viewport was set by user in the plugin UI.
      // Don't reset poll time, but clear signal instead.
      viewportSetSignal = false
    } else {
      viewportPollTime = 1
    }
  } else {
    // back off slowly
    // This way we stay responsive when the user is actively moving the viewport
    // but without burning CPU when the viewport stays unchanged.
    viewportPollTime = Math.min(idleViewportPollTime, viewportPollTime * 1.1)
  }
  setTimeout(pollViewport, viewportPollTime)
}


let updateMapAgainImmediately = false


async function initCanvasSize() {
  let canvas :CanvasBounds = { minX:Infinity, minY:Infinity, maxX:-Infinity, maxY:-Infinity }
  await forEachTopLevelNode(n => {
    let t = getAbsoluteTransform(n)
    let tx = t[4], ty = t[5]
    canvas.minX = Math.min(canvas.minX, tx)
    canvas.minY = Math.min(canvas.minY, ty)
    canvas.maxX = Math.max(canvas.maxX, tx + n.width)
    canvas.maxY = Math.max(canvas.maxY, ty + n.height)
  })
  canvasSize = Math.max(canvas.maxX - canvas.minX, canvas.maxY - canvas.minY)
}


async function forEachTopLevelNode(f :(n:SceneNode)=>void) {
  return visit(figma.currentPage, 10, n => {
    if ((n as any).visible && isSceneNode(n)) {
      f(n)
    }
    return false // don't traverse children
  })
}


async function updateMap() {
  if (isUpdatingMap) {
    updateMapAgainImmediately = true
    return
  }
  let timeStarted = Date.now()
  isUpdatingMap = true
  clearTimeout(updateMapTimer)

  let canvas :CanvasBounds = { minX:Infinity, minY:Infinity, maxX:-Infinity, maxY:-Infinity }
  let nodes :NodeInfo[] = []

  if (Date.now() - updateSelectedNodesTimestamp > maxSelectedNodesAge) {
    updateSelectedNodes()
  }

  const updateCanvasBounds = (ni :NodeInfo) => {
    let tx = ni.transform[4], ty = ni.transform[5]
    canvas.minX = Math.min(canvas.minX, tx)
    canvas.minY = Math.min(canvas.minY, ty)
    canvas.maxX = Math.max(canvas.maxX, tx + ni.width)
    canvas.maxY = Math.max(canvas.maxY, ty + ni.height)
  }

  // add selected nodes
  for (let [n, ni] of selectedNodes) {
    nodes.push(ni)
    updateCanvasBounds(ni)
  }

  // add top-level nodes
  await forEachTopLevelNode(n => {
    if (!selectedNodes.has(n)) {
      let ni :NodeInfo = {
        nodeId: n.id,
        width: n.width,
        height: n.height,
        transform: getAbsoluteTransform(n),
        name: n.name,
      }
      nodes.push(ni)
      updateCanvasBounds(ni)
    }
  })

  // check viewport
  checkViewportChanged()

  // update canvasSize
  canvasSize = Math.max(canvas.maxX - canvas.minX, canvas.maxY - canvas.minY)

  sendToUI<MapUpdateMsg>({
    type: "map/update",
    nodes,
    canvas,
    viewport,
  })

  isUpdatingMap = false
  if (updateMapAgainImmediately) {
    updateMapAgainImmediately = false
    updateMapTimer = setTimeout(updateMap, 0)
  } else {
    let timeSpent = Date.now() - timeStarted
    // update every ~500ms, however when this function takes a long time,
    // bakc off for at least 100ms.
    updateMapTimer = setTimeout(updateMap, Math.max(100, 500 - timeSpent))
  }

  // updateWindowSize((canvas.maxX - canvas.minX) / (canvas.maxY - canvas.minY))
}


// let isLandscape = true

// function updateWindowSize(aspectRatio :number) {
//   if (aspectRatio > 1 != isLandscape) {
//     isLandscape = !isLandscape
//     if (isLandscape) {
//       dlog("change orientation to landscape")
//       figma.ui.resize(320, 240)
//     } else {
//       dlog("change orientation to portrait")
//       figma.ui.resize(240, 320)
//     }
//   }
// }


function getAbsoluteTransform(n :SceneNode) :Matrix2D {
  // Convert Figma.Transform to a flat vector
  // type Figma.Transform = [
  //   [a, c, tx],  //  [0][0]  [0][1]  [0][2]
  //   [b, d, ty],  //  [1][0]  [1][1]  [1][2]
  // ] -> [a b c d tx ty]
  // ID: [
  //   [1, 0, 0]
  //   [0, 1, 0]
  //   [0, 0, 1] <-- this row is implicit and not represented by Figma.Transform
  // ]
  //
  // dlog("rotation:", Math.round(Math.asin(t[0][1]) * (180/Math.PI)))
  // let t = (n as LayoutMixin).relativeTransform
  //
  let t = (n as LayoutMixin).absoluteTransform
  return (
    t ? [ t[0][0], t[1][0], t[0][1], t[1][1], t[0][2], t[1][2] ]
      : [ 1, 0, 0, 1, n.x, n.y ]
  )
}


function updateSelectedNodes() {
  selectedNodes.clear()
  const addNode = (
    n        :SceneNode,
    selected :"direct" | "indirect" | undefined,
    name     :string|undefined,
  ) => {
    selectedNodes.set(n, {
      nodeId: n.id,
      width: n.width,
      height: n.height,
      transform: getAbsoluteTransform(n),
      selected,
      name,
    })
  }
  for (let n of figma.currentPage.selection) {
    addNode(n, "direct", n.name)
    if (n.parent && n.parent.type != "PAGE") {
      // add top-level parent as well.
      // This helps in large files where a small thing might become tiny on the map.
      let parent = n.parent as SceneNode & ChildrenMixin
      let parentM = parent  // topmost parent with at least 2 children
      while (parent.parent && parent.parent.type != "PAGE") {
        parent = parent.parent as SceneNode & ChildrenMixin
        if (parent.children && parent.children.length > 1) {
          parentM = parent
        }
      }
      addNode(parent, "indirect", parent.name)
      // add siblings (first child with multiple nodes)
      // only include siblings which are larger than 0.5% of the canvas bounds.
      const minSize = canvasSize / 200
      for (let cn of parentM.children) {
        if (cn.width > minSize && cn.height > minSize && !selectedNodes.has(cn)) {
          // Note: Don't set name
          addNode(cn, undefined, undefined)
        }
      }
    }
  }
  updateSelectedNodesTimestamp = Date.now()
}


function setViewport(msg :SetViewportMsg) {
  viewportSetSignal = true  // signal that we set the viewport (to pollViewport)
  figma.viewport.center = msg.position
}


// function onZoomMessage(msg :ZoomMsg) {
//   switch (msg.what) {
//     case "+":
//       figma.viewport.zoom = figma.viewport.zoom * 1.5
//       break
//     case "-":
//       figma.viewport.zoom = figma.viewport.zoom * 0.5
//       break
//   }
// }


function onFocusNodes(msg :FocusNodesMsg) {
  if (msg.nodeIds.length == 0) {
    figma.viewport.zoom = 1
  } else {
    let nodes = msg.nodeIds.map(id =>
      figma.getNodeById(id)
    ).filter(n => !!n && isSceneNode(n)) as ReadonlyArray<SceneNode>
    figma.currentPage.selection = nodes
    // save viewport center
    let center = figma.viewport.center
    // make use of scrollAndZoomIntoView to set the most appropriate zoom level for nodes
    figma.viewport.scrollAndZoomIntoView(nodes)
    // restore viewport center
    figma.viewport.center = center
  }
  sendViewportIfChanged()
}


function sendToUI<M extends Msg>(msg :M) {
  figma.ui.postMessage(msg)
}


async function main() {
  figma.showUI(__html__, {
    width: 240,
    height: 240,
  })

  // figma.on("currentpagechange", () => {
  //   dlog("page changed")
  // })

  figma.on("selectionchange", () => {
    updateSelectedNodes()
    updateMap()
    // TODO: investigate why this ugly workaround is needed for when the canvas bounds changes
    // from creation of new stuff.
    setTimeout(updateMap, 1)
  })

  // compute canvas size initially
  await initCanvasSize()

  // update selected nodes
  updateSelectedNodes()

  // start map update loop
  updateMap()

  // viewport update loop
  pollViewport()

  figma.ui.onmessage = (msg :Msg) => {
    assert(msg.type, "message without type")
    switch (msg.type) {

    case "set-viewport":
      setViewport(msg as SetViewportMsg)
      break

    case "focus-nodes":
      onFocusNodes(msg as FocusNodesMsg)
      break

    default:
      print(`[plugin] got unexpected message`, msg)
    }
  }
}


main()
