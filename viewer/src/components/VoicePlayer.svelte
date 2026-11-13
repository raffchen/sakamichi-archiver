<script lang="ts">
  import type { Member, Msg } from '../lib/types'
  import { fmtMediaStamp } from '../lib/format'
  import VoiceMsg from './VoiceMsg.svelte'

  let { m, member, who }: { m: Msg; member: Member; who: string } = $props()
</script>

<div class="vplayer">
  <div class="vplayer-head">
    <span class="vp-name">{who}</span>
    <span class="vp-date">{fmtMediaStamp(m.at)}</span>
  </div>

  {#if m.file}
    <!-- same one-line controls as the thread page's voice bubble
         (play · seek bar · time · volume), keyed so a new row restarts it -->
    {#key m.id}
      <VoiceMsg {m} autostart />
    {/key}
  {:else}
    <div class="missing">🔊 通話メッセージ（未アーカイブ）/ voice not archived</div>
  {/if}
</div>

<style>
  /* official media page: the bottom voice player bar. VoiceMsg provides the
     one-line controls; strip its chat-bubble chrome so it blends into the bar */
  .vplayer {
    flex: none;
    background: #f1f1f4;
    border-top: 1px solid var(--line);
    padding: 10px 16px 12px;
  }
  .vplayer-head {
    display: flex;
    justify-content: center;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 6px;
  }
  .vp-name {
    font-weight: 700;
    color: var(--ink);
    font-size: 15.5px;
  }
  .vp-date {
    color: var(--muted);
    font-size: 14px;
  }
  .vplayer :global(.bubble) {
    background: transparent;
    border-radius: 0;
    padding: 0;
    width: 100%;
    max-width: 100%;
    color: var(--ink);
  }
</style>
