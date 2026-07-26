import { FORMSPREE_ENDPOINT } from '../config'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

interface Deps {
  /** Fired on a genuine successful submit — drives the blob's pulse. */
  onSuccess: () => void
  /** Fired when the form panel opens or closes — reframes the blob. */
  onToggle: (open: boolean) => void
  announce: (msg: string) => void
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing element #${id}`)
  return node as T
}

export function initContact({ onSuccess, onToggle, announce }: Deps): void {
  const page = document.querySelector<HTMLElement>('.page')!
  const disclose = el<HTMLButtonElement>('js-disclose')
  const panel = el<HTMLDivElement>('js-panel')
  const form = el<HTMLFormElement>('js-form')
  const submit = el<HTMLButtonElement>('js-submit')
  const note = el<HTMLParagraphElement>('js-note')

  const fields = [
    { input: el<HTMLInputElement>('f-name'), err: el<HTMLElement>('f-name-err'), label: 'name' },
    { input: el<HTMLInputElement>('f-email'), err: el<HTMLElement>('f-email-err'), label: 'email' },
    { input: el<HTMLTextAreaElement>('f-message'), err: el<HTMLElement>('f-message-err'), label: 'message' },
  ] as const

  const gotcha = el<HTMLInputElement>('f-gotcha')

  // --- disclosure ---------------------------------------------------------

  let open = false

  const setOpen = (next: boolean, moveFocus: boolean) => {
    open = next
    disclose.setAttribute('aria-expanded', String(open))
    panel.classList.toggle('is-open', open)
    page.classList.toggle('is-expanded', open)
    document.body.classList.toggle('form-open', open)

    // While collapsed the fields are clipped to zero height but still in the
    // document, so they have to be taken out of the tab order and the
    // accessibility tree explicitly.
    panel.inert = !open

    disclose.querySelector('.disclose-text')!.textContent =
      open ? 'or just email me' : 'or send a message'
    // The visible text reads as prose; spell the control's actual job out for
    // assistive tech rather than relying on "or send a message" alone.
    disclose.setAttribute('aria-label', open ? 'Hide the contact form' : 'Show the contact form')

    onToggle(open)

    if (open && moveFocus) {
      // Defer a frame: focusing a still-zero-height panel makes the browser
      // scroll-anchor to the wrong place.
      requestAnimationFrame(() => fields[0].input.focus({ preventScroll: true }))
    }
  }

  setOpen(false, false)
  disclose.addEventListener('click', () => setOpen(!open, true))

  // --- validation ---------------------------------------------------------

  function setError(i: number, msg: string | null) {
    const f = fields[i]!
    f.input.closest('.field')!.classList.toggle('is-invalid', msg !== null)
    f.input.setAttribute('aria-invalid', String(msg !== null))
    f.err.textContent = msg ?? ''
    f.err.hidden = msg === null
    if (msg) f.input.setAttribute('aria-describedby', f.err.id)
    else f.input.removeAttribute('aria-describedby')
  }

  function validate(): boolean {
    let ok = true
    const [name, email, message] = [
      fields[0].input.value.trim(),
      fields[1].input.value.trim(),
      fields[2].input.value.trim(),
    ]

    if (name.length < 1) { setError(0, 'Please add your name.'); ok = false } else setError(0, null)

    if (email.length < 1) { setError(1, 'Please add an email address.'); ok = false }
    else if (!EMAIL_RE.test(email)) { setError(1, "That doesn't look like an email address."); ok = false }
    else setError(1, null)

    if (message.length < 2) { setError(2, 'Please add a message.'); ok = false } else setError(2, null)

    return ok
  }

  // Clear a field's error as soon as the user starts fixing it.
  fields.forEach((f, i) => {
    f.input.addEventListener('input', () => {
      if (f.input.closest('.field')!.classList.contains('is-invalid')) setError(i, null)
    })
  })

  // --- submit -------------------------------------------------------------

  let sending = false

  function setNote(msg: string, isError: boolean) {
    note.textContent = msg
    note.classList.toggle('is-error', isError)
    if (msg) announce(msg)
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (sending) return

    // Honeypot: a bot filled the hidden field. Show the same success state and
    // spend nothing from the Formspree quota.
    if (gotcha.value.trim() !== '') {
      form.reset()
      setNote('Thanks — message sent.', false)
      return
    }

    if (!validate()) {
      const bad = fields.filter((f) => f.input.closest('.field')!.classList.contains('is-invalid'))
      bad[0]?.input.focus()
      // The per-field messages are wired up via aria-describedby, but a screen
      // reader user who just pressed Send needs to hear that something happened.
      announce(
        bad.length === 1
          ? 'One field needs attention.'
          : `${bad.length} fields need attention.`,
      )
      note.textContent = ''
      note.classList.remove('is-error')
      return
    }

    sending = true
    submit.disabled = true
    submit.setAttribute('aria-busy', 'true')
    setNote('Sending…', false)

    try {
      const res = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        // Accept JSON so Formspree answers in place instead of redirecting the
        // browser away to its own thank-you page.
        headers: { Accept: 'application/json' },
        body: new FormData(form),
      })

      if (res.ok) {
        form.reset()
        fields.forEach((_, i) => setError(i, null))
        setNote('Thanks — message sent. I’ll come back to you shortly.', false)
        onSuccess()
      } else {
        const data = await res.json().catch(() => null)
        const detail: string | undefined = data?.errors?.[0]?.message
        setNote(detail ?? 'Something went wrong sending that. Email me directly instead?', true)
      }
    } catch {
      setNote('Couldn’t reach the server. Email me directly instead?', true)
    } finally {
      sending = false
      submit.disabled = false
      submit.removeAttribute('aria-busy')
    }
  })
}
