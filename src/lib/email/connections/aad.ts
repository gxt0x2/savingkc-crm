export const webhookSecretAad = (
  workspace: string,
  endpoint: string,
  keyVersion = 1,
) => `${workspace}/${endpoint}/resend-webhook/${keyVersion}`
export const connectionSecretAad = (
  workspace: string,
  connectionId: string,
  keyVersion = 1,
) => `${workspace}/${connectionId}/resend/${keyVersion}`
