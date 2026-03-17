import { getSettings, updateSettings } from './db'

export async function getOrCreateVapidKeys() {
  const settings = await getSettings()
  if (settings.vapid_public_key && settings.vapid_private_key) {
    return {
      publicKey: settings.vapid_public_key,
      privateKey: settings.vapid_private_key,
    }
  }
  const webPush = await import('web-push')
  const keys = webPush.default.generateVAPIDKeys()
  await updateSettings({
    vapid_public_key: keys.publicKey,
    vapid_private_key: keys.privateKey,
  })
  return { publicKey: keys.publicKey, privateKey: keys.privateKey }
}
