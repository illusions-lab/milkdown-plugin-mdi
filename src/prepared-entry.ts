/** Worker-safe preparation entrypoint. This module does not load Milkdown or ProseMirror. */
export { initializeMdi } from '@illusions-lab/mdi'
export { prepareMdiDocument } from './prepared.js'
export type { PreparedMdiDocument, StructuredCloneSafeMdast } from './prepared.js'
