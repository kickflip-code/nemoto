import { CANVAS_NODE_TYPES } from './flowConfiguration';
import { withLinkedContent } from './NodeLinkedContentBase';
export { buildNodeLinkedContent, NodeLinkedContent } from './NodeLinkedContentBase';

// Live Canvas decorators; the offline viewer decorates its own renderers.
// Synthetic lane/header nodes and Theme Studio previews have no indicators.
export const LINKED_CONTENT_NODE_TYPES = {
    ...CANVAS_NODE_TYPES,
    start: withLinkedContent(CANVAS_NODE_TYPES.start),
    end: withLinkedContent(CANVAS_NODE_TYPES.end),
    action: withLinkedContent(CANVAS_NODE_TYPES.action),
    decision: withLinkedContent(CANVAS_NODE_TYPES.decision),
    system: withLinkedContent(CANVAS_NODE_TYPES.system),
    'post-it': withLinkedContent(CANVAS_NODE_TYPES['post-it']),
    resource: withLinkedContent(CANVAS_NODE_TYPES.resource),
    event: withLinkedContent(CANVAS_NODE_TYPES.event),
};
