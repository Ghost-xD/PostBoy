/** Stack of cancel handlers for inline edit states inside modals/overlays. */
const cancelHandlers: Array<() => void> = [];

/** Register a cancel handler while an inline edit is active. Returns unregister. */
export function registerEditEscapeCancel(cancel: () => void): () => void {
  cancelHandlers.push(cancel);
  return () => {
    const index = cancelHandlers.lastIndexOf(cancel);
    if (index !== -1) cancelHandlers.splice(index, 1);
  };
}

/** Cancel the topmost inline edit, if any. Returns true when handled. */
export function cancelActiveEdit(): boolean {
  const cancel = cancelHandlers[cancelHandlers.length - 1];
  if (!cancel) return false;
  cancel();
  return true;
}
