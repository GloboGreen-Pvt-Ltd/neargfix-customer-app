import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, UIManager, View } from 'react-native';
import Constants from 'expo-constants';
import { MapPin, Search } from 'lucide-react-native';
import { authApi } from '../api/client';
import { BRAND } from '../theme/brand';

// Google address search + compact map for the address form.
// Search: backend Places proxy (/auth/places/*, server-restricted key) —
// Google rejects the Android-restricted Maps key on the Places REST API.
// Map: react-native-maps with the Android Maps key from app.config.js; hidden
// (search still works) when this build has no native map module or key.

let Maps = null;
try { Maps = require('react-native-maps'); } catch (_) { Maps = null; }
const HAS_MAP = Platform.OS === 'android'
  && !!Constants.expoConfig?.android?.config?.googleMaps?.apiKey
  && !!Maps && !!UIManager.hasViewManagerConfig?.('AIRMap');
const INDIA = { latitude: 20.5937, longitude: 78.9629 };
const TEAL = '#035C6C';
const newSession = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * onPlace(details) — a Google suggestion was picked:
 *   { placeId, name, address, area, city, district, state, pincode, latitude, longitude }
 * onPin({ latitude, longitude }) — the pin was dragged / the map tapped.
 */
export default function AddressPlaceSearch({ latitude, longitude, onPlace, onPin }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const session = useRef(newSession());
  const lastQ = useRef('');
  const mapRef = useRef(null);
  const has = latitude != null && longitude != null;
  const center = has ? { latitude: Number(latitude), longitude: Number(longitude) } : INDIA;

  useEffect(() => {
    const text = q.trim();
    if (text.length < 3 || text === lastQ.current) { if (text.length < 3) setItems([]); return undefined; }
    let alive = true;
    const t = setTimeout(async () => {
      lastQ.current = text; // no duplicate request for the same text
      try {
        const r = await authApi.get(`/auth/places/autocomplete?q=${encodeURIComponent(text)}&session=${session.current}`);
        if (!alive) return;
        const s = r?.suggestions || [];
        setItems(s.slice(0, 5));
        setErr(s.length ? null : 'No matches — enter the address below.');
      } catch (e) {
        if (alive) { setItems([]); setErr('Google search unavailable — enter the address below.'); }
      }
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    if (has) mapRef.current?.animateToRegion?.({ ...center, latitudeDelta: 0.004, longitudeDelta: 0.004 }, 300);
  }, [latitude, longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (it) => {
    setBusy(true);
    try {
      const d = await authApi.get(`/auth/places/details/${encodeURIComponent(it.placeId)}?session=${session.current}`);
      session.current = newSession();
      setItems([]); setQ(''); lastQ.current = ''; setErr(null);
      onPlace?.(d);
    } catch (_) {
      setErr('Could not load that place — try again or enter it manually.');
    } finally { setBusy(false); }
  };

  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 44, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB', paddingHorizontal: 10 }}>
        <Search size={16} color="#7A7A7A" />
        <TextInput value={q} onChangeText={setQ} placeholder="Search area, street, building…" placeholderTextColor="#9CA3AF"
          accessibilityLabel="Search address on Google" style={{ flex: 1, marginLeft: 8, fontSize: 14, color: BRAND.ink }} />
        {busy ? <ActivityIndicator size="small" color={TEAL} /> : null}
      </View>
      {items.length ? (
        <View style={{ marginTop: 4, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF', overflow: 'hidden' }}>
          {items.map((it) => (
            <Pressable key={it.placeId} onPress={() => pick(it)} disabled={busy}
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
              <MapPin size={15} color={TEAL} />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: BRAND.ink }} numberOfLines={1}>{it.main}</Text>
                {it.secondary ? <Text style={{ fontSize: 11, color: '#6B7280' }} numberOfLines={1}>{it.secondary}</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {err ? <Text style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>{err}</Text> : null}
      {HAS_MAP ? (
        <View style={{ height: 170, borderRadius: 12, overflow: 'hidden', marginTop: 8, borderWidth: 1, borderColor: '#E5E7EB' }}>
          <Maps.default
            ref={mapRef}
            provider={Maps.PROVIDER_GOOGLE}
            style={{ flex: 1 }}
            initialRegion={{ ...center, latitudeDelta: has ? 0.004 : 20, longitudeDelta: has ? 0.004 : 20 }}
            onPress={(e) => onPin?.(e.nativeEvent.coordinate)}
            toolbarEnabled={false}
          >
            {has ? <Maps.Marker coordinate={center} draggable pinColor={TEAL} onDragEnd={(e) => onPin?.(e.nativeEvent.coordinate)} /> : null}
          </Maps.default>
        </View>
      ) : null}
      {HAS_MAP && has ? <Text style={{ fontSize: 10.5, color: '#6B7280', marginTop: 4 }}>Drag the pin or tap the map to adjust.</Text> : null}
    </View>
  );
}
