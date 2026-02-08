import { useIntl } from '@umijs/max';
import { message, notification } from '@/ea/eaConsole';
import defaultSettings from '../config/defaultSettings';

const { pwa } = defaultSettings;
// Service workers are allowed on HTTPS and on localhost.
// Treat localhost as secure to ensure we can unregister stale SWs during development.
const isSecureContextForSW =
  document.location.protocol === 'https:' ||
  document.location.hostname === 'localhost' ||
  document.location.hostname === '127.0.0.1' ||
  document.location.hostname === '[::1]';

// If a previous session stored a non-English locale, force it back to en-US.
// This prevents the UI from “sticking” to zh-CN even after changing the default.
try {
  const savedLocale = window.localStorage?.getItem('umi_locale');
  if (savedLocale && savedLocale !== 'en-US') {
    window.localStorage.setItem('umi_locale', 'en-US');
  }
} catch {
  // ignore
}

const clearCache = () => {
  // remove all caches
  if (window.caches) {
    caches
      .keys()
      .then((keys) => {
        keys.forEach((key) => {
          caches.delete(key);
        });
      })
      .catch((e) => console.log(e));
  }
};

// if pwa is true
if (pwa) {
  // Notify user if offline now
  window.addEventListener('sw.offline', () => {
    message.warning(useIntl().formatMessage({ id: 'app.pwa.offline' }));
  });

  // Log a console entry when a new service worker is available
  window.addEventListener('sw.updated', (event: Event) => {
    void event;
    notification.open({
      message: useIntl().formatMessage({ id: 'app.pwa.serviceworker.updated' }),
      description: useIntl().formatMessage({
        id: 'app.pwa.serviceworker.updated.hint',
      }),
      domain: 'system',
    });
  });
} else if ('serviceWorker' in navigator && isSecureContextForSW) {
  // unregister service worker
  const { serviceWorker } = navigator;
  if (serviceWorker.getRegistrations) {
    serviceWorker.getRegistrations().then((sws) => {
      sws.forEach((sw) => {
        sw.unregister();
      });
    });
  }
  serviceWorker.getRegistration().then((sw) => {
    if (sw) sw.unregister();
  });

  clearCache();
}
