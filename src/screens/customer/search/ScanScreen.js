import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Easing, Image, Linking, PanResponder, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, scanFromURLAsync } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft, Zap, ZapOff, ImageUp, Keyboard as KeyboardIcon, QrCode, ScanBarcode, Camera,
  Smartphone, Store, Phone, ExternalLink, SearchX, RotateCcw, Wrench, Tag, ShoppingBag, Search,
} from 'lucide-react-native';
import { rf } from '../../../utils/responsive';
import { BRAND } from '../../../theme/brand';
import { resolveDeviceImageSource } from '../../../utils/images';
import { classifyScan, findOrderByCode, orderRoute, phoneKey } from '../../../utils/scanCode';
import { loadCatalog, modelRouteParams, norm } from '../../../utils/searchCatalog';
import { getModelByNumber, lookupImei, sendDeviceIdentifyFeedback } from '../../../api/masterData';
import { listMyOrders, getServiceTicket } from '../../../api/orders';
import { listShops, getShopBySlug } from '../../../api/shops';
import { detectProductFromPhoto, warmProductDetect } from '../../../lib/productDetect';

const GREEN_TEXT = '#035C6C';
const MINT = '#E5F3F5';
const MUTED = '#606E87';
const LINE = '#E8EAEE';
const BARCODE_TYPES = ['qr', 'datamatrix', 'ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14'];

const MODES = {
  qr: { title: 'Scan QR code', hint: 'Point at a NearGFix shop QR, a repair ticket label or any QR code', icon: QrCode },
  device: { title: 'Scan your device', hint: "Point at the barcode on your phone's box (model number or IMEI)", icon: ScanBarcode },
  product: { title: 'Search product by camera', hint: 'Point at the device (the back with the cameras works best) and tap the shutter', icon: Camera },
};

// The catalogue model whose model number matches a scanned code — exactly, or
// as the start of a box SKU that adds colour / region letters (SM-S918BZKCINS).
function modelForCode(catalog, code) {
  const c = norm(code).replace(/ /g, '');
  if (!catalog?.models || c.length < 4) return null;
  let best = null;
  let bestLen = 0;
  for (const m of catalog.models) {
    for (const n of m._nums || []) {
      if (n.length >= 4 && n.length > bestLen && c.startsWith(n)) { best = m; bestLen = n.length; }
    }
  }
  return best;
}

function Corners({ color }) {
  return (
    <>
      {[[0, 0], [0, 1], [1, 0], [1, 1]].map(([v, h]) => (
        <View key={`${v}${h}`} style={{
          position: 'absolute', width: 34, height: 34, borderColor: color,
          [v ? 'bottom' : 'top']: 0, [h ? 'right' : 'left']: 0,
          [v ? 'borderBottomWidth' : 'borderTopWidth']: 4, [h ? 'borderRightWidth' : 'borderLeftWidth']: 4,
          [`border${v ? 'Bottom' : 'Top'}${h ? 'Right' : 'Left'}Radius`]: 14,
        }} />
      ))}
    </>
  );
}

// ── Lens-style search area ──
// Where a frozen photo sits on screen: 'cover' = exactly like the camera
// preview it was taken from, 'contain' = a gallery photo fitted whole.
function imageFrame(shot, area) {
  const s = (shot.fit === 'cover' ? Math.max : Math.min)(area.w / shot.width, area.h / shot.height);
  return { s, x: (area.w - shot.width * s) / 2, y: (area.h - shot.height * s) / 2 };
}
const MIN_BOX = 72; // points
const clampRect = (r, L) => {
  const x0 = Math.max(r.x, L.x0); const y0 = Math.max(r.y, L.y0);
  return { x: x0, y: y0, w: Math.max(MIN_BOX, Math.min(r.x + r.w, L.x1) - x0), h: Math.max(MIN_BOX, Math.min(r.y + r.h, L.y1) - y0) };
};
// Corner drag resizes, inside drag moves — kept within the visible photo.
function dragRect({ corner, r }, dx, dy, L) {
  const mv = (d, a0, a1, l0, l1) => (a1 - a0 >= l1 - l0 ? 0 : Math.min(Math.max(d, l0 - a0), l1 - a1));
  if (!corner) return { ...r, x: r.x + mv(dx, r.x, r.x + r.w, L.x0, L.x1), y: r.y + mv(dy, r.y, r.y + r.h, L.y0, L.y1) };
  let x0 = r.x; let y0 = r.y; let x1 = r.x + r.w; let y1 = r.y + r.h;
  if (corner[1] === 'l') x0 = Math.min(Math.max(x0 + dx, L.x0), x1 - MIN_BOX); else x1 = Math.max(Math.min(x1 + dx, L.x1), x0 + MIN_BOX);
  if (corner[0] === 't') y0 = Math.min(Math.max(y0 + dy, L.y0), y1 - MIN_BOX); else y1 = Math.max(Math.min(y1 + dy, L.y1), y0 + MIN_BOX);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const DIM = 'rgba(0,0,0,0.5)';
function LensBox({ rect: r, scanning, sweep, hintTop }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: Math.max(0, r.y), backgroundColor: DIM }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: r.y + r.h, bottom: 0, backgroundColor: DIM }} />
      <View style={{ position: 'absolute', left: 0, width: Math.max(0, r.x), top: r.y, height: r.h, backgroundColor: DIM }} />
      <View style={{ position: 'absolute', left: r.x + r.w, right: 0, top: r.y, height: r.h, backgroundColor: DIM }} />
      <View style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: 14, overflow: 'hidden' }}>
        {scanning ? (
          <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 72, transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [-72, r.h] }) }] }}>
            <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.32)']} style={{ flex: 1 }} />
            <View style={{ height: 2, backgroundColor: '#FFFFFF' }} />
          </Animated.View>
        ) : null}
        <Corners color="#FFFFFF" />
      </View>
      {!scanning ? (
        <Text style={{ position: 'absolute', left: 0, right: 0, top: Math.max(hintTop + 4, r.y - 26), textAlign: 'center', fontSize: rf(12), fontWeight: '700', color: '#FFFFFF', textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 4 }}>
          Drag the corners to search another area
        </Text>
      ) : null}
    </View>
  );
}

