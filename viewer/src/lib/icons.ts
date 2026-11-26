/* Inline SVGs so the viewer needs no icon package.
   Stroke icons use currentColor via CSS; header icons are filled.

   The five tab icons are traced from the official app's bottom nav
   (screenshots 2026-11): bold ~2.1 strokes, speech bubble with tail at
   bottom-right, document with round-cap lines, left-facing megaphone with
   grip, org logo as the Official icon (nogizaka: filled triangle with
   knocked-out "46"; sakurazaka: outlined layered triangle with "46";
   hinatazaka: sakura's layered pair with nogi's filled triangle on top).
   The front triangle + "46" share the SAME coordinates in all three
   (nogizaka's M19.3 3.9v16H6.1 / 46 at 14.4,18.3) so switching sites
   doesn't shift the mark; only the back triangle and fill style differ.
   Sakurazaka's back triangle is hinatazaka's (+2.1,+3.0 offset, right +
   bottom edges only — no hypotenuse, so the "46" is never crossed).
   bell with separate clapper circle; sakurazaka's last tab is "Fanclub"
   (leaf-bud emblem) instead of Info. */

const S = 'viewBox="0 0 24 24"'

export const icons: Record<string, string> = {
  /* padlock for the login gate (currentColor so it works on any background) */
  lock: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="5.2" y="10.2" width="13.6" height="9.6" rx="2"/><path d="M8.3 10.2V7.5a3.7 3.7 0 0 1 7.4 0v2.7"/><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/></svg>`,
  talk: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"><path d="M6.1 4.3h11.8c1 0 1.8.8 1.8 1.8v7.8c0 1-.8 1.8-1.8 1.8h-2.9v4.9l-2.9-4.9H6.1c-1 0-1.8-.8-1.8-1.8V6.1c0-1 .8-1.8 1.8-1.8z"/></svg>`,
  blog: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><rect x="4.9" y="3.9" width="14.2" height="16.2" rx="1.6" stroke-linejoin="round"/><path d="M8.4 8.4h7.2M8.4 12h7.2M8.4 15.6h7.2"/></svg>`,
  news: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><path d="M6.6 10.4 20 4.4v15.2L6.6 13.6z"/><path d="M4.1 9.2h2.5v5.6H4.1z"/><path d="M8.6 14.9v2.5c0 .7.6 1.3 1.3 1.3h.9c.7 0 1.3-.6 1.3-1.3v-2.5"/></svg>`,
  official: `<svg ${S}><path fill="currentColor" stroke="none" d="M19.3 3.9v16H6.1z"/><text x="14.4" y="18.3" font-size="5" font-weight="700" text-anchor="middle" fill="var(--bar, #fff)" stroke="none">46</text></svg>`,
  'official-saka': `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><path d="M21.4 6.9v16H8.2"/><path d="M19.3 3.9v16H6.1z"/><text x="14.4" y="18.3" font-size="5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">46</text></svg>`,
  /* hinatazaka: sakura's layered pair, but the TOP triangle is nogi's filled
     "46" one (the icon hinata had before). The back triangle copies the
     filled one's size, offset down-right like sakura's, and — like sakura's
     back triangle — draws only its right + bottom edges (no hypotenuse), so
     the knockout "46" is never crossed by a back stroke. */
  'official-hinata': `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><path d="M21.4 6.9v16H8.2"/><path fill="currentColor" stroke="none" d="M19.3 3.9v16H6.1z"/><text x="14.4" y="18.3" font-size="5" font-weight="700" text-anchor="middle" fill="var(--bar, #fff)" stroke="none">46</text></svg>`,
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
  /* dark-mode toggle (Talk + Blogs headers): moon shows in light mode (tap
     for dark), sun in dark — the header icons inherit the head fg */
  moon: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.2 14.3A8.4 8.4 0 0 1 9.7 3.8a8.4 8.4 0 1 0 10.5 10.5z"/></svg>`,
  sun: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.3"/><path d="M12 2.7v2.1M12 19.2v2.1M2.7 12h2.1M19.2 12h2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5"/></svg>`,
  /* settings cog (Blogs header, right of the ⇅ sort icon) */
  gear: `<svg ${S} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z"/></svg>`,
  /* magnifier (member-scoped search: thread header, blog-scope entries) */
  search: `<svg ${S} fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="11" cy="11" r="6.2"/><path d="m15.6 15.6 4.6 4.6"/></svg>`,

}

export const icon = (name: string) => icons[name] ?? ''
