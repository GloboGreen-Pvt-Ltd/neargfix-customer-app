import { AppState, Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { orderApi } from '../api/client';
import { getToken } from '../auth/session';

/* ══════════════════════════════════════════════════════════════════════════
   Remote push for the customer.
   ──────────────────────────────────────────────────────────────────────────
   After sign-in this device's push token (native FCM on Android, Expo on iOS)
   is registered with order-service (POST /push-tokens, app CUSTOMER, user taken
   from the JWT); sign-out removes it again. The server already pushes every
   customer_notifications row it raises (booking created by the shop, status
   updates, order placed) — until now no Customer device was registered, so
   those pushes had nowhere to go. They arrive on the 'default' channel with a
   `data.kind`, and a tap opens the screen it names (routeFor below).

   The app's own local notifications (systemNotify: login / OTP / sell quotes)
   are separate events, so a push never duplicates one of them.

   Everything here is best-effort and never throws: push must not be able to
   break sign-in. Skipped in Expo Go (no remote push there since SDK 53).
   ══════════════════════════════════════════════════════════════════════════ */
const inExpoGo = (() => {
  try { return isRunningInExpoGo(); } catch (_) { return false; }
})();

let Notifications = null;
if (!inExpoGo) {
  try { Notifications = require('expo-notifications'); } catch (_) { Notifications = null; }
}
let Device = null;
try { Device = require('expo-device'); } catch (_) { Device = null; }

/** Same id the server sends as `channelId` and app.config.js sets as `defaultChannel`. */
const CHANNEL_ID = 'default';
/** The token last registered for the signed-in customer — what sign-out removes. */
const TOKEN_KEY = 'push.deviceToken';

async function ensureChannel() {
  if (Platform.OS !== 'android' || !Notifications) return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Order updates',
      description: 'Bookings, repair status and orders.',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#035C6C',
    });
  } catch (_) {}
}

let inflight = null;
let tokenSub = null;

async function register(prompt) {
  // Emulators get no push token; web has no remote push here.
  if (!Notifications || Platform.OS === 'web' || Device?.isDevice === false) return null;
  try {
    if (!(await getToken())) return null;
    await ensureChannel();
    const allowed = (p) => p?.granted
      || p?.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    let perm = await Notifications.getPermissionsAsync();
    if (!allowed(perm) && prompt && perm?.canAskAgain !== false) perm = await Notifications.requestPermissionsAsync();
    if (!allowed(perm)) return null;

    // Android: the native FCM token, sent by the server with the Firebase Admin
    // SDK (needs google-services.json in the build). iOS: an Expo push token.
    let token = null;
    if (Platform.OS === 'android') {
      token = (await Notifications.getDevicePushTokenAsync())?.data;
    } else {
      const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      if (!projectId) return null;
      token = (await Notifications.getExpoPushTokenAsync({ projectId }))?.data;
    }
    if (!token || typeof token !== 'string') return null;

    await orderApi.post('/push-tokens', { body: { token, platform: Platform.OS, app: 'CUSTOMER' } });
    try { await AsyncStorage.setItem(TOKEN_KEY, token); } catch (_) {}
    // FCM/APNs can rotate the token; register the fresh one (no-op once signed out).
    if (!tokenSub) tokenSub = Notifications.addPushTokenListener(() => { registerForPush({ prompt: false }); });
    return token;
  } catch (_) {
    return null;
  }
}

/** Register this device for the signed-in customer's pushes. Never throws. */
export function registerForPush({ prompt = true } = {}) {
  if (!inflight) inflight = register(prompt).finally(() => { inflight = null; });
  return inflight;
}

/* Re-register (idempotent upsert) when the app returns to the foreground, at
   most every 10 minutes and without asking again — recovers a device that was
   offline at sign-in or granted the permission later in Settings. */
