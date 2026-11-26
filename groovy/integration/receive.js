// Register this callback using the documented mechanism of your installation.
// Both arguments are values supplied by the host, never fragments of JavaScript.
function receiveAnalyticsPayload(payload, trustedOptions) {
  if (typeof payload !== 'string' || payload.length > 16 * 1024 * 1024) {
    throw new Error('Некорректный размер пакета');
  }
  return window.NSDAnalytics.open(JSON.parse(payload), trustedOptions);
}
