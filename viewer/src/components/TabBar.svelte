<script lang="ts">
  import type { Archive } from '../lib/types'
  import { goHome, info, ui, unreadCount } from '../lib/store.svelte'
  import { icon } from '../lib/icons'

  let { archive }: { archive: Archive } = $props()

  const isSaka = $derived(ui.site === 'sakurazaka46')

  const tabs = $derived([
    { id: 'talk', label: 'Talk', ic: 'talk', locked: false },
    { id: 'blog', label: 'Blog', ic: 'blog', locked: true },
    { id: 'news', label: 'News', ic: 'news', locked: true },
    { id: 'official', label: 'Official', ic: isSaka ? 'official-saka' : 'official', locked: true },
    { id: 'info', label: 'Info', ic: 'info', locked: false },
  ])

  const unread = $derived(
    archive.members
      .filter((m) => (m.site ?? 'nogizaka46') === ui.site)
      .reduce((n, m) => n + unreadCount(m.slug, m.messages), 0),
  )

  const onTalk = () => ui.view === 'home' || ui.view === 'thread' || ui.view === 'gallery'
</script>

<nav class="tabs">
  {#each tabs as t (t.id)}
    <button
      class:on={t.id === 'talk' && onTalk()}
      class:locked={t.locked}
      disabled={t.locked}
      title={t.locked ? 'not part of the archive' : ''}
      onclick={() => {
        if (t.id === 'talk') goHome()
        else if (!t.locked) info.open = true
      }}
    >
      {@html icon(t.ic)}
      <span>{t.label}</span>
      {#if t.id === 'talk' && unread > 0}
        <span class="count-badge">{unread}</span>
      {/if}
    </button>
  {/each}
</nav>