const REFRESH_MS = 10 * 60 * 1000;
let lastRefresh = 0;
let appStateSub = null;
function watchForeground() {
  if (appStateSub || !Notifications) return;
  try {
    appStateSub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' || Date.now() - lastRefresh < REFRESH_MS) return;
      lastRefresh = Date.now();
      registerForPush({ prompt: false });
    });
  } catch (_) {}
}

/** Stop pushes to this device. Call BEFORE the session is cleared (needs auth). */
export async function unregisterPush() {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) return;
    await AsyncStorage.removeItem(TOKEN_KEY);
    await Promise.race([
      orderApi.post('/push-tokens/remove', { body: { token } }),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
  } catch (_) {}
}

/* ── tap → screen (same targets as the Notifications screen) ──────────── */
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function routeFor(d) {
  const kind = String(d.kind || '').toUpperCase();
  const key = String(d.statusKey || '').toUpperCase();
  const bookingId = str(d.bookingId);
  if (kind === 'ORDER') {
    const orderId = str(d.orderId);
    return orderId ? ['BuyOrderDetails', { orderId }] : ['MyOrders', { initialTab: 'Buy', view: 'buy' }];
  }
  if (key.startsWith('SELL_')) {
    if (!bookingId) return ['MyOrders', { initialTab: 'Sell' }];
    if (key === 'SELL_QUOTE' || key === 'SELL_QUOTE_UPDATED') return ['SellQuotesReceived', { sellOrderId: bookingId }];
    if (key === 'SELL_PRICE_REVISED') return ['SellFinalOffer', { sellOrderId: bookingId }];
    return ['SellOrderDetails', { sellOrderId: bookingId }];
  }
  if (bookingId) return ['RepairOrderDetails', { bookingId, fromOrders: true }];
  return ['Notifications', undefined];
}

let navRef = null;
let pending = null;
const handled = new Set();

function flush() {
  if (!pending || !navRef?.isReady()) return;
  // These screens live in the signed-in stack; until it is mounted (Login,
  // app lock) the tap waits.
  if (!navRef.getRootState()?.routeNames?.includes(pending[0])) return;
  const [name, params] = pending;
  pending = null;
  navRef.navigate(name, params);
}

function onResponse(res) {
  const req = res?.notification?.request;
  const data = req?.content?.data || {};
  // Only server pushes; local notifications (systemNotify, downloads) route themselves.
  if (req?.trigger?.type !== 'push' && data.kind !== 'BOOKING_STATUS' && data.kind !== 'ORDER') return;
  const id = req?.identifier;
  if (id) {
    if (handled.has(id)) return;
    handled.add(id);
  }
  pending = routeFor(data);
  flush();
}

function lastResponse() {
  try {
    if (typeof Notifications.getLastNotificationResponse === 'function') {
      return Promise.resolve(Notifications.getLastNotificationResponse());
    }
  } catch (_) {}
  return Notifications.getLastNotificationResponseAsync
    ? Notifications.getLastNotificationResponseAsync()
    : Promise.resolve(null);
}

/**
 * Show pushes while the app is open, and open the right screen when one is
 * tapped (running, or the tap that cold-started the app). Call once from the
 * root with the NavigationContainer's ref. Returns a cleanup function.
 */
export function attachPushNavigation(navigationRef) {
  if (!Notifications) return undefined;
  navRef = navigationRef;
  ensureChannel();
  watchForeground();
  try {
    // Without a handler a push that arrives while the app is open is dropped.
    // systemNotify may replace this later with its own (also banner) handler.
    Notifications.setNotificationHandler({
      handleNotification: async (n) => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: n?.request?.trigger?.type === 'push',
        shouldSetBadge: false,
      }),
    });
    const sub = Notifications.addNotificationResponseReceivedListener(onResponse);
    const offReady = navigationRef.addListener('ready', flush);
    const offState = navigationRef.addListener('state', flush);
    lastResponse().then(onResponse).catch(() => {});
    return () => { sub.remove(); offReady(); offState(); };
  } catch (_) {
    return undefined;
  }
}
