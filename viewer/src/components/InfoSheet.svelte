<script lang="ts">
  import type { Archive } from '../lib/types'
  import { keynav } from '../lib/actions'
  import { fmtDateTime } from '../lib/format'
  import { disp } from '../lib/display'
  import { fade, slide } from 'svelte/transition'

  let { archive, onclose }: { archive: Archive; onclose: () => void } = $props()
</script>

<!-- the backdrop closes on click; Esc and ✕ cover the keyboard paths -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
  class="sheet"
  role="presentation"
  transition:fade={{ duration: 120 }}
  onclick={onclose}
  use:keynav={{ onEsc: onclose }}
>
  <div
    class="card"
    role="dialog"
    aria-modal="true"
    aria-label="archive info"
    tabindex="0"
    transition:slide={{ duration: 200 }}
    onclick={(e) => e.stopPropagation()}
  >
    <h2>アーカイブ / archive</h2>
    <button class="close" aria-label="close" onclick={onclose}>✕</button>
    <table>
      <tbody>
        {#each archive.members as m (m.slug)}
          <tr>
            <td>
              {m.roman ?? m.name}<br />
              <span style="color:var(--muted);font-size:12px">{m.name} · group {m.group_id} · {m.site}</span>
            </td>
            <td class="r">
              {m.message_count} msgs<br />
              <span style="color:var(--muted);font-size:12px"
                >📷{m.counts.picture ?? 0} 🎬{m.counts.video ?? 0} 🔊{m.counts.voice ?? 0}</span
              >
            </td>
            <td class="r">
              {fmtDateTime(m.first ?? '')}<br />
              <span style="color:var(--muted);font-size:12px">→ {fmtDateTime(m.last ?? '')}</span>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="note">
      {archive.totals.messages} messages · {archive.totals.media} media files<br />
      index: {fmtDateTime(archive.generated_at)}<br />
      timestamps shown in your browser's timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone})<br />
      <br />
      refresh: <code>python tools/grab-media.py --site … --member-id …</code> then
      <code>cd viewer && npm run index</code><br />
      blog / news / official tabs are not part of this archive.
    </p>
  </div>
</div>

<style>
  code {
    background: #f1f1f4;
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 12px;
  }
  .close {
    position: absolute;
    top: 10px;
    right: 12px;
    font-size: 20px;
    color: var(--muted);
  }
  .card {
    position: relative;
  }
</style>
