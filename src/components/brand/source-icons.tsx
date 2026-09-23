import { cn } from "@/lib/utils";
import type { Provider } from "@/lib/providers";

type SourceIconProps = {
  provider: Provider | "multi";
  className?: string;
  /**
   * When false, swap light/dark assets for contrast on primary (inverted) surfaces.
   * Default true = brand asset matched to the current color scheme.
   */
  branded?: boolean;
  /**
   * Hide the icon from assistive technology. For an icon sitting next to the
   * provider's name in text, where announcing it again only says "Stripe,
   * Stripe".
   */
  decorative?: boolean;
};

type SourceMeta = {
  title: string;
  onLight?: string;
  onDark?: string;
  /** Inline fallback when no Brandfetch asset exists */
  path?: string;
  hex?: string;
};

const FALLBACK_MULTI: SourceMeta = {
  title: "Multi",
  hex: "E8B88A",
  path: "M4 6a2 2 0 0 1 2-2h4v6H4V6zm10-2h4a2 2 0 0 1 2 2v4h-6V4zM4 14h6v6H6a2 2 0 0 1-2-2v-4zm10 0h6v4a2 2 0 0 1-2 2h-4v-6z",
};

const FALLBACK_WEBTRAFFIC: SourceMeta = {
  title: "Webtraffic",
  hex: "92817A",
  path: "M3 17h3v4H3v-4zm5-6h3v10H8V11zm5-4h3v14h-3V7zm5-3h3v17h-3V4z",
};

/** Brandfetch assets in /public/brands — on-light = for light UI, on-dark = for dark UI */
const ICONS: Record<string, SourceMeta> = {
  railway: {
    title: "Railway",
    onLight: "/brands/railway/on-light.svg",
    onDark: "/brands/railway/on-dark.svg",
  },
  netlify: {
    title: "Netlify",
    onLight: "/brands/netlify/on-light.svg",
    onDark: "/brands/netlify/on-dark.svg",
  },
  supabase: {
    title: "Supabase",
    onLight: "/brands/supabase/on-light.svg",
    onDark: "/brands/supabase/on-dark.svg",
  },
  stripe: {
    title: "Stripe",
    onLight: "/brands/stripe/on-light.jpeg",
    onDark: "/brands/stripe/on-dark.jpeg",
  },
  vercel: {
    title: "Vercel",
    onLight: "/brands/vercel/on-light.svg",
    onDark: "/brands/vercel/on-dark.svg",
  },
  qonto: {
    title: "Qonto",
    onLight: "/brands/qonto/on-light.jpeg",
    onDark: "/brands/qonto/on-dark.jpeg",
  },
  attio: {
    title: "Attio",
    onLight: "/brands/attio/on-light.svg",
    onDark: "/brands/attio/on-dark.svg",
  },
  polar: {
    title: "Polar",
    onLight: "/brands/polar/on-light.png",
    onDark: "/brands/polar/on-dark.png",
  },
  /*
   * No Brandfetch asset yet: these use a mark drawn inline in the brand's own
   * colour, so a new connector never renders as the generic multi-source tile.
   */
  sentry: {
    title: "Sentry",
    hex: "362D59",
    path: "M12 2.2a1.9 1.9 0 0 0-1.65.95L8.1 7.06a13.6 13.6 0 0 1 7.05 10.5h-2.1A11.5 11.5 0 0 0 7.05 8.9l-2 3.47a7.6 7.6 0 0 1 3.6 5.19H5.03a.42.42 0 0 1-.36-.63l1.28-2.2a5.1 5.1 0 0 0-1.6-.9l-1.3 2.24A2.2 2.2 0 0 0 4.95 19.4h5.86a9.4 9.4 0 0 0-4.2-7.9l1-1.72a11.4 11.4 0 0 1 5.1 9.62h4.4a2.2 2.2 0 0 0 1.9-3.3L13.65 3.15A1.9 1.9 0 0 0 12 2.2z",
  },
  resend: {
    title: "Resend",
    hex: "000000",
    path: "M4 3h7.6c3.2 0 5.4 1.9 5.4 4.9 0 2.2-1.2 3.8-3.2 4.5l3.9 8.6h-4.2l-3.4-7.9H7.9V21H4V3zm3.9 3.2v3.9h3.3c1.3 0 2.1-.7 2.1-1.9s-.8-2-2.1-2H7.9z",
  },
  lemonsqueezy: {
    title: "Lemon Squeezy",
    hex: "FFC233",
    path: "M12.6 2c-.5 0-.9.4-1 .9l-.4 3.6a7.9 7.9 0 0 0-6.8 7.8A7.7 7.7 0 0 0 12 22a7.7 7.7 0 0 0 7.6-7.7c0-3.3-2.1-6.2-5.1-7.4l.4-3.4a1 1 0 0 0-1-1.1h-1.3zM12 8.7a5.6 5.6 0 1 1 0 11.2 5.6 5.6 0 0 1 0-11.2z",
  },
  github: {
    title: "GitHub",
    hex: "181717",
    path: "M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7 0-.7 0-.7 1.2.1 1.9 1.2 1.9 1.2 1.1 1.9 2.9 1.3 3.6 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z",
  },
  gitlab: {
    title: "GitLab",
    hex: "FC6D26",
    path: "M12 23 8.1 11h7.8L12 23zM3.2 11l-1.1 3.4a.8.8 0 0 0 .3.9L12 23 3.2 11zm17.6 0L12 23l9.6-7.7a.8.8 0 0 0 .3-.9L20.8 11zM6.5 1.4 3.2 11h5.5L6.5 1.4a.4.4 0 0 0-.8 0h.8zm11 0L15.3 11h5.5l-2.5-9.6a.4.4 0 0 0-.8 0h.5z",
  },
  linear: {
    title: "Linear",
    hex: "5E6AD2",
    path: "M2.2 13.6a10 10 0 0 0 8.2 8.2L2.2 13.6zm-.2-2.5 11 11q.9 0 1.7-.2L2.2 9.4q-.2.8-.2 1.7zm.7-3.5 12.7 12.7q.7-.3 1.3-.7L3.4 6.3q-.4.6-.7 1.3zm1.6-2.4 13 13q.6-.5 1-1L5.3 4.2q-.6.5-1 1zM21.9 12A10 10 0 0 0 12 2.1L21.9 12z",
  },
  notion: {
    title: "Notion",
    hex: "000000",
    path: "M4.5 3.3 15.6 2.5c1.4-.1 1.7.1 2.5.7l3.1 2.2c.6.4.8.5.8 1v13.2c0 .9-.3 1.4-1.4 1.5l-12.9.8c-.9.1-1.3-.1-1.8-.7l-2.6-3.4c-.5-.7-.7-1.2-.7-1.8V4.7c0-.7.3-1.3 1.9-1.4zm11.3 1.5-11 .8c-.3 0-.4.2-.3.3l1.9 1.5c.2.2.5.3.9.3l10.5-.6c.3 0 .2-.2.1-.3l-1.6-1.2c-.2-.2-.4-.3-.5-.8zM6.9 9v10.4c0 .6.3.8.9.7l11.4-.7c.6 0 .7-.4.7-.9V8.2c0-.5-.2-.8-.6-.7L7.4 8.2c-.4 0-.5.3-.5.8z",
  },
  webtraffic: FALLBACK_WEBTRAFFIC,
  multi: FALLBACK_MULTI,
};

