# Framework fixtures

These synthetic applications execute unmodified public browser modules in the
page. The engine does not import either framework as a runtime dependency.
Adapters call each framework's hydration, state update and unmount APIs.

| Module         | Distribution                                                                                         | SHA-256                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Preact 10.29.8 | [preact.module.js](https://unpkg.com/preact@10.29.8/dist/preact.module.js)                           | `c30e721ebfdc6e2ad4c18c14d2dfb82667829c8aec27de1207774e3fc16858a8` |
| Vue 3.5.22     | [vue.runtime.esm-browser.prod.js](https://unpkg.com/vue@3.5.22/dist/vue.runtime.esm-browser.prod.js) | `453d54f2da991b3ffbc7b793123888904490d7fa2f7a2e986516f582d193b3f6` |

The `.txt` copies retain the distribution bytes. MIT notices are included in
`PREACT-LICENSE` and `VUE-LICENSE`. These versions are pinned for reproducible
compatibility evidence.

The HTML is a synthetic, prerendered view. Hydration must preserve the original
root, button and keyed list node identities. The application then dispatches an
event, updates component state, reorders/inserts/removes keyed items, fetches
JSON over HTTP, observes mutations, navigates through History, restores the
component view on back/forward traversal and unmounts through framework lifecycle APIs.
Every page receives fresh framework and application state.
