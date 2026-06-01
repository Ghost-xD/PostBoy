// Module shims for libraries without bundled type declarations.
// jsoncrack-react pulls in react + react-dom/client at runtime via
// dynamic import in JsonGraphViewer.svelte. We don't install
// @types/react because the rest of the codebase is Svelte; these
// shims keep svelte-check happy while allowing the dynamic imports
// to work at runtime.

declare module 'react';
declare module 'react-dom/client';
