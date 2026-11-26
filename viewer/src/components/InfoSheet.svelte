<script lang="ts">
  import type { Archive } from '../lib/types'
  import { keynav } from '../lib/actions'
  import {
    fmtDateTime,
    fmtBlogStamp,
    fmtDayShort,
    fmtDur,
    fmtMonth,
    fmtStamp,
    sizeOf,
  } from '../lib/format'
  import { disp } from '../lib/display'
  import { blogPanel, blogMonth, stackedChart } from '../lib/blogStats'
  import { talkPanel, rosterGroups, TYPE_EMOJI } from '../lib/talkStats'
  import { ui } from '../lib/store.svelte'
  import { fade, slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'

  let {
    archive,
    blog,
    talkView,
    onclose,
  }: { archive: Archive; blog: boolean; talkView: boolean; onclose: () => void } = $props()

  /* the panel mirrors whichever archive you opened it from: the blog tab gets
     the blog corpus, every talk view the message one (falling back to the
     bare member sheet when the archive is empty) */
  const panel = $derived(blog ? blogPanel(archive) : null)
  const talk = $derived(talkView && !blog ? talkPanel(archive) : null)
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
  /* pulse lines assembled as strings so separators only render when both
     sides exist (Svelte trims the whitespace between blocks) */
  const talkMedia = $derived(
    talk
      ? `${talk.mediaFiles.toLocaleString()} media files${talk.disk ? ` · ${sizeOf(talk.disk.bytes)}` : ''}`
      : '',
  )
  const fmtListen = (s: number) => (s >= 3600 ? `${Math.round(s / 360) / 10} h` : fmtDur(s))
  const talkPulse1 = $derived.by(() => {
    if (!talk) return ''
    const parts: string[] = []
    if (talk.last) parts.push(`newest message ${fmtStamp(talk.last)}`)
    if (talk.busiestDay)
      parts.push(`busiest day ${fmtDayShort(talk.busiestDay.day)} — ${talk.busiestDay.count} messages`)
    return parts.join(' · ')
  })
  const talkPulse2 = $derived.by(() => {
    if (!talk) return ''
    const parts: string[] = []
    if (talk.last7 != null) parts.push(`${talk.last7} in the last 7 days`)
    if (talk.listen != null && talk.listen >= 60) parts.push(`listen/watch time ${fmtListen(talk.listen)}`)
    return parts.join(' · ')
  })
  /* compact member roster: chips by message count (desc, kana order on
     ties), grouped under small site headings when more than one site has
     members. The old row detail — media mix and date span — opens on tap or
     hover: hover via the title tooltip (desktop), tap via the expandable
     detail block (touch has no hover). One chip open at a time. */
  let chipOpen = $state<string | null>(null)
  const rankedMembers = $derived(
    archive.members
      .filter((m) => m.message_count > 0)
      .sort((a, b) => b.message_count - a.message_count),
  )
  const roster = $derived(rosterGroups(rankedMembers, archive.sites))
  /* the open chip fills with the member's own site color — matching the
     heading dot — rather than the tab's accent, which can contradict it;
     the count badge picks the same color up, white once open. Siteless
     members keep the tab accent. */
  const chipAccent = (m: (typeof rankedMembers)[number]) =>
    m.site ? `var(--site-${m.site}, var(--accent))` : 'var(--accent)'
  const memberTip = (m: (typeof rankedMembers)[number]) =>
    [
      `${m.message_count} messages`,
      `📷 ${m.counts.picture ?? 0} · 🎬 ${m.counts.video ?? 0} · 🔊 ${m.counts.voice ?? 0}`,
      m.first && m.last ? `${fmtDateTime(m.first)} → ${fmtDateTime(m.last)}` : null,
    ]
      .filter(Boolean)
      .join('\n')
  /* svelte's slide animates height only; the chip detail is wider than the
     header, so it also needs the horizontal axis — slide both at once */
  function slideChip(node: HTMLElement, { duration = 180 }: { duration?: number } = {}) {
    const s = getComputedStyle(node)
    const w = node.offsetWidth
    const h = node.offsetHeight
    const px = (t: number, v: number) => `${t * v}px`
    return {
      duration,
      easing: cubicOut,
      css: (t: number) =>
        `overflow: hidden; width: ${px(t, w)}; height: ${px(t, h)};` +
        ` padding-top: ${px(t, parseFloat(s.paddingTop))};` +
        ` margin-top: ${px(t, parseFloat(s.marginTop))};` +
        ` border-top-width: ${px(t, parseFloat(s.borderTopWidth))}; min-height: 0;`,
    }
  }
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
    {:else if talkView && talk}
      <h2>アーカイブ / message archive</h2>
      <button class="close" aria-label="close" onclick={onclose}>✕</button>
      <p class="big">
        {talk.msgs.toLocaleString()} messages · {talk.members} members ({talk.sites}
        {talk.sites === 1 ? 'site' : 'sites'})
      </p>
      <p>
        {talk.first ? fmtMonth(talk.first) : '—'} → {talk.last ? fmtMonth(talk.last) : '—'}<br />
        {talkMedia}
      </p>

      <!-- message-type mix: one proportion bar + the counts as a legend -->
      {#if talk.msgs}
        <div class="mix" role="img" aria-label="message type mix">
          {#each talk.types as t (t.type)}
            {#if t.n}
              <i
                class="mixseg"
                style="width: {(t.n / talk.msgs) * 100}%; background: var(--mix-{t.type})"
                title={`${TYPE_EMOJI[t.type]} ${t.type} — ${t.n.toLocaleString()} (${Math.round((t.n / talk.msgs) * 100)}%)`}
              ></i>
            {/if}
          {/each}
        </div>
        <p class="mixlegend">
          {#each talk.types as t, i (t.type)}{#if t.n}{i ? ' · ' : ''}{TYPE_EMOJI[t.type]}
            {t.n.toLocaleString()}{/if}{/each}
        </p>
      {/if}

      {#each roster as g (g.key)}
        {#if roster.length > 1 && g.name}
          <div class="chiph">
            <i class="dot" style="background: var(--site-{g.key}, var(--accent))"></i>{g.name}
          </div>
        {/if}
        <div class="chips">
          {#each g.members as m (m.slug)}
            <button
              class="chip"
              class:open={chipOpen === m.slug}
              aria-expanded={chipOpen === m.slug}
              style={`--chip-accent: ${chipAccent(m)}`}
              title={memberTip(m)}
              onclick={() => (chipOpen = chipOpen === m.slug ? null : m.slug)}
            >
              <span class="ch">
                <span class="cn">{m.roman ?? m.name}</span>
                <span class="cc">{m.message_count}</span>
              </span>
              {#if chipOpen === m.slug}
                <span class="cd" transition:slideChip>
                  {m.message_count} messages<br />
                  📷 {m.counts.picture ?? 0} · 🎬 {m.counts.video ?? 0} · 🔊 {m.counts.voice ?? 0}<br />
                  {#if m.first && m.last}{fmtDateTime(m.first)} → {fmtDateTime(m.last)}{/if}
                </span>
              {/if}
            </button>
          {/each}
        </div>
      {/each}

      <p class="pulse">{talkPulse1}</p>
      <p class="pulse">{talkPulse2}</p>
      <p class="pulse">
        {#if talk.topRate}top talker: {talk.topRate.member.name} —
          {talk.topRate.perDay.toFixed(1)} msgs/day ({talk.topRate.msgs.toLocaleString()} in
          {talk.topRate.days}
          {talk.topRate.days === 1 ? 'day' : 'days'}){/if}
      </p>
      {#if talk.missing}
        <p class="pulse">⚠ {talk.missing} messages were never archived (files missing upstream)</p>
      {/if}

      <p class="note">
        index: {fmtDateTime(archive.generated_at)}<br />
        timestamps shown in your browser's timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone})<br />
        <br />
        new messages appear here automatically after each sync<br />
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
    line-height: 1;
    color: var(--muted);
    /* the label's box top starts at the anchor (a 0-height element), so
       centering on the line means shifting UP half the box, not down */
    transform: translateY(-50%);
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
  /* message-type mix: neutral + theme colors, legend line under the bar */
  .mix {
    --mix-text: var(--muted);
    --mix-picture: var(--accent);
    --mix-video: var(--accent-2);
    --mix-voice: var(--ink);
    display: flex;
    height: 10px;
    border-radius: 5px;
    overflow: hidden;
    margin: 10px 0 4px;
  }
  .mixseg {
    display: block;
    height: 100%;
  }
  .mixlegend {
    color: var(--muted);
    font-size: 13px;
    margin-bottom: 10px;
  }
  /* compact member roster — pill chips wrapping 2–3 per row instead of a
     three-line table row per member, grouped under site headings */
  .chiph {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0 2px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .chiph .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start; /* a taller expanded chip must not stretch its neighbours */
    gap: 6px;
    margin: 4px 0 12px;
  }
  .chip {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 12px;
    background: var(--pill-bg);
    max-width: 100%;
    /* the chips are real buttons (tap-to-expand) — strip the UA chrome */
    border: 0;
    font: inherit;
    text-align: left;
    cursor: pointer;
    /* background eases between pill and accent while the detail slides */
    transition: background 150ms;
  }
  /* always a column: the header span holds name + count on one line, the
     detail block slots underneath when open */
  .chip {
    flex-direction: column;
    align-items: flex-start;
  }
  .chip.open {
    background: var(--chip-accent, var(--accent));
    border-radius: 12px;
  }
  /* accent container: white on top like the site headers do (the pale pink
     saka accent included) */
  .chip.open .cn,
  .chip.open .cc {
    color: #fff;
  }
  .chip.open .cd {
    color: rgba(255, 255, 255, 0.85);
    border-top-color: rgba(255, 255, 255, 0.35);
  }
  .ch {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
  }
  .cc {
    color: var(--chip-accent, var(--accent));
  }
  .cd {
    display: block;
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--line);
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
  }
  .cn {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cc {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent, var(--ink));
  }
</style>
