module.exports = ({ config }) => {
  const projectId = process.env.EAS_PROJECT_ID?.trim()
  const owner = process.env.EXPO_OWNER?.trim()

  return {
    ...config,
    ...(owner ? { owner } : {}),
    scheme: 'savingkc',
    runtimeVersion: { policy: 'appVersion' },
    ...(projectId ? {
      updates: { url: `https://u.expo.dev/${projectId}` },
      extra: {
        ...(config.extra || {}),
        eas: { projectId },
      },
    } : {}),
    ios: {
      ...config.ios,
      entitlements: {
        ...(config.ios?.entitlements || {}),
        'aps-environment': 'production',
      },
    },
  }
}
