
// Helper node types
/** A node that may have children */
export type ContainerNode = BaseNode & ChildrenMixin

// [All nodes which extends DefaultShapeMixin]
/** Shape is a node with visible geometry. I.e. may have fill, stroke etc. */
type Shape = BooleanOperationNode
           | EllipseNode
           | LineNode
           | PolygonNode
           | RectangleNode
           | StarNode
           | TextNode
           | VectorNode

/** Frame of type "FRAME" */
interface FrameFrameNode extends FrameNode {
  type: "FRAME"
  clone(): FrameFrameNode
}

/** Frame of type "GROUP" */
interface GroupFrameNode extends FrameNode {
  type: "GROUP"
  clone(): GroupFrameNode
}

// Type guards

const shapeNodeTypes = {
  BOOLEAN_OPERATION:1,
  ELLIPSE:1,
  LINE:1,
  POLYGON:1,
  RECTANGLE:1,
  STAR:1,
  TEXT:1,
  VECTOR:1,
}
const sceneNodeTypes = {
  // Shapes
  BOOLEAN_OPERATION:1,
  ELLIPSE:1,
  LINE:1,
  POLYGON:1,
  RECTANGLE:1,
  STAR:1,
  TEXT:1,
  VECTOR:1,
  // +
  COMPONENT:1,
  FRAME:1,
  GROUP:1,
  INSTANCE:1,
  SLICE:1,
}
const containerNodeTypes = {
  DOCUMENT:1,
  PAGE:1,
  BOOLEAN_OPERATION:1,
  COMPONENT:1,
  FRAME:1,
  GROUP:1,
  INSTANCE:1,
}

export function isBooleanOperation(n :BaseNode|null|undefined): n is BooleanOperationNode { return (n && n.type == "BOOLEAN_OPERATION") as bool }
export function isComponent(n :BaseNode|null|undefined): n is ComponentNode               { return (n && n.type == "COMPONENT") as bool }
export function isDocument(n :BaseNode|null|undefined) :n is DocumentNode                 { return (n && n.type == "DOCUMENT") as bool }
export function isEllipse(n :BaseNode|null|undefined): n is EllipseNode                   { return (n && n.type == "ELLIPSE") as bool }
export function isFrame(n :BaseNode|null|undefined): n is FrameFrameNode                  { return (n && n.type == "FRAME") as bool }
export function isGroup(n :BaseNode|null|undefined): n is GroupFrameNode                  { return (n && n.type == "GROUP") as bool }
export function isInstance(n :BaseNode|null|undefined): n is InstanceNode                 { return (n && n.type == "INSTANCE") as bool }
export function isLine(n :BaseNode|null|undefined): n is LineNode                         { return (n && n.type == "LINE") as bool }
export function isPage(n :BaseNode|null|undefined) :n is PageNode                         { return (n && n.type == "PAGE") as bool }
export function isPolygon(n :BaseNode|null|undefined): n is PolygonNode                   { return (n && n.type == "POLYGON") as bool }
export function isRectangle(n :BaseNode|null|undefined) :n is RectangleNode               { return (n && n.type == "RECTANGLE") as bool }
export function isSlice(n :BaseNode|null|undefined): n is SliceNode                       { return (n && n.type == "SLICE") as bool }
export function isStar(n :BaseNode|null|undefined): n is StarNode                         { return (n && n.type == "STAR") as bool }
export function isText(n :BaseNode|null|undefined): n is TextNode                         { return (n && n.type == "TEXT") as bool }
export function isVector(n :BaseNode|null|undefined): n is VectorNode                     { return (n && n.type == "VECTOR") as bool }

// Checks if node is a type with children
export function isContainerNode(n :BaseNode|null|undefined): n is ContainerNode { return (n && n.type in containerNodeTypes) as bool }
// Checks if node is a type of SceneNode
export function isSceneNode(n :BaseNode|null|undefined): n is SceneNode { return (n && n.type in sceneNodeTypes) as bool }
// Checks if node is a Shape
export function isShape(n :BaseNode|null|undefined): n is Shape { return (n && n.type in shapeNodeTypes) as bool }


// visit(node :ContainerNode|ReadonlyArray<ContainerNode>, visitor :NodePredicate) :Promise<void>
export function visit(node :ContainerNode, chunkTimeLimit :int, visitor :(n:BaseNode)=>any) :Promise<void> {
  return new Promise(resolve => {
    let branches = [ node ]
    function visitBranches() {
      let startTime = Date.now()
      while (true) {
        if (Date.now() - startTime > chunkTimeLimit) {
          // we've locked the UI for a long time -- yield
          return setTimeout(visitBranches, 0)
        }
        let b = branches.shift()
        if (!b) {
          return resolve()
        }
        for (let n of b.children) {
          let r = visitor(n)
          if (r || r === undefined) {
            if ((n as any).children) {
              branches.push(n as ContainerNode)
            }
          }
        }
      }
    }
    visitBranches()
  })
}

