// Why the emulator does not load, as the page says it: the page's security policy refuses WebAssembly before Bidule
// allows it ('wasm-unsafe-eval' in its script-src), else what the browser said. Pure (apart from ghostty.ts, which
// loads WebAssembly).
export function emulatorProblem(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/Content Security Policy|unsafe-eval/i.test(message))
    return 'Cette version de Bidule interdit WebAssembly à son interface, et ce terminal (ghostty-web) en a besoin. En attendant une version qui l’autorise, choisis le Terminal officiel dans Réglages › Rôles.'
  return `Le terminal ne se charge pas : ${message}`
}
