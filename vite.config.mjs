import { readFileSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { defineConfig } from 'vite'

export default defineConfig(({ command, isPreview }) => {
  // Project Pages uses a repository prefix; local HTTPS stays at the root.
  const base = command === 'build' || isPreview
    ? (process.env.PAGES_BASE_PATH || '/interective_web_4nowzoo/')
    : '/'
  if (command !== 'serve' || isPreview) return { base }

  let cert, key
  try {
    cert = readFileSync(new URL('./.certs/dev-cert.pem', import.meta.url))
    key = readFileSync(new URL('./.certs/dev-key.pem', import.meta.url))
  } catch {
    throw new Error('개발용 HTTPS 인증서가 없습니다. npm run cert:generate 를 먼저 실행하세요.')
  }

  const certificate = new X509Certificate(cert)
  const addresses = Object.values(networkInterfaces()).flatMap(entries =>
    (entries ?? []).filter(entry => entry.family === 'IPv4' && !entry.internal).map(entry => entry.address),
  )
  if (Date.parse(certificate.validTo) <= Date.now() || !certificate.checkHost('localhost') ||
      ['127.0.0.1', '::1', ...addresses].some(address => !certificate.checkIP(address))) {
    throw new Error('인증서가 만료되었거나 현재 IP가 포함되지 않았습니다. npm run cert:generate 후 다시 실행하세요.')
  }

  return {
    base,
    server: {
      host: '0.0.0.0',
      https: { cert, key },
      fs: {
        // Keep Vite's default sensitive-file exclusions when adding local folders.
        deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.certs/**', '**/.tools/**'],
      },
    },
  }
})
