export interface Msg {
  type :string
}

export interface UpdateGraphMsg extends Msg {
  type           :"update-graph"
  reqId          :number
  svgCode        :string
  sourceCode     :string
  forceInsertNew :bool  // don't attempt to replace exisiting graph
}

export interface ResponseMsg extends Msg {
  type   :"response"
  reqId  :number
  error? :string
}

export interface ErrorMsg extends Msg {
  type: "error"
  error: string
}

export interface ClosePluginMsg extends Msg {
  type: "close-plugin"
}

export interface UpdateUIMsg extends Msg {
  type: "update-ui"
  nodeId     :string  // non-empty when a graph node is selected
  sourceCode :string  // valid when nodeId is set
}
