// Saving KC CRM - Push Notification Service Worker

// Self-update: skip waiting and claim clients immediately
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Handle incoming push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return

  let data
  try {
    data = event.data.json()
  } catch (e) {
    data = {
      title: 'Saving KC CRM',
      body: event.data.text(),
    }
  }

  const { title, body, icon, url, tag } = data

  const options = {
    body: body || '',
    icon: icon || '/logo.png',
    badge: '/logo.png',
    tag: tag || 'savingkc-default',
    renotify: true,
    data: {
      url: url || '/',
    },
  }

  event.waitUntil(self.registration.showNotification(title || 'Saving KC CRM', options))
})

// Handle notification click - open/focus the URL from payload
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If there's already a window open at this URL, focus it
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus()
        }
      }
      // Otherwise focus any existing window and navigate, or open a new one
      for (const client of clientList) {
        if ('focus' in client && 'navigate' in client) {
          return client.focus().then((c) => c.navigate(targetUrl))
        }
      }
      // No existing windows, open a new one
      return self.clients.openWindow(targetUrl)
    })
  )
})
