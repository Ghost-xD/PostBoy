<script lang="ts">
  import { showChatbot } from '$lib/stores/uiStore';
  import ChatbotPanel from './ChatbotPanel.svelte';

  function close() {
    showChatbot.set(false);
  }
</script>

<div
  class="cb-screen"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onkeydown={(e) => { if (e.key === 'Escape') close(); }}
>
  <ChatbotPanel fullscreen onClose={close} />
</div>

<style>
  .cb-screen {
    position: fixed;
    inset: 0;
    z-index: 9700;
    background: #000;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: cb-screen-fade 180ms ease-out;
  }
  @keyframes cb-screen-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
