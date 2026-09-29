import { chapters } from "../../learning/course";
import type { SegmentBank } from "../types";
import { abstractionBanks } from "./abstraction";
import { concurrencyBanks } from "./concurrency";
import { gettingStartedBanks } from "./getting-started";
import { ownershipBanks } from "./ownership";
import { vocabularyBanks } from "./vocabulary";

const byChapter = new Map(
  [
    ...gettingStartedBanks,
    ...ownershipBanks,
    ...vocabularyBanks,
    ...abstractionBanks,
    ...concurrencyBanks,
  ].map((bank) => [bank.chapterId, bank]),
);

/** One bank per course chapter, in course order. */
export const allBanks: SegmentBank[] = chapters.flatMap((chapter) => {
  const bank = byChapter.get(chapter.id);
  return bank ? [bank] : [];
});

export const bankByChapter = new Map(allBanks.map((bank) => [bank.chapterId, bank]));
