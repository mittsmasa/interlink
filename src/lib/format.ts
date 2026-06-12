const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
});

/** epoch ミリ秒を「6/12」形式にする */
export function formatDate(epochMs: number) {
  return dateFormatter.format(new Date(epochMs));
}
