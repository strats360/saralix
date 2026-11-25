import { Children, forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: boolean;
  block?: boolean;
  loading?: boolean;
  size?: "sm" | "md";
}

/**
 * Buttons: primary is filled black (off-white in dark mode), secondary is outlined, and ghost
 * reads as a link (accent text) unless it holds only an icon, which stays neutral.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", icon, block, loading, size = "md", className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "btn",
        variant === "danger" ? "btn-secondary" : `btn-${variant}`,
        variant === "ghost" && !Children.toArray(children).some((c) => typeof c === "string" || typeof c === "number") && "btn-ghost-icon",
        icon && "btn-icon",
        block && "btn-block",
        size === "sm" && !icon && "!px-2.5 !py-1 text-[13px]",
        size === "sm" && icon && "!h-[30px] !w-[30px]",
        variant === "danger" && "!text-[var(--bad)] !border-[color-mix(in_srgb,var(--bad)_50%,transparent)]",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : null}
      {children}
    </button>
  );
});
