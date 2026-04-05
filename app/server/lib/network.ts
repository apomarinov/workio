import { execFileAsync } from './exec'

export async function getLocalIp(): Promise<string> {
  const { stdout } = await execFileAsync('ipconfig', ['getifaddr', 'en0'], {
    timeout: 5000,
  })
  return stdout.trim()
}
