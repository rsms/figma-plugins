import { Msg, ClosePluginMsg, UpdateUIMsg, UpdateGraphMsg, ResponseMsg, ErrorMsg } from "./structs"
import { Editor } from "./editor"
import { addKeyEventHandler } from "./util"

// declare function Viz(dotSource :string, outputFormat :string)

// graphviz module
type GVFormat = "svg" | "dot" | "json" | "dot_json" | "xdot_json";
type GVEngine = "circo" | "dot" | "fdp" | "neato" | "osage" | "patchwork" | "twopi";
const graphviz = window["graphviz"] as {
  layout(source :string, format? :GVFormat, engine? :GVEngine, timeout? :number) :Promise<string>
}


const isMac            = navigator.platform.indexOf("Mac") != -1
const genButton        = document.querySelector('button.gen')! as HTMLButtonElement
const playgroundButton = document.querySelector('button.playground')! as HTMLButtonElement
const demoButton       = document.querySelector('button.demo')! as HTMLButtonElement
const spinner          = document.querySelector('#spinner')! as HTMLDivElement
const editor           = new Editor(document.getElementById('dotcode')! as HTMLTextAreaElement)

// memory-only, since we can't use localStorage in plugins
let untitledSourceCode = editor.defaultText

// genButton labels
const genButtonLabelCreate = genButton.innerText
const genButtonLabelUpdate = "Update"
const genButtonLabelBusy = "Working"
let genButtonLabel = genButtonLabelCreate


const graphDefaults = (
  '  graph [fontname="Arial,Inter" bgcolor=transparent];\n' +
  '  node  [fontname="Arial,Inter"];\n' +
  '  edge  [fontname="Arial,Inter"];\n'
)


function wrapInGraphDirective(s :string) :string {
  return (
    'digraph G {\n' +
    graphDefaults +
    s +
    '\n}\n'
  )
}


