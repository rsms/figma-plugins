// ---------------------------------------------------------------------
// IPC messages

export interface Msg {
  type :string
}

export interface MapUpdateMsg extends Msg {
  type     :"map/update"
  nodes    :NodeInfo[]
  canvas   :CanvasBounds
  viewport :Viewport
}

export interface UpdateViewportMsg extends Msg {
  type     :"update-viewport"
  viewport :Viewport
}

export interface SetViewportMsg extends Msg {
  type     :"set-viewport"
  position :Point
}

export interface FocusNodesMsg extends Msg {
  type    :"focus-nodes"
  nodeIds :string[]
}

// --------------------------------------------------------------------
// Data

export interface CanvasBounds {
  minX :number
  minY :number
  maxX :number
  maxY :number
}

export interface Viewport extends Point {
  zoom :number
}

export interface NodeInfo extends Size {
  nodeId    :string
  transform :Matrix2D
  selected? :"direct" | "indirect"
  name?     :string
}

export type Matrix2D = [ number,number,number,number,number,number ] // [a b c d tx ty]

export interface Point {
  x :number
  y :number
}

export interface Size {
  width  :number
  height :number
}

export interface Rect extends Point, Size {
}
