import { Msg, UpdateUIMsg, UpdateGraphMsg, ErrorMsg } from "./structs"


// TODO:
// on startup and on selection change:
// - getPluginData("viz.source")
// - if there's source, send message to UI
// - have UI update the source
//
// Need to figure out how to not have source disappear if the user enters some source
// and then clicks on a graph on the canvas.
// - idea: textarea.oninput => store value in localStorage,
//         when there's no graph selected: textarea.value = get localStorage.
//

function importGraphSvg(svg :string) :FrameNode {
  let n = figma.createNodeFromSvg(svg)
  // TODO: ungroup the single group child of n
  // // expect a single child: a group ("graph1")
  // if (n.children.length == 1 && n.children[0].type == "GROUP") {
  //   let g = n.children[0] as FrameNode & { type: "GROUP" }
  //   UNGROUP
  // }
  return n
}


class GraphFrame {
  n          :FrameNode
  sourceCode :string

  constructor(n :FrameNode, sourceCode :string) {
    this.n          = n
    this.sourceCode = sourceCode
  }

  update(msg :UpdateGraphMsg) {
    // For now, replace all.
    //
    // We could do something more efficient and more useful here.
    // - derive a hash for each part of the svg (could be done in UI with parseHtml)
    // - store hash using PluginData on generated nodes
    // - skip nodes with identical hash
    //

    // "import" SVG
    let n = importGraphSvg(msg.svgCode)

    // remove contents of existing frame
    this.n.children.map(c => c.remove())

    // update size of frame to match new size
    this.n.resizeWithoutConstraints(n.width, n.height)

    // add contents of newly imported SVG
    for (let c of n.children) {
      this.n.appendChild(c)
    }

    // remove now-empty frame
    n.remove()

    // update viz source code
    this.n.setPluginData("viz.source", msg.sourceCode)
  }

  toString() {
    return `GraphFrame(n.id=${this.n.id})`
  }
}


// currently selected graph frame
let selGraphFrame :GraphFrame|null = null


function setSelectedGraphFrame(gf :GraphFrame|null) {
  if (selGraphFrame !== gf) {
    // dlog(`set selGraphFrame ${selGraphFrame} -> ${gf}`)
    selGraphFrame = gf
    sendmsg<UpdateUIMsg>({
      type: "update-ui",
      nodeId: selGraphFrame ? selGraphFrame.n.id : "",
      sourceCode: selGraphFrame ? selGraphFrame.sourceCode : ""
    })
  }
}


function updateSelectedGraphFrame() {
  if (figma.currentPage.selection.length == 1) {
    let n = figma.currentPage.selection[0]
    if (selGraphFrame && selGraphFrame.n === n) {
      // already selected
      return
    }
    if (n.type == "FRAME") {
      let sourceCode = n.getPluginData("viz.source")
      if (sourceCode) {
        setSelectedGraphFrame(new GraphFrame(n, sourceCode))
        return
      }
    }
  }
  setSelectedGraphFrame(null)
}


function createNewGraph(msg :UpdateGraphMsg) {
  let n = importGraphSvg(msg.svgCode)
  n.name = "Graph"

  let vp = figma.viewport.center
  n.x = vp.x
  n.y = vp.y

  let sourceCode = msg.sourceCode
  n.setPluginData("viz.source", sourceCode)

  figma.currentPage.appendChild(n)
  figma.currentPage.selection = [ n ]

  setSelectedGraphFrame(new GraphFrame(n, sourceCode))
}


function onUpdateGraph(msg :UpdateGraphMsg) {
  if (!msg.forceInsertNew && selGraphFrame) {
    selGraphFrame.update(msg)
  } else {
    createNewGraph(msg)
  }
  if (msg.closeWhenDone) {
    figma.closePlugin()
  }
}


function onUIError(msg :ErrorMsg) {
  figma.notify(msg.error)
}


function sendmsg<T extends Msg>(msg :T) {
  // send message to ui
  figma.ui.postMessage(msg)
}


function main() {
  figma.showUI(__html__, {
    width: 440,
    height: 700,
    position: "last",
  })

  figma.ui.onmessage = msg => {
    switch (msg.type) {

    case "update-graph":
      onUpdateGraph(msg as UpdateGraphMsg)
      break

    case "error":
      onUIError(msg as ErrorMsg)
      break

    case "close-plugin":
      figma.closePlugin()
      break

    default:
      console.warn(`plugin received unexpected message`, msg)
      break
    }
  }

  figma.on("selectionchange", updateSelectedGraphFrame)

  // initial check
  updateSelectedGraphFrame()
}


main()
