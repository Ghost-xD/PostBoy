<script lang="ts">
  import { createBubbler, stopPropagation } from 'svelte/legacy';

  const bubble = createBubbler();
  import { activeModals, closeModal, updateModalInput, updateModalField } from '$lib/utils/modalManager.svelte';
  import type { Modal } from '$lib/utils/modalManager.svelte';

  function getIcon(type: string) {
    const icons: Record<string, string> = {
      info: '📘',
      warning: '⚠️',
      error: '❌',
      success: '✅',
      question: '💬'
    };
    return icons[type] || '📘';
  }

  function getAccentClass(type: string) {
    if (type === 'error') return 'accent-error';
    if (type === 'warning') return 'accent-warning';
    if (type === 'success') return 'accent-success';
    return '';
  }

  function handleBackdropClick(modal: Modal) {
    if (modal.cancelable) {
      closeModal(modal.id, -1);
    }
  }

  function handleKeydown(e: KeyboardEvent, modal: Modal) {
    if (e.key === 'Escape' && modal.cancelable) {
      closeModal(modal.id, -1);
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const target = e.target as HTMLElement;
      if (target.tagName !== 'SELECT') {
        e.preventDefault();
        closeModal(modal.id, modal.defaultButton || 0);
      }
    }
  }

  function focusFirst(node: HTMLElement) {
    requestAnimationFrame(() => {
      const focusable = node.querySelector<HTMLElement>(
        'input[autofocus], select[autofocus], input:not([type="hidden"]), select, textarea'
      );
      if (focusable) {
        focusable.focus();
        if (focusable instanceof HTMLInputElement) focusable.select();
      }
    });
  }
</script>

{#each $activeModals as modal (modal.id)}
  <div
    class="modal-overlay"
    onclick={() => handleBackdropClick(modal)}
    onkeydown={(e) => handleKeydown(e, modal)}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div class="modal-container {getAccentClass(modal.type || 'info')}" role="presentation" onclick={stopPropagation(bubble('click'))} use:focusFirst>
      {#if modal.cancelable}
        <button class="modal-x" onclick={() => closeModal(modal.id, -1)} aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
      {/if}

      <div class="modal-icon">{getIcon(modal.type || 'info')}</div>
      <h2 class="modal-title">{modal.title}</h2>

      {#if modal.message}
        <div class="modal-message">{@html modal.message}</div>
      {/if}
      {#if modal.detail}
        <p class="modal-detail">{modal.detail}</p>
      {/if}

      <!-- Simple text input (legacy prompt support) -->
      {#if modal.inputValue !== undefined && !modal.fields}
        <div class="modal-fields">
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="text"
            class="field-input"
            value={modal.inputValue}
            oninput={(e) => updateModalInput(modal.id, e.currentTarget.value)}
            onkeydown={(e) => e.key === 'Enter' && closeModal(modal.id, 0)}
            placeholder={modal.message}
            autofocus
          />
        </div>
      {/if}

      <!-- Structured fields -->
      {#if modal.fields && modal.fields.length > 0}
        <div class="modal-fields">
          {#each modal.fields as field}
            <div class="field-group">
              <label class="field-label" for="field-{field.id}">{field.label}</label>
              {#if field.type === 'select' && field.options}
                <!-- svelte-ignore a11y_autofocus -->
                <select
                  id="field-{field.id}"
                  class="field-select"
                  value={field.value}
                  onchange={(e) => updateModalField(modal.id, field.id, e.currentTarget.value)}
                  autofocus={field.autofocus}
                >
                  {#each field.options as opt}
                    <option value={opt.value}>{opt.label}</option>
                  {/each}
                </select>
              {:else}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  id="field-{field.id}"
                  type={field.type === 'password' ? 'password' : 'text'}
                  class="field-input"
                  value={field.value}
                  placeholder={field.placeholder || ''}
                  oninput={(e) => updateModalField(modal.id, field.id, e.currentTarget.value)}
                  onkeydown={(e) => e.key === 'Enter' && closeModal(modal.id, 0)}
                  autofocus={field.autofocus}
                />
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <div class="modal-actions">
        {#each (modal.buttons || ['OK']) as button, idx}
          <button
            class="modal-btn {idx === (modal.defaultButton || 0) ? 'btn-primary' : 'btn-secondary'}"
            onclick={() => closeModal(modal.id, idx)}
            type="button"
          >
            {button}
          </button>
        {/each}
      </div>
    </div>
  </div>
{/each}

<style>
  /* Overlay */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: fadeIn 0.15s ease;
    padding: 24px;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(12px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* Container */
  .modal-container {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.04);
    max-width: 440px;
    width: 100%;
    padding: 28px;
    position: relative;
    animation: slideUp 0.2s ease;
  }

  .modal-container.accent-error {
    border-top: 2px solid var(--error-color);
  }
  .modal-container.accent-warning {
    border-top: 2px solid var(--warning-color);
  }
  .modal-container.accent-success {
    border-top: 2px solid var(--success-color);
  }

  /* Close button */
  .modal-x {
    position: absolute;
    top: 14px;
    right: 14px;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: all 0.15s;
  }

  .modal-x:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  /* Icon */
  .modal-icon {
    font-size: 36px;
    text-align: center;
    margin-bottom: 12px;
  }

  /* Title */
  .modal-title {
    font-size: 17px;
    font-weight: 600;
    color: var(--text-primary);
    text-align: center;
    margin: 0 0 8px 0;
    line-height: 1.3;
  }

  /* Message & detail */
  .modal-message {
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
    text-align: center;
    margin-bottom: 4px;
  }

  .modal-detail {
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.5;
    text-align: center;
    opacity: 0.7;
    margin: 0 0 4px 0;
  }

  /* Fields */
  .modal-fields {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .field-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .field-input,
  .field-select {
    width: 100%;
    padding: 10px 12px;
    background-color: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    font-size: 14px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .field-input:focus,
  .field-select:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color) 18%, transparent);
  }

  .field-select {
    cursor: pointer;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%23b0b0b0' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 36px;
  }

  .field-select option {
    background-color: var(--bg-secondary);
    color: var(--text-primary);
    padding: 8px;
  }

  /* Actions */
  .modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 20px;
  }

  .modal-btn {
    padding: 9px 20px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    min-width: 80px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: inherit;
  }

  .btn-primary {
    background: var(--accent-color);
    color: white;
    border: none;
  }

  .btn-primary:hover {
    filter: brightness(1.1);
    box-shadow: 0 4px 12px var(--accent-glow);
  }

  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
  }

  .btn-secondary:hover {
    background: var(--bg-primary);
    border-color: var(--text-secondary);
  }

  .modal-btn:active {
    transform: scale(0.97);
  }

  .modal-btn:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
  }
</style>
