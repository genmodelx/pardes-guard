import type { ComponentType, SVGProps } from "react";

export type IconWeight = "regular" | "bold" | "fill" | "duotone";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children" | "dangerouslySetInnerHTML"> {
  /** Width and height in px. Default 24. */
  size?: number;
  /** Falls back to the icon's first generated weight when this one was not generated. */
  weight?: IconWeight;
  /** Mirror in right-to-left layouts. Only for icons that show direction (back, next, plane). */
  directional?: boolean;
  /** Set only when the icon stands alone with no visible text. Otherwise it is hidden from screen readers. */
  label?: string;
}

export type Icon = ComponentType<IconProps>;

/** One icon component from Phosphor path data. Used only by generated.tsx. */
export function createIcon(name: string, weights: Partial<Record<IconWeight, string>>): Icon {
  const first = Object.keys(weights)[0] as IconWeight;
  function PgIcon({ size = 24, weight, directional = false, label, className, ...rest }: IconProps) {
    const markup = (weight && weights[weight]) || weights[first] || "";
    const classes = ["pg-icon", directional ? "pg-icon-dir" : "", className ?? ""].filter(Boolean).join(" ");
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        width={size}
        height={size}
        fill="currentColor"
        focusable="false"
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        className={classes}
        data-icon={name}
        {...rest}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    );
  }
  PgIcon.displayName = `Icon(${name})`;
  return PgIcon;
}