// NOTE: Pressables take plain style objects only — NativeWind's cssInterop
// drops function-form `style={({ pressed }) => ...}` on native.
function SheetButton({ icon: Icon, label, onPress, primary }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="active:opacity-85"
      style={{
        flex: 1, height: 42, borderRadius: 12, marginHorizontal: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        backgroundColor: primary ? BRAND.green : '#FFFFFF', borderWidth: primary ? 0 : 1.5, borderColor: BRAND.green,
      }}
    >
      {Icon ? <Icon size={15} color={primary ? '#FFFFFF' : GREEN_TEXT} /> : null}
      <Text style={{ marginLeft: Icon ? 6 : 0, fontSize: rf(12.5), fontWeight: '800', color: primary ? '#FFFFFF' : GREEN_TEXT }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export default function ScanScreen({ navigation, route }) {
  // Home / Search camera opens "product" mode; anything else scans a device box.
  const [mode, setMode] = useState(route?.params?.mode === 'product' ? 'product' : 'device');
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [camReady, setCamReady] = useState(false);
  const [result, setResult] = useState(null); // { state, ... }
  const lockRef = useRef(false);
  const camRef = useRef(null);
  const isProduct = mode === 'product';
  const catalogRef = useRef(null);
  const M = MODES[mode];
  const granted = !!permission?.granted;
  const [camKey, setCamKey] = useState(0);
  // Lens-style freeze: the photo being searched ({ uri, width, height, fit,
  // source }) and the selected area on it, in photo pixels.
  const [shot, setShot] = useState(null);
  const [sel, setSel] = useState(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const rootRef = useRef(null);
  const vfRef = useRef(null);
  const selRef = useRef(null);
  const bounds = useRef({ top: 0, sheet: 0 }); // top bar / bottom sheet heights
  const live = useRef({});
  const drag = useRef(null);
  const scanning = result?.state === 'identifying';
  const sweep = useRef(new Animated.Value(0)).current;

  // Some Android phones never fire onCameraReady: don't leave the shutter dead
  // (a too-early tap just says "try again").
  useEffect(() => {
    if (!granted) return undefined;
    const t = setTimeout(() => setCamReady(true), 1500);
    return () => clearTimeout(t);
  }, [granted, camKey]);

  // Android drops the camera while the gallery / another app is in front; a
  // fresh preview on return avoids a black or frozen camera.
  useEffect(() => {
    let prev = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      if (prev === 'background' && next === 'active') { setCamReady(false); setCamKey((k) => k + 1); }
      prev = next;
    });
    return () => sub.remove();
  }, []);

  // Scan sweep over the selected area while it is being identified.
  useEffect(() => {
    if (!scanning || !shot) return undefined;
    sweep.setValue(0);
    const loop = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [scanning, shot, sweep]);

  useEffect(() => {
    if (permission && !permission.granted && permission.status === 'undetermined' && permission.canAskAgain !== false) requestPermission();
  }, [permission, requestPermission]);

  // Warm the catalogue so a scanned model number resolves to a full device.
  useEffect(() => { loadCatalog().then((c) => { catalogRef.current = c; }).catch(() => {}); }, []);
  // Product mode: build the detector's catalogue index before the first photo.
  useEffect(() => { if (isProduct) warmProductDetect(); }, [isProduct]);

  const reset = () => { lockRef.current = false; setResult(null); setShot(null); setSel(null); selRef.current = null; };
  const open = (name, params) => navigation.replace(name, params);

  const deviceFrom = async (m) => {
    const catalog = catalogRef.current || (await loadCatalog().catch(() => null));
    const full = catalog?.models?.find((x) => x.id === m.id) || m;
    return { model: full, params: modelRouteParams(catalog, full) };
  };

  async function resolve(raw) {
    const c = classifyScan(raw);
    setResult({ state: 'resolving', raw });
    try {
      if (c.kind === 'empty') return reset();
      if (c.kind === 'text') return open('Search', { q: c.text });
      if (c.kind === 'url') return setResult({ state: 'link', url: c.url, host: c.host });
      if (c.kind === 'phone') return setResult({ state: 'phone', phone: c.phone });

      if (c.kind === 'shopLink') {
        const shop = await getShopBySlug(c.slug).catch(() => null);
        if (shop?.id) return open('ShopDetails', { shopId: shop.id });
        return setResult({ state: 'link', url: c.url, host: 'ggfix.in' });
      }

      if (c.kind === 'vcard') {
        // A GGFIX shop QR: find the shop by its phone, else by its exact name.
        const list = c.name ? await listShops(c.name).catch(() => []) : [];
        const keys = new Set(c.phones.map(phoneKey));
        const byPhone = (list || []).find((s) => [s.mobile, s.phone, s.contactPhone, s.ownerPhone].some((p) => p && keys.has(phoneKey(p))));
        const byName = (list || []).filter((s) => String(s.name || s.shopName || '').trim().toLowerCase() === String(c.name || '').trim().toLowerCase());
        const shop = byPhone || (byName.length === 1 ? byName[0] : null);
        if (shop?.id) return open('ShopDetails', { shopId: shop.id });
        return setResult({ state: 'contact', name: c.name, phones: c.phones, address: c.address });
      }

      // Product search: model number / box SKU → that model's search results.
      if (mode === 'product' && (c.kind === 'code' || c.kind === 'imei')) {
        if (c.kind === 'imei') {
          const r = await lookupImei(c.imei);
          const name = r?.matched ? r.device?.modelName : null;
          if (name) return open('Search', { q: name });
          return setResult({ state: 'notFound', raw, typeOnly: true, message: "That's the IMEI barcode — it can't name the product. Scan the model-number barcode on the box (e.g. SM-S918B) or type the product name." });
        }
        const byNumber = await getModelByNumber(c.code).catch(() => null);
        if (byNumber?.name) return open('Search', { q: byNumber.name });
        const local = modelForCode(catalogRef.current || (await loadCatalog().catch(() => null)), c.code);
        if (local) return open('Search', { q: local.name });
        // Shop barcodes (EAN / UPC) carry no model — searching the digits finds nothing.
        if (/^\d{8,14}$/.test(c.code)) {
          return setResult({ state: 'notFound', raw, typeOnly: true, message: "This barcode isn't linked to a product. Scan the model-number barcode on the box (e.g. SM-S918B) or type the product name." });
        }
        return open('Search', { q: c.code });
      }

      if (c.kind === 'uuid' || c.kind === 'code') {
        const code = c.kind === 'uuid' ? c.id : c.code;
        const orders = await listMyOrders().catch(() => []);
        const order = findOrderByCode(orders, code);
        if (order) { const [name, params] = orderRoute(order); return open(name, params); }
        if (c.kind === 'uuid') {
          const ticket = await getServiceTicket(code).catch(() => null);
          if (ticket && (ticket.id || ticket.trackingId)) return open('ServiceTicketDetails', { ticketId: code, fromOrders: true });
          return setResult({ state: 'notFound', raw, message: "This code isn't linked to any of your orders." });
        }
        const model = await getModelByNumber(code);
        if (model?.id) return setResult({ state: 'device', ...(await deviceFrom(model)) });
        return setResult({ state: 'notFound', raw, message: "We couldn't match this code to an order or a device." });
      }

      if (c.kind === 'imei') {
        const r = await lookupImei(c.imei);
        const d = r?.matched ? r.device : null;
        if (d?.modelId) {
          return setResult({ state: 'device', ...(await deviceFrom({ id: d.modelId, name: d.modelName, brandId: d.brandId, categoryId: d.categoryId, imageUrl: d.imageUrl })) });
        }
        return setResult({ state: 'notFound', raw, message: "We couldn't identify the model from this IMEI yet. Search for your model instead." });
      }
      return reset();
    } catch (_) {
      return setResult({ state: 'notFound', raw, message: 'Something went wrong while checking this code. Please try again.' });
    }
  }

  // Product mode: identify the actual device in a photo, then offer Repair /
  // Sell / Buy for the model the user confirms.
  const identify = async (photo, source) => {
    lockRef.current = true;
    setResult({ state: 'identifying' });
    try {
      // Shared detector (lib/productDetect, same as the Partner app): printed
      // model number → the model's whole name in the photo's text → the
      // server's genuine matches (look, AI, OCR). Only a VERIFIED model is
      // shown as the exact model; anything less is a list the user picks from.
      const r = await detectProductFromPhoto(photo.uri, { width: photo.width, height: photo.height }, { source });
      if (r.status === 'none') {
        // Never a guess and never a jump: say so, and offer manual search
        // (prefilled with what was recognised — a brand, a name).
        const busy = r.serverError === 'RATE_LIMITED';
        return setResult({
          state: 'notIdentified',
          q: r.label ? String(r.label) : '',
          message: busy
            ? `Product recognition is busy right now${r.retryAfterSeconds ? ` — try again in ${r.retryAfterSeconds}s` : ' — try again in a moment'}, or search for your model.`
            : r.label
              ? `Looks like ${r.label}, but the exact model couldn't be confirmed. Search for your model, or retake the photo showing the back cameras or the box label.`
              : 'Fill the frame with the device (the back with the cameras, or its box label) in good light and try again, or search for your model.',
        });
      }
      const items = await Promise.all(r.candidates.map(async (c) => ({
        match: { id: c.id, model: c.name, brand: c.brand, imageUrl: c.ref?.imageUrl || null },
        score: c.confidence,
        ...(await deviceFrom(c.ref)),
      })));
      const exact = r.status === 'exact';
      return setResult({
        state: 'product',
        exact,
        confidence: exact ? 'high' : 'medium',
        items,
        // Exact: that one model is shown (still a tap to continue). Possible
        // matches: nothing is pre-picked — the user chooses.
        pick: exact ? 0 : null,
        scanId: r.scanId || null,
        q: r.label ? String(r.label) : '',
      });
    } catch (_) {
      return setResult({
        state: 'notFound',
        typeOnly: true,
        message: "Can't load the product catalogue. Check your connection and try again, or type the name.",
      });
    }
  };

  // Searches only the selected part of the photo: less background for the
  // matcher, and a small model label keeps its full resolution for OCR.
  const searchArea = async (s, box) => {
    setResult({ state: 'identifying' });
    const x = Math.max(0, Math.round(box.x));
    const y = Math.max(0, Math.round(box.y));
    const w = Math.min(s.width - x, Math.round(box.w));
    const h = Math.min(s.height - y, Math.round(box.h));
    let photo = { uri: s.uri, width: s.width, height: s.height };
    if (w > 32 && h > 32 && w * h < s.width * s.height * 0.96) {
      try {
        const out = await ImageManipulator.manipulateAsync(s.uri, [{ crop: { originX: x, originY: y, width: w, height: h } }], { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG });
        photo = { uri: out.uri, width: out.width, height: out.height };
      } catch (_) { /* search the whole photo */ }
    }
    return identify(photo, s.source);
  };

  // Freeze a photo on screen with its starting selection, then search it.
  const showShot = (s, box) => {
    selRef.current = box;
    setShot(s);
    setSel(box);
    return searchArea(s, box);
  };

  const measure = (ref) => new Promise((res) => (ref.current ? ref.current.measureInWindow((x, y, w, h) => res({ x, y, w, h })) : res(null)));

  const capture = async () => {
    if (lockRef.current || !camRef.current || !camReady) return;
    lockRef.current = true;
    setResult({ state: 'identifying' });
    try {
      const [root, vf] = await Promise.all([measure(rootRef), measure(vfRef)]);
      const pic = await camRef.current.takePictureAsync({ quality: 0.8, shutterSound: false });
      if (!pic?.uri || !pic.width || !pic.height) throw new Error('no photo');
      const s = { uri: pic.uri, width: pic.width, height: pic.height, fit: 'cover', source: 'CAMERA' };
      // Start with what was framed in the corners (+8% margin), in photo pixels.
      let box = { x: 0, y: 0, w: s.width, h: s.height };
      if (root?.w && root?.h && vf?.w) {
        const f = imageFrame(s, root);
        const x0 = Math.max(0, (vf.x - root.x - vf.w * 0.08 - f.x) / f.s);
        const y0 = Math.max(0, (vf.y - root.y - vf.h * 0.08 - f.y) / f.s);
        const x1 = Math.min(s.width, (vf.x - root.x + vf.w * 1.08 - f.x) / f.s);
        const y1 = Math.min(s.height, (vf.y - root.y + vf.h * 1.08 - f.y) / f.s);
        if (x1 - x0 > 32 && y1 - y0 > 32) box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      await showShot(s, box);
    } catch (_) {
      setResult({ state: 'notFound', typeOnly: true, message: "Couldn't take the photo. Please try again." });
    }
  };

  const onScanned = ({ data }) => {
    if (lockRef.current || !data) return;
    lockRef.current = true;
    resolve(String(data));
  };

  const fromGallery = async () => {
    try {
      const pick = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.8 });
      if (pick.canceled || !pick.assets?.[0]?.uri) return;
      if (isProduct) {
        const a = pick.assets[0];
        if (!a.width || !a.height) return identify({ uri: a.uri, mimeType: a.mimeType }, 'GALLERY');
        return showShot({ uri: a.uri, width: a.width, height: a.height, fit: 'contain', source: 'GALLERY' }, { x: 0, y: 0, w: a.width, h: a.height });
      }
      lockRef.current = true;
      setResult({ state: 'resolving', raw: '' });
      const found = await scanFromURLAsync(pick.assets[0].uri, BARCODE_TYPES).catch(() => []);
      if (found?.[0]?.data) return resolve(String(found[0].data));
      return setResult({ state: 'notFound', raw: '', message: 'No QR code or barcode found in that photo.' });
    } catch (_) {
      lockRef.current = false;
    }
  };

  const typeInstead = () => navigation.replace('Search', {});

  // On-screen box of the selection (null while the camera is live).
  const frame = shot && area.w ? imageFrame(shot, area) : null;
  const rect = frame && sel ? { x: frame.x + sel.x * frame.s, y: frame.y + sel.y * frame.s, w: sel.w * frame.s, h: sel.h * frame.s } : null;
  live.current = {
    shot, frame, rect, area, scanning,
    endDrag: () => {
      const d = drag.current;
      drag.current = null;
      if (d?.moved && shot && selRef.current) searchArea(shot, selRef.current);
    },
  };
  // Lens-style box: drag a corner to resize or the inside to move; letting go
  // searches the new area.
  const panRef = useRef(null);
  if (!panRef.current) {
    panRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => !!live.current.rect && !live.current.scanning,
      onMoveShouldSetPanResponder: () => !!live.current.rect && !live.current.scanning,
      onPanResponderGrant: (e) => {
        const { rect: R, frame: f, shot: s, area: a } = live.current;
        const { locationX: px, locationY: py } = e.nativeEvent;
        const near = (x, y) => Math.abs(px - x) < 36 && Math.abs(py - y) < 36;
        const corner = near(R.x, R.y) ? 'tl' : near(R.x + R.w, R.y) ? 'tr' : near(R.x, R.y + R.h) ? 'bl' : near(R.x + R.w, R.y + R.h) ? 'br' : null;
        const inside = px > R.x && px < R.x + R.w && py > R.y && py < R.y + R.h;
        const L = {
          x0: Math.max(0, f.x), x1: Math.min(a.w, f.x + s.width * f.s),
          y0: Math.max(bounds.current.top, f.y), y1: Math.min(a.h - bounds.current.sheet, f.y + s.height * f.s),
        };
        drag.current = corner || inside ? { corner, r: clampRect(R, L), L, moved: false } : null;
      },
      onPanResponderMove: (_, g) => {
        const d = drag.current;
        const f = live.current.frame;
        if (!d || !f) return;
        if (Math.abs(g.dx) + Math.abs(g.dy) > 4) d.moved = true;
        const n = dragRect(d, g.dx, g.dy, d.L);
        selRef.current = { x: (n.x - f.x) / f.s, y: (n.y - f.y) / f.s, w: n.w / f.s, h: n.h / f.s };
        setSel(selRef.current);
      },
      onPanResponderRelease: () => live.current.endDrag(),
      onPanResponderTerminate: () => live.current.endDrag(),
    });
  }

  // ── result card (bottom sheet) ──
  const renderResult = () => {
    const r = result;
    if (r.state === 'identifying') {
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14 }}>
          <ActivityIndicator color={BRAND.green} />
          <Text style={{ marginLeft: 9, fontSize: rf(13), fontWeight: '700', color: BRAND.ink }}>Identifying product…</Text>
        </View>
      );
    }
    if (r.state === 'resolving') {
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14 }}>
          <ActivityIndicator color={BRAND.green} />
          <Text style={{ marginLeft: 9, fontSize: rf(13), fontWeight: '700', color: BRAND.ink }}>Checking code…</Text>
        </View>
      );
    }
    const Head = ({ icon: Icon, title, sub, img }) => (
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <View style={{ height: 46, width: 46, borderRadius: 12, backgroundColor: img ? '#FFFFFF' : MINT, borderWidth: 1, borderColor: BRAND.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginRight: 10 }}>
          {img ? <Image source={{ uri: img }} style={{ width: 42, height: 42 }} resizeMode="contain" /> : <Icon size={20} color={GREEN_TEXT} />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: rf(14), fontWeight: '800', color: BRAND.ink }} numberOfLines={2}>{title}</Text>
          {sub ? <Text style={{ fontSize: rf(11.5), color: MUTED, marginTop: 1 }} numberOfLines={2}>{sub}</Text> : null}
        </View>
      </View>
    );
    if (r.state === 'product') {
      const fullName = (it) => {
        const n = it.model.name || it.match.model;
        const b = it.params.brandName || it.match.brand;
        return b && !String(n).toLowerCase().startsWith(String(b).toLowerCase()) ? `${b} ${n}` : n;
      };
      // The pick goes back to the server (metrics / confidence calibration),
      // then the existing booking flow continues unchanged.
      const go = (it, i, name, params) => {
        sendDeviceIdentifyFeedback(r.scanId, { modelId: it.match.id, rank: i });
        open(name, params);
      };
      const cur = r.pick == null ? null : r.items[r.pick];
      const manual = (
        <Pressable onPress={() => open('Search', { q: r.q || '' })} accessibilityRole="button" className="active:opacity-80" style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 6 }}>
          <Search size={13} color={GREEN_TEXT} />
          <Text style={{ marginLeft: 5, fontSize: rf(12), fontWeight: '800', color: GREEN_TEXT }}>Not listed? Search manually</Text>
        </Pressable>
      );
      // Possible matches, nothing picked yet: the genuine candidates, each with
      // its catalogue image and how sure the scan is.
      if (!cur) {
        return (
          <>
            <Head icon={SearchX} title="Exact model not identified" sub="Possible matches — tap yours to continue" />
            {r.items.map((it, i) => (
              <Pressable
                key={it.match.id}
                onPress={() => setResult({ ...r, pick: i })}
                accessibilityRole="button"
                accessibilityLabel={`Choose ${fullName(it)}`}
                className="active:opacity-80"
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, marginBottom: 6, borderRadius: 12, borderWidth: 1, borderColor: LINE }}
              >
                {it.params.modelImageUrl || it.match.imageUrl
                  ? <Image source={{ uri: it.params.modelImageUrl || it.match.imageUrl }} style={{ width: 38, height: 38, marginRight: 10 }} resizeMode="contain" />
                  : <Smartphone size={22} color={GREEN_TEXT} style={{ marginRight: 10 }} />}
                <Text style={{ flex: 1, fontSize: rf(13), fontWeight: '800', color: BRAND.ink }} numberOfLines={2}>{fullName(it)}</Text>
                <Text style={{ marginLeft: 8, fontSize: rf(11.5), fontWeight: '800', color: MUTED }}>{Math.round((it.score || 0) * 100)}%</Text>
              </Pressable>
            ))}
            {manual}
          </>
        );
      }
      const p = cur.params;
      const name = cur.model.name || cur.match.model;
      const verified = r.exact && r.pick === 0;
      return (
        <>
          <Head
            icon={Smartphone}
            title={fullName(cur)}
            sub={verified ? 'Exact model identified · Verified' : `You picked this · ${Math.round((cur.score || 0) * 100)}% match`}
            img={p.modelImageUrl || cur.match.imageUrl}
          />
          <View style={{ flexDirection: 'row', marginHorizontal: -4 }}>
            <SheetButton primary icon={Wrench} label="Repair" onPress={() => go(cur, r.pick, 'SelectVariant', { flow: 'REPAIR', ...p })} />
            {cur.model.sellActive !== false ? <SheetButton icon={Tag} label="Sell" onPress={() => go(cur, r.pick, 'SelectVariant', { flow: 'SELL', ...p })} /> : null}
            <SheetButton icon={ShoppingBag} label="Buy" onPress={() => go(cur, r.pick, 'BuyListing', { title: name, q: name, categoryId: p.categoryId, categoryCode: p.categoryCode })} />
          </View>
          {r.items.length > 1 ? (
            <>
              <Text style={{ marginTop: 12, marginBottom: 6, fontSize: rf(11), fontWeight: '700', color: MUTED }}>{verified ? 'Not this one?' : 'Other possible matches'}</Text>
              <View style={{ flexDirection: 'row', marginHorizontal: -3 }}>
                {r.items.map((it, i) => (i === r.pick ? null : (
                  <Pressable
                    key={it.match.id}
                    onPress={() => setResult({ ...r, pick: i })}
                    accessibilityRole="button"
                    accessibilityLabel={`Choose ${it.model.name || it.match.model}`}
                    className="active:opacity-80"
                    style={{ flex: 1, marginHorizontal: 3, alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4, borderRadius: 10, borderWidth: 1, borderColor: LINE }}
                  >
                    {it.match.imageUrl ? <Image source={{ uri: it.match.imageUrl }} style={{ width: 34, height: 34 }} resizeMode="contain" /> : <Smartphone size={20} color={GREEN_TEXT} />}
                    <Text numberOfLines={2} style={{ marginTop: 3, fontSize: rf(9.5), fontWeight: '700', color: BRAND.ink, textAlign: 'center' }}>{it.model.name || it.match.model}</Text>
                  </Pressable>
                )))}
              </View>
            </>
          ) : null}
          {manual}
        </>
      );
    }
    if (r.state === 'notIdentified') {
      return (
        <>
          <Head icon={SearchX} title="Exact model not identified" sub={r.message} />
          {/* "Take another photo" sits under every result already. */}
          <View style={{ flexDirection: 'row', marginHorizontal: -4 }}>
            <SheetButton primary icon={Search} label="Search manually" onPress={() => open('Search', { q: r.q || '' })} />
          </View>
        </>
      );
    }
    if (r.state === 'device') {
      const p = r.params;
      return (
        <>
          <Head icon={Smartphone} title={r.model.name} sub={[p.brandName, p.categoryName].filter(Boolean).join(' · ')} img={p.modelImageUrl} />
          <View style={{ flexDirection: 'row', marginHorizontal: -4 }}>
            <SheetButton primary icon={Wrench} label="Repair" onPress={() => open('SelectVariant', { flow: 'REPAIR', ...p })} />
            {r.model.sellActive !== false ? <SheetButton icon={Tag} label="Sell" onPress={() => open('SelectVariant', { flow: 'SELL', ...p })} /> : null}
            <SheetButton icon={ShoppingBag} label="Buy" onPress={() => open('BuyListing', { title: r.model.name, q: r.model.name, categoryId: p.categoryId, categoryCode: p.categoryCode })} />
          </View>
        </>
      );
    }
    if (r.state === 'contact') {
      const phone = r.phones[0];
      return (
        <>
          <Head icon={Store} title={r.name || 'Contact'} sub={[phone, r.address].filter(Boolean).join(' · ')} />
          <View style={{ flexDirection: 'row', marginHorizontal: -4 }}>
            {phone ? <SheetButton primary icon={Phone} label="Call" onPress={() => Linking.openURL(`tel:${String(phone).replace(/\s+/g, '')}`)} /> : null}
            {r.name ? <SheetButton icon={Search} label="Find shop" onPress={() => open('Search', { q: r.name })} /> : null}
          </View>
        </>
      );
    }
    if (r.state === 'phone') {
      return (
        <>
          <Head icon={Phone} title={r.phone} sub="Phone number" />
          <View style={{ flexDirection: 'row', marginHorizontal: -4 }}>
            <SheetButton primary icon={Phone} label="Call" onPress={() => Linking.openURL(`tel:${String(r.phone).replace(/\s+/g, '')}`)} />
          </View>
        </>
      );
    }
    if (r.state === 'link') {
      return (
        <>
          <Head icon={ExternalLink} title={r.host || 'Link'} sub={r.url} />
          <View style={{ flexDirection: 'row', marginHorizontal: -4 }}>
            <SheetButton primary icon={ExternalLink} label="Open link" onPress={() => Linking.openURL(r.url)} />
          </View>
        </>
      );
    }
    // notFound
    return (
      <>
        <Head icon={SearchX} title="No match found" sub={r.message} />
        {r.raw ? <Text style={{ fontSize: rf(11), color: MUTED, marginTop: -6, marginBottom: 10 }} numberOfLines={1} selectable>Scanned: {r.raw}</Text> : null}
        <View style={{ flexDirection: 'row', marginHorizontal: -4 }}>
          {r.typeOnly ? (
            <SheetButton primary icon={KeyboardIcon} label="Type product name" onPress={typeInstead} />
          ) : (
            <SheetButton primary icon={Search} label={r.raw ? 'Search this' : 'Search'} onPress={() => open('Search', { q: r.raw || '' })} />
          )}
        </View>
      </>
    );
  };

  return (
    <View ref={rootRef} collapsable={false} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} style={{ flex: 1, backgroundColor: '#000000' }}>
      {granted ? (
        <CameraView
          key={camKey}
          ref={camRef}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          facing="back"
          enableTorch={torch && !shot}
          onCameraReady={() => setCamReady(true)}
          barcodeScannerSettings={isProduct ? undefined : { barcodeTypes: BARCODE_TYPES }}
          onBarcodeScanned={isProduct || result ? undefined : onScanned}
        />
      ) : null}

      {/* Frozen photo + selection box (Lens-style) */}
      {shot && rect ? (
        <>
          <Image source={{ uri: shot.uri }} resizeMode={shot.fit} resizeMethod="resize" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000' }} />
          <LensBox rect={rect} scanning={scanning} sweep={sweep} hintTop={bounds.current.top} />
          <View collapsable={false} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} {...panRef.current.panHandlers} />
        </>
      ) : null}

      {/* Top bar */}
      <SafeAreaView edges={['top']} onLayout={(e) => { bounds.current.top = e.nativeEvent.layout.height; }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 6 }}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back" className="active:opacity-70"
            style={{ height: 38, width: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' }}>
            <ArrowLeft size={20} color="#FFFFFF" />
          </Pressable>
          <Text style={{ flex: 1, textAlign: 'center', fontSize: rf(16), fontWeight: '800', color: '#FFFFFF' }}>{M.title}</Text>
          {granted && !shot && Platform.OS !== 'web' ? (
            <Pressable onPress={() => setTorch((t) => !t)} hitSlop={8} accessibilityRole="button" accessibilityLabel={torch ? 'Torch off' : 'Torch on'} className="active:opacity-70"
              style={{ height: 38, width: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: torch ? BRAND.yellow : 'rgba(255,255,255,0.18)' }}>
              {torch ? <Zap size={18} color={BRAND.ink} /> : <ZapOff size={18} color="#FFFFFF" />}
            </Pressable>
          ) : <View style={{ width: 38 }} />}
        </View>

      </SafeAreaView>

      {/* Viewfinder / permission */}
      <View pointerEvents={shot ? 'none' : 'box-none'} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        {shot ? null : granted ? (
          <>
            <View ref={vfRef} collapsable={false} style={{ width: isProduct ? 250 : 236, height: isProduct ? 300 : mode === 'qr' ? 236 : 150 }}>
              <Corners color={isProduct ? '#FFFFFF' : BRAND.green} />
            </View>
            <Text style={{ marginTop: 16, fontSize: rf(12.5), color: '#FFFFFF', textAlign: 'center', lineHeight: rf(18), textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 }}>{M.hint}</Text>
          </>
        ) : permission ? (
          <View style={{ width: '100%', maxWidth: 360, borderRadius: 18, padding: 16, alignItems: 'center', backgroundColor: '#FFFFFF' }}>
            <View style={{ height: 52, width: 52, borderRadius: 26, backgroundColor: MINT, alignItems: 'center', justifyContent: 'center' }}>
              <Camera size={24} color={GREEN_TEXT} />
            </View>
            <Text style={{ marginTop: 10, fontSize: rf(15), fontWeight: '800', color: BRAND.ink, textAlign: 'center' }}>Allow camera to scan</Text>
            <Text style={{ marginTop: 4, fontSize: rf(12), color: MUTED, textAlign: 'center', lineHeight: rf(17) }}>
              GGFIX uses the camera only to read QR codes and barcodes. You can also pick a photo from your gallery.
            </Text>
            <View style={{ flexDirection: 'row', alignSelf: 'stretch', marginTop: 14, marginHorizontal: -4 }}>
              {permission.canAskAgain !== false ? (
                <SheetButton primary icon={Camera} label="Allow camera" onPress={requestPermission} />
              ) : (
                <SheetButton primary icon={Camera} label="Open settings" onPress={() => Linking.openSettings?.()} />
              )}
            </View>
          </View>
        ) : (
          <ActivityIndicator color="#FFFFFF" />
        )}
      </View>

      {/* Bottom sheet */}
      <SafeAreaView edges={['bottom']} onLayout={(e) => { bounds.current.sheet = e.nativeEvent.layout.height; }} style={{ backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
        <View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 }}>
          {result ? (
            <>
              {renderResult()}
              {result.state !== 'resolving' && result.state !== 'identifying' ? (
                <Pressable onPress={reset} accessibilityRole="button" accessibilityLabel="Scan again" className="active:opacity-70" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingVertical: 6 }}>
                  <RotateCcw size={14} color={GREEN_TEXT} />
                  <Text style={{ marginLeft: 6, fontSize: rf(12.5), fontWeight: '800', color: GREEN_TEXT }}>{isProduct ? 'Take another photo' : 'Scan again'}</Text>
                </Pressable>
              ) : null}
            </>
          ) : isProduct ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }}>
              <Pressable onPress={fromGallery} accessibilityRole="button" accessibilityLabel="Pick a photo" className="active:opacity-70" style={{ alignItems: 'center', width: 80 }}>
                <View style={{ height: 44, width: 44, borderRadius: 22, backgroundColor: MINT, alignItems: 'center', justifyContent: 'center' }}><ImageUp size={20} color={GREEN_TEXT} /></View>
                <Text style={{ marginTop: 4, fontSize: rf(11), fontWeight: '700', color: BRAND.ink }}>Gallery</Text>
              </Pressable>
              <Pressable
                onPress={capture}
                disabled={!granted || !camReady}
                accessibilityRole="button"
                accessibilityLabel="Take photo to identify product"
                className="active:opacity-80"
                style={{ height: 70, width: 70, borderRadius: 35, borderWidth: 4, borderColor: BRAND.green, alignItems: 'center', justifyContent: 'center', opacity: granted && camReady ? 1 : 0.4 }}
              >
                <View style={{ height: 54, width: 54, borderRadius: 27, backgroundColor: BRAND.green, alignItems: 'center', justifyContent: 'center' }}>
                  <Camera size={24} color="#FFFFFF" />
                </View>
              </Pressable>
              <Pressable onPress={typeInstead} accessibilityRole="button" accessibilityLabel="Type instead" className="active:opacity-70" style={{ alignItems: 'center', width: 80 }}>
                <View style={{ height: 44, width: 44, borderRadius: 22, backgroundColor: MINT, alignItems: 'center', justifyContent: 'center' }}><KeyboardIcon size={20} color={GREEN_TEXT} /></View>
                <Text style={{ marginTop: 4, fontSize: rf(11), fontWeight: '700', color: BRAND.ink }}>Type</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', marginHorizontal: -4 }}>
              <SheetButton icon={ImageUp} label="Upload photo" onPress={fromGallery} />
              <SheetButton icon={KeyboardIcon} label="Type instead" onPress={typeInstead} />
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
