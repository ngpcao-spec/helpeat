const paths = {
  bowl: '<path d="M3 12h18a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8Z"/><path d="M8 22h8M8 9c-1-2 1-2 0-5m4 5c-1-2 1-2 0-6m4 6c-1-2 1-2 0-5"/>',
  today: '<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M8 3v5m8-5v5M4 11h16m-8 3v3m-1.5-1.5h3"/>',
  group: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4m-3-11a4 4 0 0 1 0 8"/><circle cx="9" cy="8" r="4"/>',
  book: '<path d="M4 19V5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1 0-4h13M8 7h7m-7 4h5"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2Z"/>',
  pin: '<path d="M20 10c0 5-8 10-8 10S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  near: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  redo: '<path d="M20 7v5h-5M4 17v-5h5m10.3-2a7.7 7.7 0 0 0-12.5-4M4.7 14a7.7 7.7 0 0 0 12.5 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20 15a8.5 8.5 0 0 1-11-11 8.5 8.5 0 1 0 11 11Z"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="3"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  external: '<path d="M13 4h7v7m0-7-9 9m7 0v7H4V6h7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"/>',
  language: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 0 0 18m0-18a14 14 0 0 1 0 18"/>',
}

export const icon = name => '<svg class="icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>'
