<script lang="ts">
  import { auth, login } from '../lib/auth.svelte'
  import { keynav } from '../lib/actions'
  import { icon } from '../lib/icons'
  import { fade, slide } from 'svelte/transition'

  let input = $state<HTMLInputElement | undefined>()
  let pw = $state('')

  const submit = () => {
    if (pw && !auth.busy) void login(pw)
  }
  $effect(() => {
    input?.focus()
  })
</script>

<!-- same sheet/card language as the info sheet; Esc dismisses — the gate
     re-opens the moment a gated request 401s, and the talk directory itself
     is empty until login, so dismissing is harmless. The `login` marker lets
     app.css keep the tab bar clickable above this sheet (a passwordless
     visitor can still reach the public Blog tab instead of being stuck).
     Entry is instant (out-only transitions): an animated reveal would show
     the member directory through the backdrop for the first frames. -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="sheet login" role="presentation" out:fade={{ duration: 120 }}>
  <div
    class="card"
    role="dialog"
    aria-modal="true"
    aria-label="login"
    tabindex="0"
    out:slide={{ duration: 200 }}
    use:keynav={{ onEsc: () => (auth.open = false) }}
  >
    <span class="lock" aria-hidden="true">{@html icon('lock')}</span>
    <h2>ログイン / login</h2>
    <p class="note">
      Talk アーカイブの閲覧にはログインが必要です<br />
      the Talk archive requires a login — the Blog tab is public
    </p>
    <form onsubmit={(e) => { e.preventDefault(); submit() }}>
      <input
        bind:this={input}
        bind:value={pw}
        type="password"
        autocomplete="current-password"
        placeholder="password"
        disabled={auth.busy}
      />
      <button type="submit" disabled={auth.busy || !pw}>
        {auth.busy ? '…' : 'ログイン'}
      </button>
    </form>
    {#if auth.error}
      <p class="err">{auth.error}</p>
    {/if}
  </div>
</div>

<style>
  /* cover the talk directory behind the gate: the card stretches to fill
     the whole sheet (divided by --app-zoom like the global .sheet .card
     rule, so the rendered height fills the viewport at any zoom level) */
  .sheet.login .card {
    height: calc(100% / var(--app-zoom));
    max-height: none;
    display: flex;
    flex-direction: column;
    justify-content: center; /* a tall card reads better with the form mid-screen */
    /* the gate wears the site's solid color (--section — nogi's header
       gradient would clash with the other sites' flat gates) */
    background: var(--section, var(--accent, #7b6cd9));
    color: #fff;
  }
  .lock {
    display: block;
    width: 34px;
    margin-bottom: 10px;
    opacity: 0.9;
  }
  .lock :global(svg) {
    display: block;
    width: 100%;
  }
  form {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }
  input {
    flex: 1;
    font-size: 16px;
    padding: 9px 12px;
    border: 1px solid transparent;
    border-radius: 10px;
    outline: none;
  }
  input:focus {
    border-color: #fff;
  }
  button {
    font-size: 14px;
    padding: 9px 16px;
    border: none;
    border-radius: 10px;
    background: #fff;
    /* fixed dark, NOT var(--ink): dark theme flips --ink to near-white,
       which washes out on this always-white button */
    color: #1c1c1e;
    font-weight: 600;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .err {
    color: #fff;
    font-size: 13px;
    margin: 10px 0 0;
  }
  /* beat the global .sheet .note (muted gray reads badly on the gradient) */
  .sheet.login .note {
    color: rgba(255, 255, 255, 0.92);
    font-size: 12.5px;
    line-height: 1.7;
    margin: 0 0 12px;
  }
</style>
