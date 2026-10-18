"use client";

import { useRef, useState } from "react";
import { IconCamera, IconFileText, IconImage, IconX } from "@/components/icons";
import { ACCEPT_ATTRIBUTE, MAX_PAPERS, addPapers, releasePaper, type FileProblem, type PaperFile } from "@/lib/files";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import styles from "./PaperPicker.module.css";

const PROBLEM: Record<FileProblem, Key> = { unsupported: "file.unsupported", tooLarge: "file.tooLarge", tooMany: "check.limit" };

/**
 * The two ways to add a paper: take a photo with the camera, or pick photos and PDFs. Hands the
 * picked files over and forgets them.
 */
export function AddPaperButtons({ onPick, disabled = false, accept = ACCEPT_ATTRIBUTE }: { onPick: (files: File[]) => void; disabled?: boolean; accept?: string }) {
  const { t } = useI18n();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const pick = (input: HTMLInputElement) => {
    const files = [...(input.files ?? [])];
    input.value = ""; // so the same file can be picked again after removing it
    if (files.length) onPick(files);
  };
  return (
    <>
      <div className={styles.buttons}>
        <button type="button" className={styles.add} onClick={() => camera.current?.click()} disabled={disabled} data-testid="add-photo">
          <IconCamera size={32} />
          <span>{t("check.photo")}</span>
        </button>
        <button type="button" className={styles.add} onClick={() => gallery.current?.click()} disabled={disabled} data-testid="add-files">
          <IconImage size={32} />
          <span>{t("file.add")}</span>
        </button>
      </div>
      <input ref={camera} className="visually-hidden" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={(e) => pick(e.target)} />
      <input ref={gallery} className="visually-hidden" type="file" accept={accept} multiple tabIndex={-1} aria-hidden="true" onChange={(e) => pick(e.target)} data-testid="file-input" />
    </>
  );
}

/**
 * Add the papers to check: take a photo with the camera, or pick photos and PDFs. Each paper shows
 * as a thumbnail with its own Remove button. Files stay in memory; nothing is uploaded here.
 */
export function PaperPicker({ papers, onChange, disabled = false }: { papers: PaperFile[]; onChange: (papers: PaperFile[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [problem, setProblem] = useState<FileProblem | null>(null);
  const full = papers.length >= MAX_PAPERS;

  const add = async (files: File[]) => {
    const { added, problem: found } = await addPapers(files, papers);
    setProblem(found);
    if (added.length) onChange([...papers, ...added]);
  };

  const remove = (paper: PaperFile) => {
    releasePaper(paper);
    setProblem(null);
    onChange(papers.filter((p) => p !== paper));
  };

  return (
    <div className={styles.picker}>
      <AddPaperButtons onPick={(files) => void add(files)} disabled={disabled || full} />

      {papers.length ? (
        <ul className={styles.list} aria-label={t("file.count", { n: papers.length })}>
          {papers.map((paper, i) => (
            <li key={paper.id} className={styles.item}>
              {paper.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.thumb} src={paper.preview} alt="" />
              ) : (
                <span className={styles.thumb}>
                  <IconFileText weight="duotone" size={32} />
                </span>
              )}
              <span className={styles.name}>
                <span>{t("file.paper", { n: i + 1 })}</span>
                <bdi className="small soft" dir="ltr">
                  {paper.name}
                </bdi>
              </span>
              <button type="button" className={styles.remove} onClick={() => remove(paper)} disabled={disabled} aria-label={t("file.remove", { name: t("file.paper", { n: i + 1 }) })}>
                <IconX weight="bold" size={20} />
                <span>{t("common.remove")}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {problem ? (
        <p className={styles.problem} role="alert">
          {t(PROBLEM[problem], { n: MAX_PAPERS })}
        </p>
      ) : null}
    </div>
  );
}
