// Gate around the signed-in Customer app:
// fresh OTP login → single-device session (device-limit prompt) → optional
// App Lock opt-in → home. No MPIN in the Customer app: the MPIN belongs to the
// account, so for a number also used in the Partner app it asked for the
// Partner's MPIN. With App Lock on, the app locks on cold start and after the
// background timeout and unlocks with the phone's biometrics / screen lock
// (never extends the OTP deadline).
// Falls back to the legacy AppLockGate when the server has no /auth/security API.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AppLockGate from '../components/AppLockGate';
import { C } from './PinPad';
import DeviceLimitScreen from './DeviceLimitScreen';
import { getSession } from '../auth/session';
import { authenticate, isAppLockEnabled, isDeviceSecure, setAppLockEnabled } from '../auth/appLock';
import { startDeviceSession, sessionStatus, setBiometricPreference, pinErrorMessage } from './securityApi';

const DEFAULT_LOCK_S = 600; // Customer: 10 minutes
const SecurityContext = createContext({ secure: false });
export const useSecurity = () => useContext(SecurityContext);

const Card = ({ children }) => {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, elevation: 9999, backgroundColor: C.bg, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' }}>
      <Image source={require('../../assets/logo.png')} style={{ width: 64, height: 64, borderRadius: 16, marginBottom: 18 }} resizeMode="contain" />
      {children}
    </View>
  );
};

const Btn = ({ title, onPress, busy, ghost, danger }) => (
  <Pressable onPress={onPress} disabled={busy} style={{ alignSelf: 'stretch', height: 46, borderRadius: 14, marginTop: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: ghost ? C.bg : C.primary, borderWidth: ghost ? 1 : 0, borderColor: C.border, opacity: busy ? 0.6 : 1 }}>
    {busy ? <ActivityIndicator color={ghost ? C.primary : '#FFFFFF'} /> : <Text style={{ color: danger ? C.error : ghost ? C.text : '#FFFFFF', fontWeight: '800', fontSize: 14 }}>{title}</Text>}
  </Pressable>
);

