/* Inline SVGs so the viewer needs no icon package.
   Stroke icons use currentColor via CSS; header icons are filled.

   The five tab icons are traced from the official app's bottom nav
   (screenshots 2026-11): bold ~2.1 strokes, speech bubble with tail at
   bottom-right, document with round-cap lines, left-facing megaphone with
   grip, org logo as the Official icon (nogizaka: filled triangle with
   knocked-out "46"; sakurazaka: outlined layered triangle with "46"),
   bell with separate clapper circle; sakurazaka's last tab is "Fanclub"
   (leaf-bud emblem) instead of Info. */

const S = 'viewBox="0 0 24 24"'

export const icons: Record<string, string> = {
  talk: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"><path d="M6.1 4.3h11.8c1 0 1.8.8 1.8 1.8v7.8c0 1-.8 1.8-1.8 1.8h-2.9v4.9l-2.9-4.9H6.1c-1 0-1.8-.8-1.8-1.8V6.1c0-1 .8-1.8 1.8-1.8z"/></svg>`,
  blog: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><rect x="4.9" y="3.9" width="14.2" height="16.2" rx="1.6" stroke-linejoin="round"/><path d="M8.4 8.4h7.2M8.4 12h7.2M8.4 15.6h7.2"/></svg>`,
  news: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><path d="M6.6 10.4 20 4.4v15.2L6.6 13.6z"/><path d="M4.1 9.2h2.5v5.6H4.1z"/><path d="M8.6 14.9v2.5c0 .7.6 1.3 1.3 1.3h.9c.7 0 1.3-.6 1.3-1.3v-2.5"/></svg>`,
  official: `<svg ${S}><path fill="currentColor" stroke="none" d="M19.3 3.9v16H6.1z"/><text x="14.4" y="18.3" font-size="5" font-weight="700" text-anchor="middle" fill="var(--bar, #fff)" stroke="none">46</text></svg>`,
  'official-saka': `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><path d="M15.6 4.9v13.9H5.2z"/><path d="M17.7 8.2v12.7H7.4"/><text x="11" y="17.6" font-size="4.6" font-weight="600" text-anchor="middle" fill="currentColor" stroke="none">46</text></svg>`,
  info: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><path d="M12 4.3c-3.3 0-5.5 2.3-5.5 5.7v3.2c0 .9-.3 1.7-.8 2.4l-.8 1.1c-.5.7 0 1.7.9 1.7h12.4c.9 0 1.4-1 .9-1.7l-.8-1.1c-.5-.7-.8-1.5-.8-2.4V10c0-3.4-2.2-5.7-5.5-5.7z"/><path d="M10.7 4.3a1.5 1.5 0 0 1 2.6 0" stroke-linecap="round"/><circle cx="12" cy="20.6" r="1.5"/></svg>`,
  /* media-list tab icons (official app: picture / film / speaker) */
  grid: `<svg ${S} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>`,
  photo: `<svg ${S} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.5" r="1.6" fill="currentColor" stroke="none"/><path d="M5.5 17.5 10.5 12l3.5 3.5 2.5-2.5 2.5 2.5" stroke-linecap="round"/></svg>`,
  film: `<svg ${S} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 15.5h17" stroke-linecap="round"/><path d="M7 18v-2.5M12 18v-2.5M17 18v-2.5"/><path d="M10 8.2v4.6l4-2.3z" fill="currentColor" stroke="none"/></svg>`,
  voice: `<svg ${S} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M4 9.5v5h3l4.5 3.8V5.7L7 9.5H4z"/><path d="M15 9a4.2 4.2 0 0 1 0 6"/><path d="M17.5 7a7 7 0 0 1 0 10"/></svg>`,
  back: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`,
  forward: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4h4v16H7zM13 4h4v16h-4z"/></svg>`,
  mute: `<svg ${S} fill="currentColor"><path d="M4 9h3l4-4v14l-4-4H4z"/><path d="M15 9.5 20 15M20 9.5 15 15" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>`,
  download: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5v11"/><path d="M7.5 11.5 12 16l4.5-4.5"/><path d="M5 19.5h14"/></svg>`,
  'chevron-down': `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5v15"/><path d="M6 13.5 12 19.5l6-6"/></svg>`,
  /* the message menu dots (official app: horizontal ··· at the row's end) */
  kebab: `<svg ${S}><circle cx="5" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.9" fill="currentColor" stroke="none"/></svg>`,
  link: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5 12.8 4.7a4 4 0 0 1 5.7 5.7L16.6 12.3"/><path d="M13 17.5 11.2 19.3a4 4 0 0 1-5.7-5.7L7.4 11.7"/></svg>`,
  check: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19 7"/></svg>`,
  /* the official Blogs ⇅ sort icon: up + down arrow pair */
  sort: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 20V5.5"/><path d="M4.5 9 8 5l3.5 4"/><path d="M16 4v14.5"/><path d="M12.5 15l3.5 4 3.5-4"/></svg>`,

}

export const icon = (name: string) => icons[name] ?? ''
