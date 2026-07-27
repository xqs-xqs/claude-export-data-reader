import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export const ImportIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M12 3v11" />
    <path d="m8 10 4 4 4-4" />
    <path d="M5 17v3h14v-3" />
  </IconBase>
);

export const SearchIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4" />
  </IconBase>
);

export const MemoryIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M6 5.5c2.4 0 4.3.7 6 2.1v11.2c-1.7-1.4-3.6-2.1-6-2.1H4V5.5z" />
    <path d="M18 5.5c-2.4 0-4.3.7-6 2.1v11.2c1.7-1.4 3.6-2.1 6-2.1h2V5.5z" />
  </IconBase>
);

export const MenuIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </IconBase>
);

export const OutlineIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4 6h.01M4 12h.01M4 18h.01" />
  </IconBase>
);

export const SunIcon = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </IconBase>
);

export const MoonIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />
  </IconBase>
);

export const FileIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M6 2h8l4 4v16H6z" />
    <path d="M14 2v5h5" />
  </IconBase>
);

export const ChevronIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m9 18 6-6-6-6" />
  </IconBase>
);

export const CloseIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </IconBase>
);

export const StarIcon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m12 3 2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 17.03l-5.5 2.89 1.05-6.12L3.1 9.47l6.15-.9z" />
  </IconBase>
);
