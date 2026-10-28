import Svg, { Circle, Path, Rect } from "react-native-svg";

import { colors } from "@/theme/tokens";

/** Íconos de trazo simple en Tinta (sin emojis). Todos decorativos: el texto acompaña. */
export type IconName =
  | "menu"
  | "plus"
  | "mic"
  | "message"
  | "image"
  | "camera"
  | "clipboard"
  | "lock"
  | "cloud"
  | "clock"
  | "check"
  | "back"
  | "phone"
  | "download"
  | "gear"
  | "trash"
  | "close"
  | "chevron"
  | "file"
  | "megaphone"
  | "alert"
  | "upload"
  | "calc"
  | "list"
  | "share";

type Props = { name: IconName; size?: number; color?: string; strokeWidth?: number };

export function Icon({ name, size = 22, color = colors.tinta, strokeWidth = 2 }: Props) {
  const common = {
    fill: "none",
    stroke: color,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {shapes(name, common)}
    </Svg>
  );
}

function shapes(name: IconName, p: Record<string, unknown>) {
  switch (name) {
    case "menu":
      return <Path d="M4 7h16M4 12h16M4 17h16" {...p} />;
    case "plus":
      return <Path d="M12 5v14M5 12h14" {...p} />;
    case "mic":
      return (
        <>
          <Rect x={9} y={3} width={6} height={11} rx={3} {...p} />
          <Path d="M5 11a7 7 0 0 0 14 0M12 18v3" {...p} />
        </>
      );
    case "message":
      return <Path d="M4 5h16v11H8l-4 4z" {...p} />;
    case "image":
      return (
        <>
          <Rect x={3} y={5} width={18} height={14} rx={2} {...p} />
          <Circle cx={9} cy={10} r={2} {...p} />
          <Path d="M21 16l-5-5-8 8" {...p} />
        </>
      );
    case "camera":
      return (
        <>
          <Path d="M4 8h3l2-3h6l2 3h3v11H4z" {...p} />
          <Circle cx={12} cy={13} r={3.5} {...p} />
        </>
      );
    case "clipboard":
      return (
        <>
          <Rect x={7} y={4} width={10} height={16} rx={2} {...p} />
          <Path d="M10 4V3h4v1" {...p} />
        </>
      );
    case "lock":
      return (
        <>
          <Rect x={5} y={11} width={14} height={10} rx={2} {...p} />
          <Path d="M8 11V8a4 4 0 0 1 8 0v3" {...p} />
        </>
      );
    case "cloud":
      return <Path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 9.5 4.25 4.25 0 0 0 7 18z" {...p} />;
    case "clock":
      return (
        <>
          <Circle cx={12} cy={12} r={8.5} {...p} />
          <Path d="M12 7.5V12l3 2" {...p} />
        </>
      );
    case "check":
      return <Path d="M5 12.5l4.5 4.5L19 7.5" {...p} />;
    case "back":
      return <Path d="M15 5l-7 7 7 7" {...p} />;
    case "chevron":
      return <Path d="M9 5l7 7-7 7" {...p} />;
    case "phone":
      return <Path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" {...p} />;
    case "download":
      return <Path d="M12 4v11M7 10l5 5 5-5M5 20h14" {...p} />;
    case "upload":
      return <Path d="M12 20V9M7 14l5-5 5 5M5 4h14" {...p} />;
    case "gear":
      return (
        <>
          <Circle cx={12} cy={12} r={3} {...p} />
          <Path
            d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"
            {...p}
          />
        </>
      );
    case "trash":
      return <Path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" {...p} />;
    case "close":
      return <Path d="M6 6l12 12M18 6L6 18" {...p} />;
    case "file":
      return <Path d="M7 3h7l4 4v14H7zM14 3v4h4" {...p} />;
    case "megaphone":
      return <Path d="M4 10v4h3l7 4V6l-7 4zM17 9a4 4 0 0 1 0 6" {...p} />;
    case "calc":
      return (
        <>
          <Rect x={5} y={3} width={14} height={18} rx={2} {...p} />
          <Path d="M8 7h8M8.5 11.5h0M12 11.5h0M15.5 11.5h0M8.5 15h0M12 15h0M15.5 15h0M8.5 18h0M12 18h0M15.5 18h0" {...p} />
        </>
      );
    case "list":
      return <Path d="M9 7h11M9 12h11M9 17h11M4.5 7h0M4.5 12h0M4.5 17h0" {...p} />;
    case "share":
      return <Path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7" {...p} />;
    case "alert":
      return (
        <>
          <Path d="M12 4l9 16H3z" {...p} />
          <Path d="M12 10v4M12 17v.5" {...p} />
        </>
      );
  }
}
