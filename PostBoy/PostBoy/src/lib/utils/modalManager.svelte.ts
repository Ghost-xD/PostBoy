import { writable } from 'svelte/store';

export interface ModalField {
  id: string;
  type: 'text' | 'password' | 'select';
  label: string;
  placeholder?: string;
  value: string;
  options?: Array<{ value: string; label: string }>;
  autofocus?: boolean;
}

export interface ModalOptions {
  type?: 'info' | 'warning' | 'error' | 'success' | 'question';
  title: string;
  message: string;
  detail?: string;
  buttons?: string[];
  defaultButton?: number;
  cancelable?: boolean;
  fields?: ModalField[];
}

export interface Modal extends ModalOptions {
  id: string;
  resolve: (response: number) => void;
  inputValue?: string;
}

export const activeModals = writable<Modal[]>([]);

let modalIdCounter = 0;
const modalInputValues = new Map<string, string>();
const modalFieldValues = new Map<string, Map<string, string>>();

function generateModalId(): string {
  return `modal-${Date.now()}-${modalIdCounter++}`;
}

export function updateModalInput(modalId: string, value: string) {
  modalInputValues.set(modalId, value);
  activeModals.update(modals =>
    modals.map(m => m.id === modalId ? { ...m, inputValue: value } : m)
  );
}

export function updateModalField(modalId: string, fieldId: string, value: string) {
  let fields = modalFieldValues.get(modalId);
  if (!fields) {
    fields = new Map();
    modalFieldValues.set(modalId, fields);
  }
  fields.set(fieldId, value);

  activeModals.update(modals =>
    modals.map(m => {
      if (m.id === modalId && m.fields) {
        return {
          ...m,
          fields: m.fields.map(f => f.id === fieldId ? { ...f, value } : f)
        };
      }
      return m;
    })
  );
}

export function getModalFieldValues(modalId: string): Record<string, string> {
  const result: Record<string, string> = {};
  const fields = modalFieldValues.get(modalId);
  if (fields) {
    fields.forEach((value, key) => { result[key] = value; });
  }
  return result;
}

export function showModal(options: ModalOptions): Promise<number> {
  return new Promise((resolve) => {
    const modalId = generateModalId();
    const modal: Modal = {
      id: modalId,
      type: options.type || 'info',
      title: options.title,
      message: options.message,
      detail: options.detail,
      buttons: options.buttons || ['OK'],
      defaultButton: options.defaultButton || 0,
      cancelable: options.cancelable !== false,
      fields: options.fields,
      resolve
    };

    if (options.fields) {
      const fieldMap = new Map<string, string>();
      options.fields.forEach(f => fieldMap.set(f.id, f.value));
      modalFieldValues.set(modalId, fieldMap);
    }

    activeModals.update(modals => [...modals, modal]);
  });
}

export function closeModal(modalId: string, response: number) {
  let currentModals: Modal[] = [];
  activeModals.update(modals => {
    currentModals = modals;
    return modals;
  });

  const modal = currentModals.find(m => m.id === modalId);
  if (modal) {
    activeModals.update(modals => modals.filter(m => m.id !== modalId));
    modal.resolve(response);
    modalInputValues.delete(modalId);
    modalFieldValues.delete(modalId);
  }
}

export async function showInfo(title: string, message: string, detail?: string): Promise<void> {
  await showModal({ type: 'info', title, message, detail });
}

export async function showError(title: string, message: string, detail?: string): Promise<void> {
  await showModal({ type: 'error', title, message, detail });
}

export async function showWarning(title: string, message: string, detail?: string): Promise<void> {
  await showModal({ type: 'warning', title, message, detail });
}

export async function showSuccess(title: string, message: string, detail?: string): Promise<void> {
  await showModal({ type: 'success', title, message, detail });
}

export async function confirm(title: string, message: string, detail?: string): Promise<boolean> {
  const response = await showModal({
    type: 'question',
    title,
    message,
    detail,
    buttons: ['Confirm', 'Cancel'],
    defaultButton: 0
  });
  return response === 0;
}

export async function prompt(title: string, message: string, defaultValue: string = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const modalId = generateModalId();

    const modal: Modal = {
      id: modalId,
      type: 'question',
      title,
      message,
      buttons: ['OK', 'Cancel'],
      defaultButton: 0,
      cancelable: true,
      resolve: (response: number) => {
        if (response === 0) {
          const value = (modalInputValues.get(modalId) || defaultValue).trim();
          resolve(value || null);
        } else {
          resolve(null);
        }
      }
    };

    modal.inputValue = defaultValue;
    modalInputValues.set(modalId, defaultValue);
    activeModals.update(modals => [...modals, modal]);
  });
}

/**
 * Show a modal with structured fields (inputs, selects) and return all field values.
 * Returns null if cancelled, or a Record<fieldId, value> if confirmed.
 */
export async function showForm(
  title: string,
  message: string,
  fields: ModalField[],
  options?: { confirmLabel?: string; cancelLabel?: string; type?: ModalOptions['type'] }
): Promise<Record<string, string> | null> {
  const modalId = generateModalId();

  return new Promise((resolve) => {
    const modal: Modal = {
      id: modalId,
      type: options?.type || 'question',
      title,
      message,
      fields,
      buttons: [options?.confirmLabel || 'Save', options?.cancelLabel || 'Cancel'],
      defaultButton: 0,
      cancelable: true,
      resolve: (response: number) => {
        if (response === 0) {
          const values = getModalFieldValues(modalId);
          // Fill in any missing defaults
          fields.forEach(f => {
            if (!(f.id in values)) values[f.id] = f.value;
          });
          resolve(values);
        } else {
          resolve(null);
        }
      }
    };

    const fieldMap = new Map<string, string>();
    fields.forEach(f => fieldMap.set(f.id, f.value));
    modalFieldValues.set(modalId, fieldMap);

    activeModals.update(modals => [...modals, modal]);
  });
}
