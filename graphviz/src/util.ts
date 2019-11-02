
export const isMac = navigator.platform.indexOf("Mac") != -1

export function addKeyEventHandler(
  el      :Element|Window,
  handler :(ev :KeyboardEvent, key :string)=>bool,
) {
  el.addEventListener("keydown", (ev :KeyboardEvent) => {
    if (handler(ev, ev.key)) {
      ev.preventDefault()
      ev.stopPropagation()
    }
  }, { capture: true, passive: false })
}
