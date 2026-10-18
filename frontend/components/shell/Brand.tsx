import styles from "./Shell.module.css";

/** The mark: a closed passport with a tick in a ring where an emblem would be. No emblem, on purpose. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false" className={styles.mark}>
      <rect x="5" y="1.5" width="22" height="29" rx="3.5" fill="var(--green)" />
      <circle cx="16" cy="13" r="6.4" fill="none" stroke="var(--green-ink)" strokeWidth="1.5" />
      <path d="m12.9 13.1 2.2 2.2 4-4.3" fill="none" stroke="var(--green-ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 23.6h10M12.6 26.6h6.8" fill="none" stroke="var(--green-ink)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ name }: { name: string }) {
  return (
    <span className={styles.brand}>
      <BrandMark />
      <span className={styles.brandName}>{name}</span>
    </span>
  );
}