async function makeViz(dotSource :string) :Promise<string> {
  let svg = ""
  let originalDotSource = dotSource

  let addedGraphDirective = false
  let m = dotSource.match(/\b(?:di)?graph(?:\s+[^\{]+|)[\r\n\s]*\{/)
  if (m) {
    // found graph directive -- add defaults
    let i = (m.index||0) + m[0].length
    dotSource = dotSource.substr(0, i) + "\n" + graphDefaults + dotSource.substr(i)
  } else {
    // no graph directive -- wrap & add defaults
    dotSource = wrapInGraphDirective(dotSource)
    addedGraphDirective = true
  }

  while (1) {
    try {
      // svg = Viz(dotSource, "svg")
      svg = await graphviz.layout(dotSource, "svg", "dot", 30000)
      break
    } catch (err) {
      if (err.message && (err.message+"").toLowerCase().indexOf("syntax error") != -1) {
        if (!addedGraphDirective) {
          // try and see if adding graph directive fixes it
          dotSource = wrapInGraphDirective(originalDotSource)
          addedGraphDirective = true
          dlog("makeViz retry with wrapped graph directive. New dotSource:\n" + dotSource)
        } else {
          throw new Error("malformed dot code")
        }
      } else {
        throw err
      }
    }
  }

  // clean up svg
  // <?xml version="1.0" encoding="UTF-8" standalone="no"?>
  // <!DOCTYPE svg PUBLIC ...>
  // <!-- comments -->
  // <title>...</title>
  // xmlns:xlink="http://www.w3.org/1999/xlink"
  // <polygon fill="white" stroke="white" ...>   (useless rectangle)
  svg = svg.replace(
    /<\?xml[^>]+\?>|<\!DOCTYPE[^>]+>|<\!--.*-->|xmlns:xlink="http:\/\/www.w3.org\/1999\/xlink\"/gm,
    ""
  )

  // remove comments and collapse linebreaks.
  // Note that none of the data generated actually has linebreaks, so this is safe.
  svg = svg.replace(/[\r\n]+/g, " ").replace(/<\!--.*-->/g, "").trim()

  // remove background rectangle
  svg = svg.replace(
    /^(<svg\s+[^>]+>\s*<g\s+[^>]+>)\s*<polygon\s+fill="#ffffff"\s+stroke="transparent"\s+points="[^"]+"\/>/,
    "$1"
  )

  // replace fontname
  svg = svg.replace(/"Arial,Inter"/g, '"Inter"')

  // scale?
  let scale = [1,1]
  m = dotSource.match(/(?:^|\n)\s*scale\s*=\s*([\d"',]+);?/im)
  if (m) {
    scale = m[1].replace(/[^\d\.]/g, " ").trim().split(" ").map(parseFloat)
    if (scale.length == 1) {
      scale[1] = scale[0]
    }
    // class="graph" transform="scale(1 1) rotate(0) translate(72 374)"
    let i = svg.indexOf('class="graph" transform="')
    if (i != -1) {
      i += 'class="graph" transform="'.length
      svg = svg.substr(0, i) + `scale(${scale[0]} ${scale[1]}) ` + svg.substr(i)
    }
  }

  // update size if scale != 1
  if (scale[0] != 1 || scale[1] != 1) {
    // extract width & height
    // <svg width="572pt" height="446pt"  viewBox="0.00 0.00 572.00 446.00"
    let width = 0, height = 0
    svg = svg.replace(
      /<svg\s+width="([\d\.]+)[^"]*"\s+height="([\d\.]+)[^"]*"\s+viewBox="([\d\.]+) ([\d\.]+) ([\d\.]+) ([\d\.]+)"/mi,
      (substr :string, ...m :string[]) => {
        let f = m.slice(0, 6).map(parseFloat)
        if (f.some(isNaN)) {
          return substr
        }
        width = Math.ceil(f[0] * scale[0])
        height = Math.ceil(f[1] * scale[1])
        return `<svg width="${width}" height="${height}" viewBox="${f[2]} ${f[3]} ${width} ${height}"`
      }
    )
  }

  // await new Promise<void>(r => setTimeout(r, 1000))
  // dlog(dotSource + "\n\n-> svg ->\n\n" + JSON.stringify(svg))

  return svg
}


let isGeneratingGraph = false
let generateAgainImmediately = false
let nextReqId = 0


async function genGraph() {
  if (isGeneratingGraph) {
    generateAgainImmediately = true
    return
  }
  print(`graphviz start`)

  isGeneratingGraph = true
  let reqId = nextReqId++

  // Add active class to spinner, which is set to appear after a 400ms delay,
  // meaning that if we finish within that delay, the user never sees the spinner.
  spinner.classList.add("active")

  try {
    let timeStarted = Date.now()
    let sourceCode = editor.text
    let svgCode = await makeViz(sourceCode)
    sendmsg<UpdateGraphMsg>({
      type: 'update-graph',
      reqId,
      svgCode,
      sourceCode,
      forceInsertNew: false,
    })
    print(`graphviz layout completed in ${(Date.now()-timeStarted).toFixed(0)}ms`)
    await awaitResponse(reqId)
    print(`graphviz finished in ${(Date.now()-timeStarted).toFixed(0)}ms`)
  } catch (err) {
    sendmsg<ErrorMsg>({
      type: "error",
      error: err.message,
    })
  }

  spinner.classList.remove("active")
  isGeneratingGraph = false

  // was a request made to genGraph while we were working?
  // if so, schedule a call to genGraph ASAP.
  if (generateAgainImmediately) {
    generateAgainImmediately = false
    setTimeout(genGraph, 1)
  }
}


interface PromiseResolver {
  resolve :()=>void
  reject  :(e:any)=>void
}
let waitingForResponses = new Map<number,PromiseResolver>()


function awaitResponse(reqId :number) {
  if (waitingForResponses.has(reqId)) {
    throw new Error(`duplicate reqId ${reqId}`)
  }
  return new Promise<void>((resolve, reject) => {
    waitingForResponses.set(reqId, {resolve, reject})
  })
}


function resolveResponse(msg :ResponseMsg) {
  let pr = waitingForResponses.get(msg.reqId)
  if (!pr) {
    console.warn(`resolveResponse did not find entry for reqId ${msg.reqId}`)
    return
  }
  waitingForResponses.delete(msg.reqId)
  if (msg.error) {
    pr.reject(new Error(msg.error))
  } else {
    pr.resolve()
  }
}


function updateGenButton(label? :string) {
  if (label) {
    genButtonLabel = label
  }
  genButton.innerText = genButton.disabled ? genButtonLabelBusy : genButtonLabel
}


function onUpdateUI(msg :UpdateUIMsg) {
  // called by the plugin when the selection changes
  if (msg.nodeId) {
    // selection is an existing graph
    updateGenButton(genButtonLabelUpdate)
    editor.text = msg.sourceCode
  } else {
    updateGenButton(genButtonLabelCreate)
    editor.text = loadUntitledSourceCode()
  }
  // for now, avoid focusing as it steals inputs from interacting with Figma canvas
  // editor.focus()
}


function loadUntitledSourceCode() :string {
  return untitledSourceCode
}

function saveUntitledSourceCode(source :string) {
  untitledSourceCode = source
}


function sendmsg<T extends Msg>(msg :T) {
  // send message to plugin
  parent.postMessage({ pluginMessage: msg }, '*')
}


function closePlugin() {
  sendmsg<ClosePluginMsg>({ type: "close-plugin" })
}


function setupEventHandlers() {
  document.addEventListener("focus", ev => {
    if (ev.target !== editor.ta) {
      // requestAnimationFrame(() => editor.focus())
      ev.stopPropagation()
      ev.preventDefault()
      editor.focus()
    }
  }, {passive:false,capture:true})

  // handle ESC-ESC to close
  let lastEscapeKeypress = 0

  // escapeToCloseThreshold
  // When ESC is pressed at least twice within this time window, the plugin closes.
  const escapeToCloseThreshold = 150

  addKeyEventHandler(window, (ev :KeyboardEvent, key :string) => {
    if ((ev.metaKey || ev.ctrlKey) && key == "Enter") {
      // meta-return: generate graph
      genGraph()
      return true
    } else if (key == "Escape") {
      // ESC-ESC: close plugin
      if (!ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) {
        if (ev.timeStamp - lastEscapeKeypress <= escapeToCloseThreshold) {
          closePlugin()
          return true
        }
        lastEscapeKeypress = ev.timeStamp
      }
    } else if (!DEBUG && (ev.keyCode == 80 /*P*/ && (ev.metaKey || ev.ctrlKey) && ev.altKey)) {
      // meta-alt-P: close plugin
      closePlugin()
      return true
    }
    return false
  })
}


function main() {

  // toolbar buttons
  genButton.onclick = () => { genGraph() }
  genButton.title = isMac ? "⌘↩" : "Ctrl+Return"
  playgroundButton.onclick = () => {
    window.open("https://rsms.me/graphviz/?source=" + encodeURIComponent(editor.text))
  }
  demoButton.onclick = () => {
    window.open("https://www.figma.com/file/j0LbONPTHzDEhJWZBNNP3D/Graphviz-examples/duplicate")
  }

  // [debug] Test the spinner UI
  // setTimeout(() => {
  //   spinner.classList.add("active")
  //   setTimeout(() => {
  //     spinner.classList.remove("active")
  //   },10000)
  // }, 100)

  // event handlers
  setupEventHandlers()

  // message handlers
  window.onmessage = ev => {
    let msg = ev.data
    if (msg && typeof msg == "object" && msg.pluginMessage) {
      msg = msg.pluginMessage
      switch (msg.type) {

      case "update-ui":
        onUpdateUI(msg as UpdateUIMsg)
        break

      case "response":
        resolveResponse(msg as ResponseMsg)
        break

      default:
        print(`ui received unexpected message`, msg)
        break
      }
    }
  }

  editor.init()
  // document.body.appendChild(parseHtml<SVGElement>(svgCode))
}



main()
