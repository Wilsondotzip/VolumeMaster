export const CATEGORIES = [
  { id: 'Games',   icon: '🎮', label: 'Games',   description: 'Steam, Epic, GOG, Xbox & more' },
  { id: 'Browser', icon: '🌐', label: 'Browser',  description: 'Chrome, Firefox, Edge & more' },
  { id: 'Chat',    icon: '💬', label: 'Chat',     description: 'Discord, Slack, Teams & more' },
  { id: 'Media',   icon: '🎵', label: 'Media',    description: 'Spotify, VLC' },
];

export const CATEGORY_PREFIX = 'category:';

export function isCategoryItem(name) {
  return typeof name === 'string' && name.startsWith(CATEGORY_PREFIX);
}

export function categoryId(name) {
  return name.slice(CATEGORY_PREFIX.length);
}

export function getCategoryMeta(id) {
  return CATEGORIES.find((c) => c.id === id) ?? null;
}
