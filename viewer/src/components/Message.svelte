<script lang="ts">
  import type { Member, Msg } from '../lib/types'
  import { fmtStamp } from '../lib/format'
  import { icon } from '../lib/icons'
  import VoiceMsg from './VoiceMsg.svelte'

  let {
    m,
    member,
    who,
    onOpenMedia,
  }: {
    m: Msg
    member: Member
    who: string
    onOpenMedia: (m: Msg) => void
  } = $props()

  const style = $derived(m.ratio ? `aspect-ratio:${m.ratio};` : '')
</script>

<div class="msg {m.type}" id="m-{m.id}">
  <img class="ava" src={member.avatar ?? member.home ?? ''} alt="" loading="lazy" />
  <div class="col">
    <div class="who-row">
      <span class="who">{who}</span>
      <span class="when">{fmtStamp(m.at)}</span>
      {#if m.fav}<span class="fav" title="favorite">★</span>{/if}
    </div>

    {#if m.type === 'text'}
      {#if m.text}
        <div class="bubble">{m.text}</div>
      {:else}
        <div class="missing">（テキストなし / empty message）</div>
      {/if}
    {:else if m.type === 'picture'}
      <div class="bubble media">
        {#if m.file}
          <button class="shot-btn" onclick={() => onOpenMedia(m)} aria-label="開く / open photo">
            <img class="shot" style={style} src={m.thumb ?? m.file} alt="" loading="lazy" />
          </button>
        {:else}
          <div class="missing">📷 画像は未アーカイブ / image not archived</div>
        {/if}
        {#if m.text}<div class="cap">{m.text}</div>{/if}
      </div>
    {:else if m.type === 'video'}
      <div class="bubble media">
        {#if m.file}
          <div class="video-wrap">
            {#if m.poster}
              <img class="poster" style={style} src={m.poster} alt="" loading="lazy" />
            {:else}
              <video class="poster" src={m.file} preload="metadata" muted playsinline></video>
            {/if}
            <button class="play" onclick={() => onOpenMedia(m)} aria-label="play video">
              <i>{@html icon('play')}</i>
            </button>
            {#if m.silent}<span class="no-audio">🔇 This video has no audio</span>{/if}
          </div>
        {:else}
          <div class="missing">🎬 動画は未アーカイブ / video not archived</div>
        {/if}
        {#if m.text}<div class="cap">{m.text}</div>{/if}
      </div>
    {:else if m.type === 'voice'}
      <VoiceMsg {m} />
    {:else}
      <div class="missing">未対応のメッセージ種別: {m.type} / unsupported message type</div>
    {/if}
  </div>
</div>
