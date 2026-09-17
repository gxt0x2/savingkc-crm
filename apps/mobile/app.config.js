module.exports = ({ config }) => {
  const projectId = process.env.EAS_PROJECT_ID?.trim() || config.extra?.eas?.projectId
  const owner = process.env.EXPO_OWNER?.trim() || config.owner

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
