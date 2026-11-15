<script lang="ts">
  /* Blog tab — directory -> member post list -> post detail (app parity).
     The directory shows EVERY member the app knows, grouped by generation
     (newest first); members whose backfill hasn't landed yet are greyed. */
  import type { Archive, BlogMemberInfo } from '../lib/types'
  import { openBlog, ui } from '../lib/store.svelte'
  import { fmtBlogStamp } from '../lib/format'
  import BlogMember from './BlogMember.svelte'
  import BlogPost from './BlogPost.svelte'

  let { archive }: { archive: Archive } = $props()

  const siteKeys = $derived(Object.keys(archive.sites))
  const siteMembers = $derived((archive.blogs?.members ?? []).filter((b) => b.site === ui.site))

  type Section = { label: string; members: BlogMemberInfo[] }
  const sections = $derived.by(() => {
    const byNum = new Map<number, BlogMemberInfo[]>()
    const other: BlogMemberInfo[] = []
    for (const b of siteMembers) {
      if (b.gen_num == null) {
        other.push(b)
        continue
      }
      const arr = byNum.get(b.gen_num) ?? []
      arr.push(b)
      byNum.set(b.gen_num, arr)
    }
    const out: Section[] = [...byNum.entries()]
      .sort((a, b) => a[0] - b[0]) // earlier generations first
      .map(([n, members]) => ({ label: `${n}期生`, members }))
    if (other.length) out.push({ label: 'その他', members: other })
    return out
  })
</script>

{#if ui.blogPost != null && ui.blogMember}
  <BlogPost {archive} />
{:else if ui.blogMember}
  <BlogMember {archive} />
{:else}
  <header class="head">
    <span class="title-left blog-title">Blogs</span>
  </header>

  <div class="sites">
    {#each siteKeys as k (k)}
      <button class:on={k === ui.site} onclick={() => (ui.site = k)}>
        {archive.sites[k]?.name ?? k}
      </button>
    {/each}
  </div>

  <div class="screen blog-directory">
    {#each sections as sec (sec.label)}
      <h2 class="blog-gen">{sec.label}</h2>
      <div class="blog-grid">
        {#each sec.members as b (b.uuid)}
          <button
            class="blog-card"
            class:empty={!b.count}
            class:grad={b.graduated}
            disabled={!b.count}
            title={b.count ? '' : 'not archived yet'}
            onclick={() => openBlog(b.key)}
          >
            {#if b.thumb}
              <img src={b.thumb} loading="lazy" alt={b.name} />
            {:else}
              <div class="ph"></div>
            {/if}
            <span class="nm">{b.name}{b.graduated ? ' (卒)' : ''}</span>
            <span class="dt">{b.count ? fmtBlogStamp(b.last!) : '—'}</span>
          </button>
        {/each}
      </div>
    {/each}
  </div>
{/if}
