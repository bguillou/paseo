import { useId } from "react";
import { View } from "react-native";
import Svg, { Defs, Line, Pattern, Rect } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

// Tile the stripe in user space and rotate the lattice, so the stripe width and 45° angle stay
// constant as the composer box resizes. A stretched (`preserveAspectRatio="none"`) gradient would
// distort the spacing. The line sits at the tile centre so neither vertical edge clips it.
const TILE = 10;
const STROKE = 5;

function PlanModeStripesSvg({ patternId, color }: { patternId: string; color: string }) {
  return (
    <Svg width="100%" height="100%">
      <Defs>
        <Pattern
          id={patternId}
          patternUnits="userSpaceOnUse"
          width={TILE}
          height={TILE}
          patternTransform="rotate(45)"
        >
          <Line x1={TILE / 2} y1={0} x2={TILE / 2} y2={TILE} stroke={color} strokeWidth={STROKE} />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${patternId})`} />
    </Svg>
  );
}

const ThemedPlanModeStripesSvg = withUnistyles(PlanModeStripesSvg);

const stripeColorMapping = (theme: Theme) => ({ color: theme.colors.interactionHighlight });

/** Diagonal hatch painted behind the composer input to signal the agent is in plan mode. */
export function PlanModeStripes({ active, testID }: { active: boolean; testID?: string }) {
  // React-generated ids contain characters that are invalid inside SVG fragment references.
  const patternId = `plan-mode-stripes-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (!active) return null;
  return (
    <View style={styles.fill} pointerEvents="none" testID={testID}>
      <ThemedPlanModeStripesSvg patternId={patternId} uniProps={stripeColorMapping} />
    </View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  fill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    // Clip the hatch to the box's rounded corners without touching the wrapper's own overflow,
    // and sit above the wrapper's surface fill but below the in-flow text/toolbar.
    borderRadius: theme.borderRadius["2xl"],
    overflow: "hidden",
    zIndex: -1,
  },
}));
