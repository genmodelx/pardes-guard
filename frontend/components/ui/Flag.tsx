import styles from "./Flag.module.css";

/**
 * A country's flag as the picture on a country choice, so a person who reads little can still find
 * their country. Decorative: the country's name is always written beside it. Flags are used for
 * choosing a country and nowhere else.
 */
export function Flag({ code, size = 56 }: { code: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={styles.flag} src={`/flags/${code.toLowerCase()}.svg`} alt="" width={size} height={Math.round(size * 0.75)} loading="lazy" decoding="async" />
  );
}
