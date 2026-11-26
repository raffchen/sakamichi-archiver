<script lang="ts">
  import { auth, login } from '../lib/auth.svelte'
  import { keynav } from '../lib/actions'
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
     visitor can still reach the public Blog tab instead of being stuck). -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="sheet login" role="presentation" transition:fade={{ duration: 120 }}>
  <div
    class="card"
    role="dialog"
    aria-modal="true"
    aria-label="login"
    tabindex="0"
    transition:slide={{ duration: 200 }}
    use:keynav={{ onEsc: () => (auth.open = false) }}
  >
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
    border: 1px solid var(--line);
    border-radius: 10px;
    outline: none;
  }
  input:focus {
    border-color: var(--accent, #7b6cd9);
  }
  button {
    font-size: 14px;
    padding: 9px 16px;
    border: none;
    border-radius: 10px;
    background: var(--accent, #7b6cd9);
    color: #fff;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .err {
    color: #c0392b;
    font-size: 13px;
    margin: 10px 0 0;
  }
  .note {
    color: var(--muted);
    font-size: 12.5px;
    line-height: 1.7;
    margin: 0 0 12px;
  }
</style>
