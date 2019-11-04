// URL to fetch
let url = "https://scripter.rsms.me/icon.pngz"

// Run fetch in the UI process, sending the result to the plugin when done
figma.showUI(`<script>
  fetch(${JSON.stringify(url)}).then(r => {
    if ((r.status+"")[0] != "2") throw Error(\`HTTP \${r.status} \${r.statusText}\`)
    return r.arrayBuffer()
  }).then(a => parent.postMessage({ pluginMessage: { data: new Uint8Array(a) }}, '*'))
  .catch(err => parent.postMessage({ pluginMessage: { error: ""+err }}, '*'))
</script>`, {
  visible:false, // don't actually show a UI window
})

// listen for messages from the UI process
figma.ui.onmessage = msg => {
  if (msg.data && msg.data.length > 0) {
    addImageToCanvas(msg.data)
  }
  figma.closePlugin(msg.error || "")
}

// Function that creates a rectangle on canvas with an image fill from image data
function addImageToCanvas(data) {
  let imageHash = figma.createImage(data).hash
  const rect = figma.createRectangle()
  rect.fills = [ { type: "IMAGE", scaleMode: "FIT", imageHash } ]
  figma.currentPage.appendChild(rect)

  // select the rectangle and focus the viewport
  figma.currentPage.selection = [rect]
  figma.viewport.scrollAndZoomIntoView([rect])
}

// Notes:
//
// If you are to fetch resources in a real production plugin, you will most
// likely want to make sure you can handle multiple fetches concurrently.
//
// The order by which messages are send and received is not deterministic when
// dealing with the network. Therefore you will need to "multiplex" your fetches.
// Multiplexing is the ability to do multiple things over the same "channel"; in
// our case messages passed between the plugin process and the UI process.
//
// Implementing multiplexing is pretty easy for this case:
//
// 1. When you being a fetch call, generate a unique identifier. For instance,
//    a number variable that you keep incrementing.
//
// 2. Associate this ID with the promise or callback for the fetch call.
//
// 3. Add this ID to your postMessage data.
//
// 4. In your UI process where you execute fetch(), include that same ID with the
//    response message that the UI sends back to the plugin with postMessage.
//
// 5. In your plugin process, look up the promise or callback for the ID in the
//    message you receive. This is the association you made in step 2.
//    Resolve the promise or call the callback with the message result.
//
// 6. Clear the association between the ID and promise/callback to free up memory.
//
// Another way to think about this is as requests and responses — you want to
// track the request as your process it so that when the sender seens a response it
// knows which request it is a response for.
//
