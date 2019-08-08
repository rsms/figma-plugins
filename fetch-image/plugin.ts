figma.showUI(`<script>
  let imurl = 'https://66.media.tumblr.com/7af65560449c91e8cd82a4a3478f5e0b/tumblr_pb7bt5CTrS1qzdllao1_1280.jpg'
  fetch(imurl).then(r => r.arrayBuffer()).then(a =>
    parent.postMessage({ pluginMessage: ["imdata", new Uint8Array(a)] }, '*'))
</script>`, { visible:false })
figma.ui.onmessage = msg => {
  if (msg[0] == "imdata") {
    let data = msg[1] as Uint8Array
    let imageHash = figma.createImage(new Uint8Array(data)).hash
    const rect = figma.createRectangle()
    rect.fills = [
      { type: "SOLID", color: { r: 1, g: 0, b: 0 } },
      { type: "IMAGE", scaleMode: "FIT",  imageHash },
    ]
    figma.currentPage.appendChild(rect)
  }
  figma.closePlugin()
}
