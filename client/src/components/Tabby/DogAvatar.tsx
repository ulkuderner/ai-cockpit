/**
 * @file DogAvatar.tsx
 * @description Pure presentational SVG dog - Samba, an English Setter. Given a
 *   mood it renders the matching expression (ears, eyes, brows, mouth, tail,
 *   paws) via a `data-mood` attribute that drives the CSS in tabby.css. When
 *   motion is allowed, the pupils track the cursor. No data access - fully
 *   testable / reusable in isolation. Drawn after the real Samba: white coat
 *   with ginger-tan belton flecks, a clear white blaze, large round glossy
 *   near-black eyes under soft tan brows, a pinkish-brown freckled nose, thin
 *   whiskers, long wavy ginger ears with white wisps and a feathered tail. Dog
 *   gestures replace the old cat ones: tail wag, ear flop,
 *   head tilt, a raised paw and a panting tongue.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Purpose:** Tabby (shown to users as Samba, an English Setter) is the optional on-screen dog assistant — quips, intents, and lightweight event reactions layered above the dashboard chrome.
 *
 * ## Design constraints
 * - Internationalization: user-visible strings belong in i18n JSON, not literals here.
 * - Every continuous animation is CSS-only and switched off under reduced motion.
 *
 * ## Internal dependencies
 * - `./brain`
 *
 * ## Public surface
 * - `DogAvatar` — exported API; see TSDoc on the symbol for behavior.
 *
 * ## Testing pointers
 * - Prefer colocated `__tests__` with Vitest + Testing Library for UI.
 * ============================================================================= */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Mood } from "./brain";

/** Props for {@link DogAvatar}. */
interface DogAvatarProps {
  /**
   * Mood to show; each mood has its own pose and animation, driven by a `data-mood` attribute and
   * CSS.
   */
  mood: Mood;
  /** When true, animations are disabled and the eyes stop following the cursor. */
  reducedMotion: boolean;
  /** Whether the pointer is over the avatar, for a small hover reaction. */
  hovered?: boolean;
  /** Rendered width and height in pixels; defaults to 60. */
  size?: number;
}

/** Furthest the pupils move from center, in units of the 100x100 viewBox (a dog's iris is small). */
const MAX_PUPIL_SHIFT = 1.4;

/**
 * Last known cursor position, tracked from the moment this module first loads, well before any
 * avatar mounts, so the eyes aim at the cursor as soon as the dog mounts. Null until the page's
 * first pointer event.
 */
let lastCursor: { x: number; y: number } | null = null;
if (typeof window !== "undefined") {
  const remember = (e: MouseEvent) => {
    lastCursor = { x: e.clientX, y: e.clientY };
  };
  // capture phase + passive so we never interfere with anything else.
  window.addEventListener("mousemove", remember, { capture: true, passive: true });
  window.addEventListener("pointermove", remember as EventListener, {
    capture: true,
    passive: true,
  });
}

/** Ginger-tan ticking dots: [cx, cy, r]. */
const TICKS: [number, number, number][] = [
  // muzzle freckles
  [40.5, 61.5, 1.1],
  [38.6, 65.4, 1],
  [42.6, 68, 0.9],
  [59.5, 61.5, 1.1],
  [61.4, 65.4, 1],
  [57.4, 68, 0.9],
  // chest
  [38, 84, 1.3],
  [44, 88.5, 1.1],
  [51.5, 85, 1.2],
  [33, 91, 1.1],
  [48, 94, 1],
  [64, 83, 1.1],
  [67.5, 92, 1.1],
  // tail
  [79, 80.5, 1],
  [84.8, 72.5, 1.1],
  [87.4, 63, 0.9],
];

/**
 * Samba's SVG dog. The mood sets the pose and animation through CSS, and the pupils follow the
 * cursor (throttled to one update per animation frame) while motion is allowed.
 */
