export type Verb = 'read' | 'write' | 'delete-item' | 'delete-container' | 'delete-folder';

export const ROLE_VERBS: Record<'Reader' | 'Writer' | 'Admin', Set<Verb>> = {
  Reader: new Set(['read']),
  Writer: new Set(['read', 'write', 'delete-item']),
  Admin: new Set(['read', 'write', 'delete-item', 'delete-container', 'delete-folder']),
};
