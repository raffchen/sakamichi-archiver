<script lang="ts">
  import type { Archive } from '../lib/types'
  import { goHome, openBlogTab, info, ui } from '../lib/store.svelte'
  import { auth } from '../lib/auth.svelte'
  import { icon } from '../lib/icons'

  let { archive }: { archive: Archive } = $props()

  const isSaka = $derived(ui.site === 'sakurazaka46')
  const isHinata = $derived(ui.site === 'hinatazaka46')

  const hasBlogs = $derived(!!archive.blogs?.members.some((b) => b.site === ui.site))
  /* the Official tab opens the group's own website (archive.config.json);
     sites without an official URL keep the tab locked */
  const officialUrl = $derived(archive.sites[ui.site]?.official ?? null)

  const onTalk = () =>
    ui.view === 'home' ||
    ui.view === 'thread' ||
    ui.view === 'gallery' ||
    (ui.view === 'search' && (ui.searchScope === 'message' || ui.searchScope === 'message-member'))
  const onBlog = () =>
    ui.view === 'blog' ||
    (ui.view === 'search' && (ui.searchScope === 'blog' || ui.searchScope === 'blog-member'))
  /* the info sheet mirrors the side it opens from — the talk stats are
     login-gated, so before logging in the Info tab is only offered from
     blog views (the blog sheet is public) */
  const infoLocked = $derived(auth.required && !auth.authed && !onBlog())

  const tabs = $derived([
    { id: 'talk', label: 'Talk', ic: 'talk', locked: false },
    { id: 'blog', label: 'Blog', ic: 'blog', locked: !hasBlogs },
    { id: 'news', label: 'News', ic: 'news', locked: true },
    { id: 'official', label: 'Official', ic: isSaka ? 'official-saka' : isHinata ? 'official-hinata' : 'official', locked: !officialUrl, url: officialUrl ?? undefined },
    { id: 'info', label: 'Info', ic: 'info', locked: infoLocked, lockedTitle: 'login to view the talk archive' },
  ])
</script>

<nav class="tabs">
  {#each tabs as t (t.id)}
    <button
      class:on={(t.id === 'talk' && onTalk()) || (t.id === 'blog' && onBlog())}
      class:locked={t.locked}
      disabled={t.locked}
      title={t.url ?? (t.locked ? (t.lockedTitle ?? 'not part of the archive') : '')}
      onclick={() => {
        if (t.id === 'talk') goHome()
        else if (t.id === 'blog') openBlogTab()
        else if (t.url) window.open(t.url, '_blank', 'noopener') // external site, archive stays put
        else if (!t.locked) info.open = true
      }}
    >
      {@html icon(t.ic)}
      <span>{t.label}</span>
    </button>
  {/each}
</nav>
