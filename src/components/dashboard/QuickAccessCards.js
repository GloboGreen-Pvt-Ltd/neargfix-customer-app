// Quick Access in the Partner Home "Repair / Buy / Sell" card design
// (Partner DashboardShortcutCards): solid brand gradient, soft circles with a
// white glyph top-right, white title + subtitle bottom-left, arrow. Rows of
// three equal columns — five tiles lay out 3 + 2 at any width.
import React from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, LayoutGrid } from 'lucide-react-native';
import { Touchable, withAlpha } from './theme';

const PER_ROW = 3;

function Card({ item, width, height, onPress }) {
  const Icon = item.icon;
  const w = width || 100;
  return (
    <Touchable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.label}, ${item.sub}`}
      style={{
        flex: 1, minWidth: 0, height, borderRadius: 18, backgroundColor: item.tone, overflow: 'hidden',
        shadowColor: item.tone, shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3,
      }}
      pressedStyle={{ opacity: 0.85 }}
    >
      <LinearGradient
        pointerEvents="none"
        colors={[item.tone, withAlpha(item.tone, 0.78)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#FFFFFF' }}
      />
      <View pointerEvents="none" style={{ position: 'absolute', top: -w * 0.25, right: -w * 0.25, width: w * 0.75 + 4, height: w * 0.75 + 4, borderRadius: w, backgroundColor: 'rgba(255,255,255,0.08)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: -w * 0.08, right: -w * 0.08, width: w * 0.42 + 4, height: w * 0.42 + 4, borderRadius: w, backgroundColor: 'rgba(0,0,0,0.08)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: w * 0.2 - 20, right: w * 0.2 - 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={34} color="#FFFFFF" strokeWidth={1.8} />
      </View>
      <View style={{ position: 'absolute', left: 10, right: 8, bottom: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: w < 110 ? 14 : 16, lineHeight: 20, fontWeight: '800', color: '#FFFFFF' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{item.label}</Text>
          <Text style={{ fontSize: w < 110 ? 11 : 12, lineHeight: 15, fontWeight: '600', color: 'rgba(255,255,255,0.9)' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{item.sub}</Text>
        </View>
        <ArrowRight size={w < 110 ? 16 : 18} color="#FFFFFF" strokeWidth={2.2} />
      </View>
    </Touchable>
  );
}

/** items: [{ key, label, sub, icon, tone }]; contentW: the screen's content width; onPress(item). */
export default function QuickAccessCards({ title = 'Quick Access', items, pad, contentW, gap = 10, height, onPress }) {
  const { width: winW } = useWindowDimensions();
  const h = height || (winW >= 600 ? 104 : 86);
  const inner = (contentW || Math.min(winW, 720)) - pad * 2;
  const rows = [];
  for (let i = 0; i < items.length; i += PER_ROW) rows.push(items.slice(i, i + PER_ROW));
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: pad + 4, marginBottom: 10 }}>
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#035C6C', alignItems: 'center', justifyContent: 'center' }}>
          <LayoutGrid size={14} color="#FFFFFF" strokeWidth={2.3} />
        </View>
        <Text style={{ flex: 1, marginLeft: 8, fontSize: 15, fontWeight: '800', color: '#1C3053' }} numberOfLines={1}>{title}</Text>
      </View>
      <View style={{ paddingHorizontal: pad, gap }}>
        {rows.map((row, r) => {
          // Circles, glyph and type are sized from the 3-column card width on
          // every row, so the wider 2-card row looks exactly like the Partner
          // cards instead of being swallowed by oversized circles.
          const unitW = (inner - gap * (PER_ROW - 1)) / PER_ROW;
          return (
            <View key={r} style={{ flexDirection: 'row', gap }}>
              {row.map((it) => <Card key={it.key} item={it} width={unitW} height={h} onPress={onPress} />)}
            </View>
          );
        })}
      </View>
    </View>
  );
}
