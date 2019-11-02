import { Msg, ClosePluginMsg, UpdateUIMsg, UpdateGraphMsg, ErrorMsg } from "./structs"
import { Editor } from "./editor"
import { addKeyEventHandler } from "./util"

// declare function Viz(dotSource :string, outputFormat :string)

// graphviz module
type GVFormat = "svg" | "dot" | "json" | "dot_json" | "xdot_json";
type GVEngine = "circo" | "dot" | "fdp" | "neato" | "osage" | "patchwork" | "twopi";
const graphviz = window["graphviz"] as {
  layout(source :string, format? :GVFormat, engine? :GVEngine, timeout? :number) :Promise<string>
}


const isMac = navigator.platform.indexOf("Mac") != -1
const genButton = document.querySelector('button.gen')! as HTMLButtonElement
// const genCloseButton = document.querySelector('button.gen-and-close')! as HTMLButtonElement
const playgroundButton = document.querySelector('button.playground')! as HTMLButtonElement
const demoButton = document.querySelector('button.demo')! as HTMLButtonElement


let editor = new Editor(document.getElementById('dotcode')! as HTMLTextAreaElement)


function wrapInGraphDirective(s :string) :string {
  return (
    'digraph G {\n' +
    '  graph [fontname="Arial,Inter" bgcolor=transparent];\n' +
    '  node  [fontname="Arial,Inter"];\n' +
    '  edge  [fontname="Arial,Inter"];\n' +
    s +
    '\n}\n'
  )
}


async function makeViz(dotSource :string) :Promise<string> {
  let svg = ""

  let addedGraphDirective = false
  if (!dotSource.match(/\b(?:di)?graph(?:\s+[^\{]+|)*[\r\n\s]*\{/m)) {
    // definitely no graph type directive
    dotSource = wrapInGraphDirective(dotSource)
    addedGraphDirective = true
  } // else: probably digraph, but not sure.

  while (1) {
    try {
      // svg = Viz(dotSource, "svg")
      svg = await graphviz.layout(dotSource, "svg", "dot", 30000)
      break
    } catch (err) {
      if (err.message && (err.message+"").toLowerCase().indexOf("syntax error") != -1) {
        if (!addedGraphDirective) {
          // try and see if adding graph directive fixes it
          dotSource = wrapInGraphDirective(dotSource)
          addedGraphDirective = true
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
    /<\?xml[^>]+\?>|<\!DOCTYPE[^>]+>|<\!--.*-->|<title>[^<]*<\/title>|xmlns:xlink="http:\/\/www.w3.org\/1999\/xlink\"/gm,
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
  let m = dotSource.match(/(?:^|\n)\s*scale\s*=\s*([\d"',]+);?/im)
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

  // dlog(dotSource + "\n\n-> svg ->\n\n" + JSON.stringify(svg))

  return svg
}


let isGeneratingGraph = false

async function genGraph(closeWhenDone :bool) {
  if (isGeneratingGraph) {
    return
  }
  isGeneratingGraph = true
  try {
    let sourceCode = editor.text
    let svgCode = await makeViz(sourceCode)
    sendmsg<UpdateGraphMsg>({
      type: 'update-graph',
      svgCode,
      sourceCode,
      closeWhenDone,
      forceInsertNew: false,
    })
  } catch (err) {
    sendmsg<ErrorMsg>({
      type: "error",
      error: err.message,
    })
  } finally {
    isGeneratingGraph = false
  }
}


function onUpdateUI(msg :UpdateUIMsg) {
  // called by the plugin when the selection changes
  if (msg.nodeId) {
    // selection is an existing graph
    genButton.innerText = "Update"
    // genCloseButton.innerText = "Update & Close"
    editor.text = msg.sourceCode
  } else {
    genButton.innerText = "Create"
    // genCloseButton.innerText = "Create & Close"
    editor.text = loadUntitledSourceCode()
  }
  // for now, avoid focusing as it steals inputs from interacting with Figma canvas
  // editor.focus()
}


// memory-only, since we can't use localStorage in plugins
let untitledSourceCode = editor.defaultText

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
      genGraph(/*closeWhenDone*/ false)
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
  genButton.onclick = () => { genGraph(/* closeWhenDone */ false) }
  genButton.title = isMac ? "⌘↩" : "Ctrl+Return"
  // genCloseButton.onclick = () => { genGraph(/* closeWhenDone */ true) }
  playgroundButton.onclick = () => {
    window.open("https://rsms.me/graphviz/?source=" + encodeURIComponent(editor.text))
  }
  demoButton.onclick = () => {
    window.open("https://www.figma.com/file/j0LbONPTHzDEhJWZBNNP3D/Graphviz-examples/duplicate")
  }

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

      // case "eval-response":
      // case "print":
      //   messageHandler(msg)
      //   break

      // case "ui-confirm":
      //   rpc_confirm(msg as UIConfirmRequestMsg)
      //   break

      // case "fetch-request":
      //   rpc_fetch(msg as FetchRequestMsg)
      //   break

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
