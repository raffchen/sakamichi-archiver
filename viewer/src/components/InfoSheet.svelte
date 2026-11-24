<script lang="ts">
  import type { Archive } from '../lib/types'
  import { keynav } from '../lib/actions'
  import { fmtDateTime, fmtBlogStamp, sizeOf } from '../lib/format'
  import { disp } from '../lib/display'
  import { blogPanel, blogMonth } from '../lib/blogStats'
  import { ui } from '../lib/store.svelte'
  import { fade, slide } from 'svelte/transition'

  let { archive, blog, onclose }: { archive: Archive; blog: boolean; onclose: () => void } = $props()

  /* the panel mirrors whichever archive you opened it from: the blog tab gets
     the blog corpus, every talk view the message one */
  const panel = $derived(blog ? blogPanel(archive) : null)
  const maxYear = $derived(panel ? Math.max(...panel.years.map((y) => y[1]), 1) : 1)
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
    aria-label={blog ? 'blog archive info' : 'archive info'}
    tabindex="0"
    transition:slide={{ duration: 200 }}
    onclick={(e) => e.stopPropagation()}
  >
    {#if blog && panel}
      <h2>アーカイブ / blog archive</h2>
      <button class="close" aria-label="close" onclick={onclose}>✕</button>
      <p class="big">
        {panel.posts.toLocaleString()} posts · {panel.members} members ({panel.members - panel.graduated} current / {panel.graduated} graduated)
      </p>
      <p>
        {blogMonth(panel.first) ?? '—'} → {blogMonth(panel.last) ?? '—'}<br />
        {#if panel.images}
          {panel.images.files.toLocaleString()} images · {sizeOf(panel.images.bytes)}
        {/if}
      </p>
      <p>
        {panel.graduatedPosts.toLocaleString()} posts ({Math.round((panel.graduatedPosts / Math.max(panel.posts, 1)) * 100)}%)
        were written by members who have since graduated — erased upstream, kept only here
      </p>

      {#if panel.years.length}
        <div class="years" aria-label="posts per year">
          {#each panel.years as [year, n] (year)}
            <div class="ycol">
              <div class="ybar" style="height: {Math.max((n / maxYear) * 100, 2)}%"></div>
              <span class="ylab">{year}</span>
            </div>
          {/each}
        </div>
      {/if}

      <table>
        <thead>
          <tr>
            <th></th>
            <th class="r">members</th>
            <th class="r">posts</th>
            <th class="r">first → last</th>
          </tr>
        </thead>
        <tbody>
          {#each panel.rows as r (r.site)}
            <tr class:cur={r.site === ui.site}>
              <td>
                {r.label}<br />
                <span style="color:var(--muted);font-size:12px">{r.graduated} graduated</span>
              </td>
              <td class="r">{r.members}</td>
              <td class="r">{r.posts.toLocaleString()}</td>
              <td class="r">
                {blogMonth(r.first) ?? '—'}<br />
                <span style="color:var(--muted);font-size:12px">→ {blogMonth(r.last) ?? '—'}</span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      <p class="pulse">
        {panel.last ? `newest post ${fmtBlogStamp(panel.last)} · ` : ''}{panel.active30}
        {panel.active30 === 1 ? 'member' : 'members'} posted in the last 30 days
      </p>
      <p class="pulse">
        {#if panel.busiestDay}busiest day: {panel.busiestDay.date} — {panel.busiestDay.count} posts<br />{/if}
        {#if panel.top}most prolific: {panel.top.name} — {panel.top.count.toLocaleString()} posts{panel.top.graduated
          ? ' · graduated'
          : ''}{/if}
      </p>

      <p class="note">
        blog stamps are Japan time (JST), exactly as the official sites publish them<br />
        index: {fmtDateTime(archive.generated_at)}<br />
        <br />
        new posts appear here automatically after each sync round
      </p>
    {:else}
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
        new messages appear here automatically after each sync<br />
        blog / news / official tabs are not part of this archive.
      </p>
    {/if}
  </div>
</div>

<style>
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
  .big {
    font-size: 15px;
  }
  /* posts-per-year bars: one flex row, height relative to the max year */
  .years {
    display: flex;
    align-items: stretch;
    gap: 6px;
    height: 64px;
    margin: 12px 0;
  }
  .ycol {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    min-width: 0;
  }
  .ybar {
    width: 100%;
    max-width: 22px;
    border-radius: 3px 3px 0 0;
    background: var(--accent, var(--ink));
    opacity: 0.75;
  }
  .ylab {
    font-size: 10px;
    color: var(--muted);
    margin-top: 3px;
  }
  tr.cur td {
    font-weight: 600;
  }
  .pulse {
    color: var(--muted);
    font-size: 13px;
  }
</style>
