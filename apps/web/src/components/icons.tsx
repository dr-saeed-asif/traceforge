import type { SVGProps } from "react";

export type IconName = "arrow" | "inbox" | "warning";

export function Icon({ name, ...props }: Readonly<{ name: IconName } & SVGProps<SVGSVGElement>>) {
  const common = {
    "aria-hidden": true,
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    focusable: false
  };

  if (name === "arrow") {
    return (
      <svg {...common} {...props}>
        <path d="M5 12h14M14 7l5 5-5 5" />
      </svg>
    );
  }
  if (name === "inbox") {
    return (
      <svg {...common} {...props}>
        <path d="m5 5-3 9v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5l-3-9H5Z" />
        <path d="M2 14h5l2 3h6l2-3h5" />
      </svg>
    );
  }
  return (
    <svg {...common} {...props}>
      <path d="M12 3 2.8 19h18.4L12 3Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}
