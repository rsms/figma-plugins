import { isMac, addKeyEventHandler } from "./util"

export class Editor {
  readonly ta :HTMLTextAreaElement
  readonly defaultText :string

  focused = false
  _textSize = 0

  constructor(ta :HTMLTextAreaElement) {
    this.ta = ta
    this.defaultText = ta.value.trim()
  }


  init() {
    addKeyEventHandler(this.ta, this.onKeyEvent)
    this.ta.addEventListener("focus", this.onReceivedFocus)
    this.ta.addEventListener("blur", this.onLostFocus)
    this.ta.focus()
  }


  onReceivedFocus = () => {
    this.focused = true
  }

  onLostFocus = () => {
    this.focused = false
  }


  onKeyEvent = (ev :KeyboardEvent, key :string) => {
    if (!this.focused) {
      return false
    }

    if ((ev.metaKey || ev.ctrlKey) && key == "a") {
      return this.selectAll(), true
    }

    // Figma captures undo and redo, not sending them to the plugin, unless we capture them.
    if ((ev.metaKey || ev.ctrlKey) && key == "z") {
      return this.undo(), true
    }
    if ( ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && (key == "Z" || key == "z")) ||
         (!isMac && ev.ctrlKey && key == "y") ) {
      return this.redo(), true
    }

    // Figma grabs copy, paste etc which is slow. Intercept.
    if ((ev.metaKey || ev.ctrlKey) && key == "c") {
      return document.execCommand("copy"), true
    }
    if ((ev.metaKey || ev.ctrlKey) && key == "x") {
      return document.execCommand("cut"), true
    }
    if ((ev.metaKey || ev.ctrlKey) && key == "v") {
      return document.execCommand("paste"), true
    }

    // indentation
    if ((ev.metaKey || ev.ctrlKey) && key == "]") {
      return this.indent(), true
    }
    if ((ev.metaKey || ev.ctrlKey) && key == "[") {
      return this.dedent(), true
    }
    if (key == "Tab") {
      return this.dedent(), true
    }

    // text size
    if ((ev.metaKey || ev.ctrlKey) && (key == "+" || key == "=" || key == "Plus")) {
      return this.increaseTextSize(), true
    }
    if ((ev.metaKey || ev.ctrlKey) && (key == "-" || key == "Minus")) {
      return this.decreaseTextSize(), true
    }

    // if (DEBUG && (ev.metaKey || ev.ctrlKey || ev.altKey)) {
    //   dlog("Editor onKeyEvent: [unhandled] key:", key, ev)
    // }

    return false
  }


  getTextSize() :number {
    if (!this._textSize) {
      let s = window.getComputedStyle(this.ta)
      let v = s.getPropertyValue("--editorFontSize")
      this._textSize = parseInt(v)
      if (isNaN(this._textSize)) {
        this._textSize = 11
      }
    }
    return this._textSize
  }

  setTextSize(textSize :number) {
    this._textSize = Math.min(40, Math.max(7, textSize))
    document.body.style.setProperty("--editorFontSize", `${this._textSize}px`)
  }

  resetTextSize() {
    document.body.style.removeProperty("--editorFontSize")
    this._textSize = 0
    // this.setTextSize(11)  // XXX hard coded
  }


  increaseTextSize() {
    this.setTextSize(this.getTextSize() + 1)
  }

  decreaseTextSize() {
    this.setTextSize(this.getTextSize() - 1)
  }


  indent() {
    dlog("TODO: Editor indent")
  }


  dedent() {
    dlog("TODO: Editor dedent")
  }


  undo() {
    document.execCommand("undo")
  }

  redo() {
    document.execCommand("redo")
  }


  get text() :string {
    return this.ta.value
  }

  set text(value :string) {
    this.ta.value = value
  }


  focus() {
    this.ta.focus()
  }

  selectAll() {
    this.ta.select()
  }
}
