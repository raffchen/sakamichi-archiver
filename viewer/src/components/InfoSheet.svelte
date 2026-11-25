<script lang="ts">
  import type { Archive } from '../lib/types'
  import { keynav } from '../lib/actions'
  import { fmtDateTime, fmtBlogStamp, sizeOf } from '../lib/format'
  import { disp } from '../lib/display'
  import { blogPanel, blogMonth, stackedChart } from '../lib/blogStats'
  import { ui } from '../lib/store.svelte'
  import { fade, slide } from 'svelte/transition'

  let { archive, blog, onclose }: { archive: Archive; blog: boolean; onclose: () => void } = $props()

  /* the panel mirrors whichever archive you opened it from: the blog tab gets
     the blog corpus, every talk view the message one */
  const panel = $derived(blog ? blogPanel(archive) : null)
  /* the chart shows one site (its table row was clicked) or all sites; the
     selection is panel-local — it doesn't move the app's site switcher */
  let chartSite = $state<string | null>(null)
  const chartLabel = $derived(
    chartSite ? (archive.sites[chartSite]?.name ?? chartSite) : 'all sites',
  )
  const toggleChart = (site: string) => (chartSite = chartSite === site ? null : site)
  /* one bar per year, segmented by site in all-sites mode; a selected site is
     that site alone, in its own color */
  const chart = $derived(panel ? stackedChart(panel.rows, chartSite) : [])
  const chartMax = $derived(Math.max(...chart.map((y) => y.total), 1))
  /* y-axis gridlines: a nice round step (1/2/5 × 10^k) near a third of the
     peak, thinned so at most five lines — recomputed when the site filter
     changes the scale */
  const ticks = $derived.by(() => {
    if (!chart.length) return []
    const raw = chartMax / 3
    const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)))
    let step = mag
    for (const m of [2, 5, 10]) if (m * mag <= raw) step = m * mag
    while (chartMax / step > 5) step *= 2
    step = Math.max(step, 1)
    const out: number[] = []
    for (let t = step; t <= chartMax; t += step) out.push(Math.round(t))
    return out
  })
  /* the pill shows the total; the tooltip breaks the bar into its sites */
  const chartTitle = (y: (typeof chart)[number]) =>
    [
      `${y.year}: ${y.total.toLocaleString()} posts`,
      ...y.segs.map((s) => `${archive.sites[s.site]?.name ?? s.site} ${s.n.toLocaleString()}`),
    ].join('\n')
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

      {#if chart.length}
        <p class="chartcap">
          posts per year — {chartLabel}{#if chartSite}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <button class="clear" onclick={() => (chartSite = null)}>· show all sites</button>{/if}
        </p>
        <div class="chart" aria-label="posts per year">
          <div class="grid" aria-hidden="true">
            {#each ticks as t (t)}
              <div class="tick" style="bottom: {(t / chartMax) * 100}%">
                <span class="tlabel">{t.toLocaleString()}</span>
                <i class="tline"></i>
              </div>
            {/each}
          </div>
          <div class="years">
            {#each chart as y (y.year)}
              <div
                class="ycol"
                style="--h: {Math.max((y.total / chartMax) * 100, 2)}%"
                title={chartTitle(y)}
              >
                <span class="ycount">{y.total.toLocaleString()}</span>
                <div class="ybar">
                  {#each y.segs as s (s.site)}
                    <i
                      class="seg"
                      style="height: {(s.n / y.total) * 100}%; background: var(--site-{s.site})"
                    ></i>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>
        <div class="xlabels">
          {#each chart as y (y.year)}
            <span>{y.year}</span>
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
            <!-- clicking a row filters the chart above to that site; the
                 app's site switcher is untouched -->
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <tr
              class:cur={r.site === ui.site}
              class:sel={r.site === chartSite}
              onclick={() => toggleChart(r.site)}
              title="show this site's posts per year"
            >
              <td>
                <i class="dot" style="background: var(--site-{r.site})"></i>{r.label}<br />
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
  /* posts-per-year chart: a fixed-height plot area so the bars, gridlines
     and the year-label row below all share one scale. The left gutter holds
     the tick labels; the top margin leaves room for the count pill of the
     tallest bar. */
  .chart {
    position: relative;
    margin: 22px 0 0 38px;
  }
  .grid {
    position: absolute;
    left: -38px;
    right: 0;
    top: 0;
    bottom: 0;
    pointer-events: none;
  }
  /* a zero-height anchor at the tick's exact height; line and label both
     center on it (label via translateY) so gridlines match the bar scale */
  .tick {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
  }
  .tlabel {
    position: absolute;
    left: 0;
    width: 34px;
    text-align: right;
    font-size: 9px;
    color: var(--muted);
    transform: translateY(50%);
  }
  .tline {
    position: absolute;
    left: 38px;
    right: 0;
    top: 0;
    border-top: 1px solid var(--line);
  }
  .years {
    display: flex;
    align-items: stretch;
    gap: 6px;
    height: 72px;
  }
  .ycol {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    min-width: 0;
    position: relative;
    height: 100%;
  }
  .ybar {
    width: 100%;
    max-width: 22px;
    border-radius: 3px 3px 0 0;
    background: var(--accent, var(--ink));
    opacity: 0.75;
    height: var(--h);
    /* segments stack bottom-up in the table's site order */
    display: flex;
    flex-direction: column-reverse;
    overflow: hidden;
  }
  .seg {
    display: block;
    width: 100%;
    flex: none;
  }
  /* legend: each table row carries its site's chart color */
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 5px;
    vertical-align: 1px;
  }
  /* exact count on hover — a pill floating just above the bar top; the year
     span keeps its layout slot so the row never shifts. Touch devices have no
     hover, so the counts stay visible there instead. */
  .ycount {
    position: absolute;
    bottom: calc(var(--h) + 4px);
    left: 50%;
    transform: translateX(-50%);
    font-size: 10px;
    line-height: 1;
    padding: 3px 5px;
    border-radius: 8px;
    background: var(--raise, #fff);
    border: 1px solid var(--line);
    color: var(--ink);
    white-space: nowrap;
    opacity: 0;
    transition: opacity 100ms;
    pointer-events: none;
    z-index: 1;
  }
  .ycol:hover .ycount {
    opacity: 1;
  }
  @media (hover: none) {
    .ycount {
      opacity: 1;
    }
  }
  /* year labels live in their own row under the plot so the gridlines line
     up with the bar tops exactly */
  .xlabels {
    display: flex;
    gap: 6px;
    margin: 3px 0 12px 38px;
  }
  .xlabels span {
    flex: 1;
    text-align: center;
    font-size: 10px;
    color: var(--muted);
    min-width: 0;
  }
  tr.cur td {
    font-weight: 600;
  }
  tr.sel td {
    background: var(--press);
  }
  tbody tr {
    cursor: pointer;
  }
  .chartcap {
    color: var(--muted);
    font-size: 13px;
    margin-bottom: 4px;
  }
  .clear {
    color: var(--accent, var(--ink));
    font-size: 13px;
    margin-left: 6px;
  }
  .pulse {
    color: var(--muted);
    font-size: 13px;
  }
</style>
