import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createPrivateKey, X509Certificate } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'

const certDir = fileURLToPath(new URL('../.certs/', import.meta.url))
const caDir = fileURLToPath(new URL('../.certs/ca/', import.meta.url))
const localMkcert = fileURLToPath(new URL(`../.tools/mkcert${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
const mkcert = existsSync(localMkcert) ? localMkcert : 'mkcert'
const env = { ...process.env, CAROOT: caDir }
const addresses = [...new Set(Object.values(networkInterfaces()).flatMap(entries =>
  (entries ?? []).filter(entry => entry.family === 'IPv4' && !entry.internal).map(entry => entry.address),
))]

// npm's predev hook repairs changed LAN addresses without replacing the trusted CA.
if (process.argv.includes('--ensure')) {
  try {
    const cert = new X509Certificate(readFileSync(`${certDir}dev-cert.pem`))
    const ca = new X509Certificate(readFileSync(`${caDir}rootCA.pem`))
    const key = createPrivateKey(readFileSync(`${certDir}dev-key.pem`))
    if (Date.parse(cert.validFrom) <= Date.now() && Date.parse(cert.validTo) > Date.now() + 86400000 &&
        cert.checkHost('localhost') && ['127.0.0.1', '::1', ...addresses].every(address => cert.checkIP(address)) &&
        cert.checkPrivateKey(key) && cert.verify(ca.publicKey)) process.exit(0)
  } catch {
    // Missing or invalid certificate/key: regenerate with the existing project CA.
  }
  console.log('현재 네트워크에 맞게 개발용 HTTPS 인증서를 자동 갱신합니다.')
}

function run(args) {
  const result = spawnSync(mkcert, args, { env, stdio: 'inherit' })
  if (result.error) {
    console.error('mkcert를 실행할 수 없습니다. mkcert를 설치한 뒤 다시 실행하세요. docs/local-https.md 참고.')
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

mkdirSync(caDir, { recursive: true, mode: 0o700 })
chmodSync(certDir, 0o700)
chmodSync(caDir, 0o700)

if (process.argv.includes('--install')) {
  run(['-install'])
} else {
  const cert = `${certDir}dev-cert.pem`
  const key = `${certDir}dev-key.pem`
  run(['-cert-file', cert, '-key-file', key, 'localhost', '127.0.0.1', '::1', ...addresses])
  chmodSync(key, 0o600)
  chmodSync(`${caDir}rootCA-key.pem`, 0o600)
  console.log('인증서 생성 완료. 신뢰 등록: npm run cert:trust (최초 1회)')
  for (const address of addresses) console.log(`공유 주소 (기본 포트): https://${address}:5173/`)
  console.log('다른 PC에는 .certs/ca/rootCA.pem만 전달하세요. 비밀키는 공유하지 마세요.')
}
