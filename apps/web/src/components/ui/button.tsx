import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import styles from "./ui.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return <button className={buttonClassName(variant, size, className)} type={type} {...props} />;
}

export type ButtonLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  readonly href: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly children: ReactNode;
};

export function ButtonLink({
  children,
  className,
  href,
  variant = "primary",
  size = "md",
  ...props
}: ButtonLinkProps) {
  return (
    <Link className={buttonClassName(variant, size, className)} href={href} {...props}>
      {children}
    </Link>
  );
}

function buttonClassName(variant: ButtonVariant, size: ButtonSize, className?: string): string {
  return [styles.button, styles[`button-${variant}`], styles[`button-${size}`], className]
    .filter(Boolean)
    .join(" ");
}
