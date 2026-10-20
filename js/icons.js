const svg = (body) =>
  `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icon = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  play: svg('<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>'),
  pause: svg('<path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor"/>'),
  skip: svg('<path d="M5 5v14l10-7z" fill="currentColor"/><path d="M18.5 5v14"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  photo: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>'),
};
