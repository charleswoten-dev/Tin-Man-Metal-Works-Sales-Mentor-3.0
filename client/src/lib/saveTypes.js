// Save categories — values must match the `saves.type` check constraint in the DB.
export const SAVE_TYPES = [
  { value: 'ad copy', label: 'Ad copy' },
  { value: 'email', label: 'Email' },
  { value: 'guarantee', label: 'Guarantee' },
  { value: 'product title', label: 'Product title' },
  { value: 'funnel', label: 'Funnel' },
  { value: 'other', label: 'Other' },
];

export const SAVE_TYPE_LABELS = Object.fromEntries(
  SAVE_TYPES.map((t) => [t.value, t.label])
);