export function getSourceMeta(provider: string): SourceMeta {
  return ICONS[provider] || FALLBACK_MULTI;
}

/** An accessible name, or nothing at all when the icon is decorative. */
function imageRole(title: string, decorative: boolean) {
  return decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": title } as const);
}

function FallbackIcon({
  meta,
  className,
  branded,
  decorative,
}: {
  meta: SourceMeta;
  className?: string;
  branded: boolean;
  decorative: boolean;
}) {
  return (
    <svg
      {...imageRole(meta.title, decorative)}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-4 shrink-0", className)}
    >
      {decorative ? null : <title>{meta.title}</title>}
      <path
        d={meta.path}
        fill={branded && meta.hex ? `#${meta.hex}` : "currentColor"}
      />
    </svg>
  );
}

export function SourceIcon({
  provider,
  className,
  branded = true,
  decorative = false,
}: SourceIconProps) {
  const meta = getSourceMeta(provider);

  if (!meta.onLight || !meta.onDark) {
    return (
      <FallbackIcon
        meta={meta}
        className={className}
        branded={branded}
        decorative={decorative}
      />
    );
  }

  // branded: match page theme. !branded: invert for contrast on primary buttons.
  const lightSrc = branded ? meta.onLight : meta.onDark;
  const darkSrc = branded ? meta.onDark : meta.onLight;

  return (
    <span
      className={cn("relative inline-flex size-4 shrink-0", className)}
      {...imageRole(meta.title, decorative)}
    >
      <img
        src={lightSrc}
        alt=""
        className="size-full object-contain dark:hidden"
        draggable={false}
      />
      <img
        src={darkSrc}
        alt=""
        className="hidden size-full object-contain dark:block"
        draggable={false}
      />
    </span>
  );
}
