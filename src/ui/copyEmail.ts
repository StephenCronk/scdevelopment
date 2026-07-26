/**
 * Click-to-copy on the address, with a transient confirmation.
 */

export function initCopyEmail(address: string, announce: (msg: string) => void): void {
  const button = document.getElementById('js-copy') as HTMLButtonElement | null
  const label = document.getElementById('js-copy-label')
  if (!button || !label) return

  // navigator.clipboard is unavailable on insecure origins; without it the
  // button would be a no-op, so remove it rather than lie about what it does.
  if (!navigator.clipboard) {
    button.remove()
    return
  }

  button.setAttribute('aria-label', `Copy ${address} to clipboard`)

  let timer = 0

  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(address)
      label.textContent = 'Copied'
      button.classList.add('is-done')
      announce('Email address copied to clipboard')
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        label.textContent = 'Copy'
        button.classList.remove('is-done')
      }, 2000)
    } catch {
      label.textContent = 'Press ⌘C'
      clearTimeout(timer)
      timer = window.setTimeout(() => { label.textContent = 'Copy' }, 2500)
    }
  })
}
