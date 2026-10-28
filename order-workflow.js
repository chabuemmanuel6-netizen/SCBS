export const ORDER_TRANSITIONS = Object.freeze({
    pending: Object.freeze(["confirmed", "cancelled"]),
    confirmed: Object.freeze(["processing", "cancelled"]),
    processing: Object.freeze(["ready", "cancelled"]),
    ready: Object.freeze(["completed", "cancelled"]),
    completed: Object.freeze([]),
    cancelled: Object.freeze([])
});

export const ORDER_STATUSES = Object.freeze(
    Object.keys(ORDER_TRANSITIONS)
);

export function canTransitionOrder(currentStatus, nextStatus) {
    if (
        typeof currentStatus !== "string" ||
        typeof nextStatus !== "string"
    ) {
        return false;
    }

    return ORDER_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
}