export default function SecurityGate({ children, onLogout }) {
  const [stage, setStage] = useState('boot'); // boot|legacy|otp|device|bio|locked|open
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState(null);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [bioOn, setBioOn] = useState(false); // App Lock on (and the phone has a screen lock)
  const bgAt = useRef(null);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const bioRef = useRef(bioOn);
  bioRef.current = bioOn;

  const loadStatus = useCallback(async () => {
    const st = await sessionStatus();
    setStatus(st);
    return st;
  }, []);

  const start = useCallback(async (replaceExisting) => {
    setBusy(true); setError(null);
    try {
      await startDeviceSession({ replaceExisting });
      setSession(await getSession());
      loadStatus().catch(() => {});
      const offerBio = !(await isAppLockEnabled()) && (await isDeviceSecure());
      setStage(offerBio ? 'bio' : 'open');
    } catch (e) {
      if (e?.status === 404 || e?.status === 405) setStage('legacy');
      else if (e?.status === 409 && e?.payload?.status === 'DEVICE_LIMIT') { setDeviceInfo(e.payload); setStage('device'); }
      else if (e?.status === 401) setStage('otp');
      else setError(pinErrorMessage(e));
    } finally { setBusy(false); }
  }, [loadStatus]);

  // Boot: start a device session after a fresh OTP login; otherwise open (or
  // lock, when App Lock is on).
  useEffect(() => {
    (async () => {
      const s = await getSession();
      setSession(s);
      const lockOn = (await isAppLockEnabled()) && (await isDeviceSecure());
      setBioOn(lockOn);
      if (!s?.deviceSessionId) { start(false); return; }
      // Existing session: no full-screen loader; validate the server session
      // in the background.
      setStage(lockOn ? 'locked' : 'open');
      try {
        await loadStatus();
      } catch (e) {
        // A device-bound session never silently downgrades to the legacy lock:
        // a 404/401 here means verify again with OTP (also if already unlocked).
        if (e?.status === 404 || e?.status === 405 || e?.status === 401) setStage('otp');
      }
    })();
  }, [start, loadStatus]);

  // Background timeout lock.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (/inactive|background/.test(next)) { if (!bgAt.current) bgAt.current = Date.now(); return; }
      if (next === 'active' && bgAt.current) {
        const away = (Date.now() - bgAt.current) / 1000;
        bgAt.current = null;
        const limit = Number(session?.lockTimeoutSeconds) || DEFAULT_LOCK_S;
        if (stageRef.current === 'open' && away >= limit && bioRef.current) setStage('locked');
      }
    });
    return () => sub.remove();
  }, [session]);

  const tryBiometric = useCallback(async () => {
    if (!bioOn) { setStage('open'); return; } // App Lock turned off: nothing to unlock
    if (await authenticate()) { setError(null); setStage('open'); }
  }, [bioOn]);

  useEffect(() => { if (stage === 'locked') tryBiometric(); }, [stage, tryBiometric]);

  const enableBiometric = async () => {
    setBusy(true);
    try {
      if ((await isDeviceSecure()) && (await authenticate())) {
        await setAppLockEnabled(true); setBioOn(true);
        setBiometricPreference(true).catch(() => {});
      }
    } finally { setBusy(false); setStage('open'); }
  };

  if (stage === 'legacy') return <AppLockGate onLogout={onLogout}>{children}</AppLockGate>;

  const ctx = { secure: stage !== 'boot', session, status, refreshStatus: loadStatus, bioOn, setBioOn, onLogout };
  let overlay = null;
  if (stage === 'boot') {
    overlay = <Card><ActivityIndicator color={C.primary} />{error ? <><Text style={{ color: C.error, marginTop: 12, textAlign: 'center' }}>{error}</Text><Btn title="Retry" onPress={() => start(false)} busy={busy} /><Btn title="Log out" ghost danger onPress={onLogout} /></> : null}</Card>;
  } else if (stage === 'otp') {
    overlay = (
      <Card>
        <Ionicons name="time-outline" size={36} color={C.primary} />
        <Text style={{ fontSize: 17, fontWeight: '800', color: C.text, marginTop: 10 }}>OTP Session Expired</Text>
        <Text style={{ fontSize: 13, color: C.muted, marginTop: 6, textAlign: 'center' }}>For your security, please verify your mobile number with OTP again.</Text>
        <Btn title="Verify with OTP" onPress={onLogout} />
      </Card>
    );
  } else if (stage === 'device') {
    overlay = <DeviceLimitScreen device={deviceInfo} busy={busy} error={error} onConfirm={() => start(true)} onCancel={onLogout} />;
  } else if (stage === 'bio') {
    overlay = (
      <Modal transparent visible animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(17,24,39,0.45)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: C.bg, borderRadius: 16, padding: 20, alignItems: 'center' }}>
            <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="finger-print" size={28} color={C.primary} />
            </View>
            <Text style={{ fontSize: 16, fontWeight: '800', color: C.text, marginTop: 12 }}>Enable Biometric Login?</Text>
            <Text style={{ fontSize: 12.5, color: C.muted, marginTop: 6, textAlign: 'center' }}>Unlock with your fingerprint or face. Your phone's screen lock works as a fallback.</Text>
            <Btn title="Enable Biometrics" onPress={enableBiometric} busy={busy} />
            <Btn title="Not Now" ghost onPress={() => setStage('open')} />
          </View>
        </View>
      </Modal>
    );
  } else if (stage === 'locked') {
    overlay = (
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '800', color: C.text, textAlign: 'center' }}>NearGFix is Locked</Text>
        <Text style={{ fontSize: 13, color: C.muted, marginTop: 6, textAlign: 'center', lineHeight: 19 }}>Authentication is required to access NearGFix.</Text>
        <Pressable onPress={tryBiometric} accessibilityLabel="Unlock with Biometrics" style={{ alignSelf: 'stretch', height: 50, borderRadius: 14, marginTop: 22, backgroundColor: C.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="finger-print" size={22} color="#FFFFFF" />
          <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 15, marginLeft: 8 }}>Unlock with Biometrics</Text>
        </Pressable>
        <Pressable onPress={onLogout} style={{ marginTop: 14 }}><Text style={{ color: C.error, fontWeight: '700', fontSize: 13 }}>Log out</Text></Pressable>
      </Card>
    );
  }

  return (
    <SecurityContext.Provider value={ctx}>
      <View style={{ flex: 1 }}>
        {stage === 'boot' ? null : children}
        {overlay}
      </View>
    </SecurityContext.Provider>
  );
}