export function DogAvatar({ mood, reducedMotion, hovered = false, size = 60 }: DogAvatarProps) {
  const { t } = useTranslation("samba");
  const rootRef = useRef<SVGSVGElement | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const [pupil, setPupil] = useState({ x: 0, y: 0 });

  // Pupils follow the cursor whenever motion is allowed and the eyes are open.
  // (Only `sleeping` closes them by intent; `disconnected` hides the open-eye
  // group via CSS, so tracking there is harmless.)
  const tracking = !reducedMotion && mood !== "sleeping";

  useEffect(() => {
    if (!tracking) {
      setPupil({ x: 0, y: 0 });
      return;
    }

    /** Point the pupils toward a screen position, limited to {@link MAX_PUPIL_SHIFT}. */
    const aimAt = (clientX: number, clientY: number) => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = clientX - (r.left + r.width / 2);
      const dy = clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, dist / 240) / dist;
      setPupil({ x: dx * k * MAX_PUPIL_SHIFT, y: dy * k * MAX_PUPIL_SHIFT });
    };

    let initRaf = 0;
    if (lastCursor) {
      const c = lastCursor;
      initRaf = requestAnimationFrame(() => aimAt(c.x, c.y));
    }

    /** Track the cursor, updating the pupils at most once per animation frame. */
    const onMove = (e: MouseEvent) => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = undefined;
        aimAt(e.clientX, e.clientY);
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (initRaf) cancelAnimationFrame(initRaf);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    };
  }, [tracking]);

  return (
    <svg
      ref={rootRef}
      className="tabby-dog"
      data-mood={mood}
      data-reduced={reducedMotion ? "1" : "0"}
      data-hovered={hovered && !reducedMotion ? "1" : "0"}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={t("avatar.label", { mood: t(`moods.${mood}`) })}
    >
      <defs>
        {/* Top-lit white coat with a warm shadow so the white reads as plush, not flat. */}
        <radialGradient id="sambaFur" cx="50%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#f6f0e8" />
          <stop offset="100%" stopColor="#e3d6c7" />
        </radialGradient>
        <linearGradient id="sambaEar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e3ae73" />
          <stop offset="100%" stopColor="#c98b4e" />
        </linearGradient>
        <linearGradient id="tabbyHalo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a5b4fc" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>

      {/* soft glow halo */}
      <circle className="tabby-halo" cx="50" cy="56" r="33" />

      {/* Feathered tail: smooth top line, scalloped feathering underneath. Base hides behind the body. */}
      <g className="tabby-tail">
        <path
          className="tabby-tail-shape"
          d="M64 86 C73 84 81 78 85 69 C87.5 63 88 57 87 52 C90.5 56 92.5 62 92 68 C93.5 70 92.5 72.5 91 73.5 C91.5 76 90 78 88 78.5 C87.5 81 85 82.5 83 82.5 C81 85.5 78 86.5 75.5 86.5 C72 89.5 68 91 64 91 Z"
        />
        <path className="tabby-feather" d="M83.5 75 q3.5 -2.5 5.5 -7 M78 81 q4 -1.5 6.5 -4.5" />
      </g>

      {/* body / chest peeking up from the bottom */}
      <ellipse className="tabby-body" cx="50" cy="92" rx="27" ry="18" />
      <ellipse className="tabby-patch" cx="57.5" cy="88" rx="3.2" ry="2.3" />

      {/* paws */}
      <g className="tabby-paws">
        <ellipse className="tabby-paw" cx="38" cy="98" rx="8" ry="6" />
        <g className="tabby-paw-wave">
          <ellipse className="tabby-paw" cx="62" cy="98" rx="8" ry="6" />
          <path className="tabby-toe" d="M59 97 v2.4 M62 96.6 v2.6 M65 97 v2.4" />
        </g>
        <path className="tabby-toe" d="M35 97 v2.4 M38 96.6 v2.6 M41 97 v2.4" />
      </g>

      {/* Long wavy ginger ears with white wisps, hanging close to the cheeks past the jaw. */}
      <g className="tabby-ears">
        <g className="tabby-ear-l">
          <path
            className="tabby-ear"
            d="M35 25 C25 23 18 31 17 43 C16 53 17 62 19 69 C18 72 20 74 21 76 C21 79 24 79 25 80 C27 82 29 79 31 80 C33 76 35 68 35 60 L36 30 Z"
          />
          <path
            className="tabby-feather tabby-feather-ear"
            d="M20 50 q-1 9 1 17 M24 44 q-1.5 12 1 24 M28 62 q-0.5 8 1 14"
          />
        </g>
        <g className="tabby-ear-r">
          <path
            className="tabby-ear"
            d="M65 25 C75 23 82 31 83 43 C84 53 83 62 81 69 C82 72 80 74 79 76 C79 79 76 79 75 80 C73 82 71 79 69 80 C67 76 65 68 65 60 L64 30 Z"
          />
          <path
            className="tabby-feather tabby-feather-ear"
            d="M80 50 q1 9 -1 17 M76 44 q1.5 12 -1 24 M72 62 q0.5 8 -1 14"
          />
        </g>
      </g>

      {/* head: slightly domed skull narrowing into a medium-long muzzle */}
      <path
        className="tabby-head"
        d="M50 19 C64 19 73 29 73 41 C73 50 68 56 65 61 C64 70 58 78 50 78 C42 78 36 70 35 61 C32 56 27 50 27 41 C27 29 36 19 50 19 Z"
      />

      {/* soft tan shading around the eyes; the white blaze down the centre stays clear */}
      <path
        className="tabby-eye-patch"
        d="M29 37 C31 30 38 28 43 31 C46 34 46 42 44.5 47 C42.5 52 36 53.5 32 50.5 C28.5 47.5 28 42 29 37 Z"
      />
      <path
        className="tabby-eye-patch"
        d="M71 37 C69 30 62 28 57 31 C54 34 54 42 55.5 47 C57.5 52 64 53.5 68 50.5 C71.5 47.5 72 42 71 37 Z"
      />

      {/* gentle tan brow patches, inner ends raised for a soft pleading look */}
      <ellipse
        className="tabby-brow-patch"
        cx="38.5"
        cy="36.5"
        rx="4.2"
        ry="2.2"
        transform="rotate(-14 38.5 36.5)"
      />
      <ellipse
        className="tabby-brow-patch"
        cx="61.5"
        cy="36.5"
        rx="4.2"
        ry="2.2"
        transform="rotate(14 61.5 36.5)"
      />

      {/* belton ticking: streaky flecks, densest on the forehead, around the eyes and on the muzzle bridge */}
      <path
        className="tabby-flecks"
        d="M36 27 l1.5 -1 M40 24.5 l1 -1.6 M42.5 28.5 l1.2 -1.2 M38 31 l1.4 -0.8 M33 33 l1.2 -1.2 M30.5 39 l1 -1.2 M64 27 l-1.5 -1 M60 24.5 l-1 -1.6 M57.5 28.5 l-1.2 -1.2 M62 31 l-1.4 -0.8 M67 33 l-1.2 -1.2 M69.5 39 l-1 -1.2 M33 51.5 l1.2 0.6 M44.5 50 l0.6 1.2 M67 51.5 l-1.2 0.6 M55.5 50 l-0.6 1.2 M45 53 l0.5 1.3 M46.5 56.5 l0.4 1.2 M43.5 57 l0.3 1.2 M55 53 l-0.5 1.3 M53.5 56.5 l-0.4 1.2 M56.5 57 l-0.3 1.2"
      />
      <g className="tabby-ticks">
        {TICKS.map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
        ))}
      </g>

      {/* cheek blush */}
      <g className="tabby-cheeks">
        <ellipse cx="37" cy="57" rx="3.4" ry="2" />
        <ellipse cx="63" cy="57" rx="3.4" ry="2" />
      </g>

      {/* eyes - open state: large, round, glossy near-black with thin rims, set wide */}
      <g className="tabby-eyes-open">
        <ellipse className="tabby-eye" cx="38.5" cy="45" rx="5.6" ry="5.8" />
        <ellipse className="tabby-eye" cx="61.5" cy="45" rx="5.6" ry="5.8" />
        {/* Outer group carries the eye-tracking translate; the inner group carries
            the blink (scaleY). They must stay separate: a CSS animation on
            `transform` would override an inline `transform`. */}
        <g className="tabby-pupils" style={{ transform: `translate(${pupil.x}px, ${pupil.y}px)` }}>
          <g className="tabby-pupils-blink">
            <circle className="tabby-pupil" cx="38.5" cy="45.3" r="3.6" />
            <circle className="tabby-pupil" cx="61.5" cy="45.3" r="3.6" />
            <circle className="tabby-glint" cx="40.5" cy="42.8" r="1.6" />
            <circle className="tabby-glint" cx="63.5" cy="42.8" r="1.6" />
            <circle className="tabby-glint tabby-glint-sm" cx="36.6" cy="47.4" r="0.7" />
            <circle className="tabby-glint tabby-glint-sm" cx="59.6" cy="47.4" r="0.7" />
          </g>
        </g>
      </g>

      {/* eyes - happy (^ ^) */}
      <g className="tabby-eyes-happy">
        <path d="M33 46.5 q5.5 -6 11 0" />
        <path d="M56 46.5 q5.5 -6 11 0" />
      </g>

      {/* eyes - closed (sleeping / offline) */}
      <g className="tabby-eyes-closed">
        <path d="M33 45 q5.5 4.5 11 0" />
        <path d="M56 45 q5.5 4.5 11 0" />
      </g>

      {/* worried brows - setters have very expressive brows */}
      <g className="tabby-brows">
        <path d="M33 38.5 L43.5 35" />
        <path d="M67 38.5 L56.5 35" />
      </g>

      {/* a few thin whiskers from the muzzle */}
      <path
        className="tabby-whiskers"
        d="M37 63.5 q-5 -1 -9 1 M37.5 66.5 q-5 0.5 -8.5 3 M63 63.5 q5 -1 9 1 M62.5 66.5 q5 0.5 8.5 3"
      />

      {/* nose - broad, rounded, pinkish-brown with darker dappled freckles */}
      <path
        className="tabby-nose"
        d="M43.5 61.5 C43.5 58.5 56.5 58.5 56.5 61.5 C56.5 65 53 67.5 50 67.5 C47 67.5 43.5 65 43.5 61.5 Z"
      />
      <g className="tabby-nose-freckles">
        <circle cx="46.8" cy="62.6" r="0.75" />
        <circle cx="51.6" cy="60.9" r="0.6" />
        <circle cx="53.7" cy="63.4" r="0.75" />
        <circle cx="49.2" cy="64.9" r="0.55" />
        <circle cx="45.4" cy="60.6" r="0.5" />
      </g>
      <ellipse className="tabby-nose-shine" cx="48.2" cy="60.6" rx="2.2" ry="0.9" />

      {/* mouths */}
      <path className="tabby-mouth-idle" d="M50 67 v3 M50 70 q-3.5 3 -7 0.5 M50 70 q3.5 3 7 0.5" />
      <g className="tabby-mouth-happy">
        <path className="tabby-tongue" d="M46.8 72.4 C46.8 78.4 53.2 78.4 53.2 72.4 Z" />
        <path d="M50 67 v6.4 M42 69.5 q8 8 16 0" />
      </g>
      <path className="tabby-mouth-worried" d="M50 67 v2.5 M45 74 q5 -4 10 0" />

      {/* zzz for sleeping */}
      <g className="tabby-zzz">
        <text x="76" y="28">
          z
        </text>
        <text x="84" y="19">
          z
        </text>
      </g>

      {/* alert bang for stuck */}
      <g className="tabby-bang">
        <text x="80" y="24">
          !
        </text>
      </g>

      {/* sparkle for happy */}
      <g className="tabby-sparkle">
        <path d="M84 30 l1.4 3.6 l3.6 1.4 l-3.6 1.4 l-1.4 3.6 l-1.4 -3.6 l-3.6 -1.4 l3.6 -1.4 z" />
      </g>

      {/* A brief hello for pointer hover: CSS reveals and floats these hearts. */}
      <g className="tabby-hover-hearts" aria-hidden="true">
        <text x="74" y="30">
          ♥
        </text>
        <text x="82" y="21">
          ♥
        </text>
      </g>
    </svg>
  );
}
