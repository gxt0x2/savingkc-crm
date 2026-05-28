import { Linking } from 'react-native'

export type DialerResult = {
  provider: 'device_dialer'
  opened: boolean
}

export async function startOutboundCall(phone: string): Promise<DialerResult> {
  const normalized = phone.replace(/[^\d+]/g, '')
  const url = `tel:${normalized}`
  const supported = await Linking.canOpenURL(url)
  if (!supported) {
    throw new Error('This device cannot open the phone dialer.')
  }

  await Linking.openURL(url)
  return { provider: 'device_dialer', opened: true }
}
